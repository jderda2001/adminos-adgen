// Warstwa AI dla Estymacji (server-only, lustro lib/rw-ai.ts). Claude występuje
// jako konserwatywny CFO: KOMENTUJE deterministyczny baseline i proponuje korekty
// (skalowanie składników ZAKŁADANYCH) + ryzyka. Nigdy nie zapisuje do bazy —
// wynik jest doradczy, scenariusz nakłada się na baseline czystą funkcją
// applyAiAdjustments (lib/forecast). Funkcje prompt/payload/schema/validate są
// czyste i testowane bez wywołania API.

import Anthropic from "@anthropic-ai/sdk";
import { isAiEnabled } from "./rw-ai";
import type { ForecastResult, AiMonthAdjustment, ForecastAiReview } from "./forecast";

export { isAiEnabled };
export type { ForecastAiReview };

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const ADJ_CLAMP = 30; // maksymalna korekta ±30%
const MAX_RISKS = 8;

const zl = (gr: number) => Math.round(gr / 100);

// ── prompt / payload / schema (czyste) ───────────────────────────────

export function buildForecastSystemPrompt(): string {
  return [
    "Jesteś ostrożnym dyrektorem finansowym (CFO) agencji marketingowej adGen.",
    "Dostajesz DETERMINISTYCZNĄ prognozę (baseline) przychodów, kosztów i gotówki",
    "na kolejne miesiące oraz historię. Twoje zadanie: ocenić realizm i zaproponować",
    "korekty oraz ryzyka — NIE zastępujesz baseline'u, komentujesz go.",
    "",
    "Zasady:",
    "- Korekty podajesz jako procent na miesiąc: revenueAdjPct (przychody ZAKŁADANE,",
    "  nie umowne) i costAdjPct (koszty bazowe operacyjne). Zakres −30…30. 0 = bez zmian.",
    "- Bądź konserwatywny: łatwiej zawyżyć przychód i zaniżyć koszt niż odwrotnie.",
    "- Uwzględnij sezonowość, zaległości, wątpliwe należności, punktualność płatności.",
    "- narrative: 3–6 zdań po polsku, konkret. risks: krótkie punkty (najwyżej 8).",
    "- confidence: high/medium/low — jak pewny jesteś oceny przy tych danych.",
    "- Wszystkie kwoty w danych są w PLN (zł).",
  ].join("\n");
}

export function buildForecastPayload(result: ForecastResult): unknown {
  return {
    okresy: result.periods,
    pnl: result.pnl.map((m) => ({
      okres: m.period,
      przychody_zl: zl(m.revenueNetGr),
      w_tym_umowne_zl: zl(m.contractedNetGr),
      w_tym_zakladane_zl: zl(m.assumedNetGr),
      koszty_zl: zl(m.costsNetGr),
      wynik_zl: zl(m.profitGr),
    })),
    cash: result.cash?.map((m) => ({
      okres: m.period,
      saldo_poczatek_zl: zl(m.openingGr),
      wplywy_zl: zl(m.inflowsGr),
      wydatki_zl: zl(m.outflowsGr),
      saldo_koniec_zl: zl(m.closingGr),
      min_saldo_zl: zl(m.minBalanceGr),
    })),
    kpis: {
      gotowka_koniec_zl: result.kpis.closingEndGr === null ? null : zl(result.kpis.closingEndGr),
      min_saldo_zl: result.kpis.minBalanceGr === null ? null : zl(result.kpis.minBalanceGr),
      pierwszy_miesiac_pod_kreska: result.kpis.firstNegativePeriod,
      zalegle_naleznosci_zl: zl(result.kpis.overdueBacklogGr),
      watpliwe_naleznosci_zl: zl(result.kpis.doubtfulGr),
    },
    punktualnosc_klientow: Object.values(result.paymentStats.byClient)
      .sort((a, b) => b.sampleCount - a.sampleCount)
      .slice(0, 10)
      .map((c) => ({
        faktur: c.sampleCount,
        mediana_opoznienia_dni: c.medianDelayDays,
        w_terminie_udzial: Math.round(c.onTimeFraction * 100) / 100,
      })),
    ostrzezenia: result.warnings.map((w) => w.message),
  };
}

export function buildForecastOutputSchema(periods: string[]): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      monthAdjustments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            period: { type: "string", enum: periods },
            revenueAdjPct: { type: "number" },
            costAdjPct: { type: "number" },
            note: { type: "string" },
          },
          required: ["period", "revenueAdjPct", "costAdjPct", "note"],
          additionalProperties: false,
        },
      },
      risks: { type: "array", items: { type: "string" } },
      narrative: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["monthAdjustments", "risks", "narrative", "confidence"],
    additionalProperties: false,
  };
}

function clampPct(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  return Math.max(-ADJ_CLAMP, Math.min(ADJ_CLAMP, Math.round(v)));
}

/** Walidacja odpowiedzi modelu: znane okresy, klamry ±30%, dedup, limity. Czysta. */
export function validateForecastAiOutput(raw: unknown, periods: string[]): ForecastAiReview {
  const periodSet = new Set(periods);
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const seen = new Set<string>();
  const adjustments: AiMonthAdjustment[] = [];
  const rawAdj = Array.isArray(obj.monthAdjustments) ? obj.monthAdjustments : [];
  for (const item of rawAdj) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const period = typeof o.period === "string" ? o.period : "";
    if (!periodSet.has(period) || seen.has(period)) continue;
    seen.add(period);
    adjustments.push({
      period,
      revenueAdjPct: clampPct(o.revenueAdjPct),
      costAdjPct: clampPct(o.costAdjPct),
      note: typeof o.note === "string" ? o.note.slice(0, 300) : "",
    });
  }

  const risks = (Array.isArray(obj.risks) ? obj.risks : [])
    .filter((r): r is string => typeof r === "string" && r.trim() !== "")
    .slice(0, MAX_RISKS)
    .map((r) => r.slice(0, 300));

  const narrative = typeof obj.narrative === "string" ? obj.narrative.slice(0, 2000) : "";
  const confidence =
    obj.confidence === "high" || obj.confidence === "low" ? obj.confidence : "medium";

  return { adjustments, risks, narrative, confidence };
}

// ── wywołanie API ────────────────────────────────────────────────────

/** Analiza prognozy przez Claude. Rzuca błędy SDK (obsługa w akcji). */
export async function aiReviewForecast(result: ForecastResult): Promise<ForecastAiReview> {
  const client = new Anthropic(); // ANTHROPIC_API_KEY z env
  const response = await client.messages.create({
    model: MODEL(),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: buildForecastSystemPrompt(),
    output_config: {
      format: { type: "json_schema", schema: buildForecastOutputSchema(result.periods) },
    },
    messages: [
      {
        role: "user",
        content: `Oceń prognozę i zaproponuj korekty oraz ryzyka:\n${JSON.stringify(
          buildForecastPayload(result)
        )}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { adjustments: [], risks: [], narrative: "", confidence: "low" };
  }
  return validateForecastAiOutput(parsed, result.periods);
}
