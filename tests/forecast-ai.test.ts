// Testy czystych funkcji AI Estymacji: schemat wyjścia, walidacja odpowiedzi
// modelu, nakładanie korekt na baseline. Bez wywołania API.

import { describe, expect, it } from "vitest";
import { buildForecast, applyAiAdjustments, type ForecastInput } from "@/lib/forecast";
import { buildForecastOutputSchema, validateForecastAiOutput } from "@/lib/forecast-ai";

describe("buildForecastOutputSchema", () => {
  it("enum period ograniczony do podanych okresów", () => {
    const schema = buildForecastOutputSchema(["2026-07", "2026-08"]) as {
      properties: {
        monthAdjustments: { items: { properties: { period: { enum: string[] } } } };
      };
    };
    expect(schema.properties.monthAdjustments.items.properties.period.enum).toEqual([
      "2026-07",
      "2026-08",
    ]);
  });
});

describe("validateForecastAiOutput", () => {
  const periods = ["2026-07", "2026-08"];

  it("klamruje ±30%, dropuje nieznane okresy, dedupuje, limituje ryzyka i confidence", () => {
    const raw = {
      monthAdjustments: [
        { period: "2026-07", revenueAdjPct: 50, costAdjPct: -5, note: "x" }, // 50 → 30
        { period: "2099-01", revenueAdjPct: 10, costAdjPct: 0, note: "spoza" }, // out
        { period: "2026-07", revenueAdjPct: 1, costAdjPct: 1, note: "dup" }, // dup → ignore
        { period: "2026-08", revenueAdjPct: -99, costAdjPct: 12, note: "y" }, // −99 → −30
      ],
      risks: Array.from({ length: 12 }, (_, i) => `ryzyko ${i}`),
      narrative: "ok",
      confidence: "banana",
    };
    const out = validateForecastAiOutput(raw, periods);
    expect(out.adjustments).toHaveLength(2);
    expect(out.adjustments[0]).toEqual({ period: "2026-07", revenueAdjPct: 30, costAdjPct: -5, note: "x" });
    expect(out.adjustments[1].revenueAdjPct).toBe(-30);
    expect(out.risks).toHaveLength(8); // MAX_RISKS
    expect(out.confidence).toBe("medium"); // nieprawidłowe → medium
  });

  it("śmieciowe wejście → puste, confidence medium", () => {
    const out = validateForecastAiOutput(null, periods);
    expect(out.adjustments).toEqual([]);
    expect(out.risks).toEqual([]);
    expect(out.narrative).toBe("");
    expect(out.confidence).toBe("medium");
  });
});

describe("applyAiAdjustments", () => {
  function baseline() {
    const input: ForecastInput = {
      todayIso: "2026-07-10",
      horizonMonths: 3, // 07,08,09
      snapshot: { dateIso: "2026-07-01", balanceGr: 0 },
      clients: [
        // ABONAMENT 10 000 zł, notice 0 → 07 umowne, 08/09 zakładane
        { id: "A", name: "Alfa", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 1000000, startDate: null, endDate: null, noticeMonths: 0 },
      ],
      openInvoices: [],
      paidAfterSnapshotInvoices: [],
      historyInvoices: [],
      paidInvoices: [],
      openCosts: [],
      recurring: [],
      rwHistory: [
        { period: "2026-04", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -200000, grossGr: -246000 },
        { period: "2026-05", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -200000, grossGr: -246000 },
        { period: "2026-06", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -200000, grossGr: -246000 },
      ],
      events: [],
      assumptions: { newBusinessMonthlyGr: 0 },
    };
    return buildForecast(input);
  }

  it("skaluje TYLKO zakładane przychody i koszty bazowe wskazanego miesiąca", () => {
    const base = baseline();
    // sanity baseline: 08 przychód 1 000 000 (zakładany), koszty 200 000
    expect(base.pnl[1].assumedNetGr).toBe(1000000);
    expect(base.pnl[1].costsNetGr).toBe(200000);

    const out = applyAiAdjustments(base, [
      { period: "2026-08", revenueAdjPct: 10, costAdjPct: 20, note: "" },
    ]);

    // 08: przychód zakładany +10% → 1 100 000; koszty bazowe +20% → 240 000
    expect(out.pnl[1].assumedNetGr).toBe(1100000);
    expect(out.pnl[1].revenueNetGr).toBe(1100000);
    expect(out.pnl[1].costsNetGr).toBe(240000);
    expect(out.pnl[1].profitGr).toBe(860000);

    // 07 (umowny, brak korekty) — bez zmian
    expect(out.pnl[0].revenueNetGr).toBe(base.pnl[0].revenueNetGr);
    expect(out.pnl[0].costsNetGr).toBe(200000);
    // 09 — brak korekty
    expect(out.pnl[2].costsNetGr).toBe(200000);
  });

  it("miesiąc umowny: korekta przychodu NIE rusza części umownej", () => {
    const base = baseline();
    // 07 jest umowny (contracted). Korekta revenueAdjPct nie powinna go zmienić.
    const out = applyAiAdjustments(base, [
      { period: "2026-07", revenueAdjPct: 25, costAdjPct: 0, note: "" },
    ]);
    expect(out.pnl[0].contractedNetGr).toBe(1000000);
    expect(out.pnl[0].revenueNetGr).toBe(1000000); // bez zmian (0 zakładanych)
  });
});
