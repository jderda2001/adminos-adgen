// Pass AI kategoryzacji (Claude API) — dla operacji, których silnik reguł
// (lib/rw-categorize.ts) nie rozpoznał pewnie. Wołany z akcji serwerowej PO
// zbudowaniu przeglądu: użytkownik klika „Doprecyzuj z AI", niepewne operacje
// lecą do Claude, propozycje wracają do edytowalnych dropdownów — zatwierdzenie
// nadal należy do użytkownika.
//
// - Klucz WYŁĄCZNIE na serwerze: ANTHROPIC_API_KEY w .env (nigdy w repo/kliencie).
//   Brak klucza → funkcja wyłączona (isAiEnabled), reszta importu działa bez zmian.
// - Structured outputs (output_config.format + enum kategorii) → model NIE MOŻE
//   zwrócić kategorii spoza taksonomii; mimo to walidujemy per-rodzaj serwerowo.
// - Model: claude-opus-4-8 (nadpisywalny przez ANTHROPIC_MODEL). Wolumen jest
//   malutki (≤ setki operacji/mies.), koszt pomijalny.
//
// UWAGA: moduł serwerowy (SDK + klucz) — nie importować z komponentów klienckich;
// typy potrzebne klientowi żyją w actions.ts.

import Anthropic from "@anthropic-ai/sdk";
import {
  RW_BUCKET_LABELS,
  RW_CATEGORIES,
  findRwCategory,
  rwCategoriesFor,
  type RwKind,
} from "./rw-types";

export interface AiRowInput {
  index: number; // stabilny identyfikator wiersza po stronie klienta
  kind: RwKind;
  description: string;
  amountGr: number;
}

export interface AiSuggestionOut {
  index: number;
  category: string; // kanoniczna nazwa z taksonomii (zwalidowana)
  confidence: "high" | "medium" | "low";
}

export function isAiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

// ── prompt: taksonomia + metodologia adGen (czyste funkcje — testowane) ──

export function buildTaxonomyPrompt(): string {
  const section = (kind: RwKind, title: string) =>
    `${title}:\n` +
    rwCategoriesFor(kind)
      .map((c) => `- "${c.name}" (${RW_BUCKET_LABELS[c.bucket]})`)
      .join("\n");

  return [
    "Jesteś księgowym agencji marketingowej adGen. Przypisujesz operacjom",
    "z wyciągu bankowego kategorie rachunku wyników. Dla każdej operacji",
    "otrzymasz: i (id), rodzaj (PRZYCHOD|KOSZT), opis i kwotę w zł.",
    "Zwróć dla każdej operacji kategorię DOKŁADNIE z listy dla jej rodzaju",
    "oraz confidence (high = jednoznaczne, medium = prawdopodobne, low = zgadujesz).",
    "",
    section("PRZYCHOD", "Kategorie PRZYCHODÓW"),
    "",
    section("KOSZT", "Kategorie KOSZTÓW"),
    "",
    "Zasady metodologii adGen:",
    "- Zwroty/refaktury/odsetki → „Inne\" (przychód lub koszt wg rodzaju).",
    "- Płatności Meta/Facebook Ads → dominująco „Marketing - budżety\";",
    "  gdy opis sugeruje kampanię dla klienta → „Delivery - budżet reklamowy\" (medium).",
    "- SaaS/subskrypcje/telekomy → „Administracja - abonamenty\".",
    "- Wynagrodzenia bez rozpoznawalnej roli osoby → najbliższa kategoria",
    "  wynagrodzeń z confidence low.",
    "- Przelewy na oszczędności → „Środki przelane na oszczędności\";",
    "  zaliczki CIT / na premie zespołu → odpowiednie kategorie odłożonych środków.",
    "- Gdy naprawdę nie wiadomo: KOSZT → „Inne\" (low); PRZYCHOD → najbliższa",
    "  sensowna kategoria z confidence low.",
  ].join("\n");
}

/** JSON Schema odpowiedzi — enum wszystkich kategorii (obu rodzajów) */
export function buildOutputSchema(): Record<string, unknown> {
  const allNames = [...new Set(RW_CATEGORIES.map((c) => c.name))];
  return {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            i: { type: "integer" },
            category: { type: "string", enum: allNames },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["i", "category", "confidence"],
          additionalProperties: false,
        },
      },
    },
    required: ["items"],
    additionalProperties: false,
  };
}

/**
 * Walidacja odpowiedzi modelu: znany index, kategoria istnieje DLA RODZAJU
 * danego wiersza (enum w schemacie jest wspólny dla obu rodzajów), poprawny
 * confidence. Duplikaty indexów — pierwszy wygrywa. Czysta funkcja.
 */
export function validateAiSuggestions(
  raw: unknown,
  rows: AiRowInput[]
): AiSuggestionOut[] {
  const byIndex = new Map(rows.map((r) => [r.index, r]));
  const seen = new Set<number>();
  const out: AiSuggestionOut[] = [];
  const items =
    raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? ((raw as { items: unknown[] }).items as unknown[])
      : [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (!Number.isInteger(o.i) || typeof o.category !== "string") continue;
    const i = o.i as number;
    const row = byIndex.get(i);
    if (!row || seen.has(i)) continue;
    const cat = findRwCategory(row.kind, o.category);
    if (!cat) continue; // kategoria złego rodzaju / spoza taksonomii
    const confidence =
      o.confidence === "high" || o.confidence === "low" ? o.confidence : "medium";
    seen.add(i);
    out.push({ index: i, category: cat.name, confidence });
  }
  return out;
}

// ── wywołanie API ────────────────────────────────────────────────────

/**
 * Kategoryzuje operacje przez Claude. Rzuca błędy SDK (obsługa w akcji).
 * Jedno żądanie — wołający ogranicza liczbę wierszy (akcja: ≤ 400).
 */
export async function aiCategorize(rows: AiRowInput[]): Promise<AiSuggestionOut[]> {
  const client = new Anthropic(); // ANTHROPIC_API_KEY z env
  const payload = rows.map((r) => ({
    i: r.index,
    rodzaj: r.kind,
    opis: r.description.slice(0, 240),
    kwota_zl: Math.round(r.amountGr / 100),
  }));

  const response = await client.messages.create({
    model: MODEL(),
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: buildTaxonomyPrompt(),
    output_config: {
      format: { type: "json_schema", schema: buildOutputSchema() },
    },
    messages: [
      {
        role: "user",
        content: `Skategoryzuj operacje:\n${JSON.stringify(payload)}`,
      },
    ],
  });

  const text = response.content.find((b) => b.type === "text")?.text ?? "";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return []; // nie powinno się zdarzyć przy structured outputs
  }
  return validateAiSuggestions(parsed, rows);
}
