// Testy czystych funkcji passu AI (lib/rw-ai.ts) — prompt, schemat wyjścia,
// walidacja odpowiedzi modelu. Samo wywołanie API nie jest testowane.

import { describe, expect, it } from "vitest";
import {
  buildTaxonomyPrompt,
  buildOutputSchema,
  validateAiSuggestions,
  type AiRowInput,
} from "@/lib/rw-ai";

describe("buildTaxonomyPrompt", () => {
  const prompt = buildTaxonomyPrompt();

  it("zawiera kategorie obu rodzajów i zasady metodologii", () => {
    expect(prompt).toContain("Abonament marketingowy");
    expect(prompt).toContain("Delivery - wynagrodzenia");
    expect(prompt).toContain("Środki przelane na oszczędności");
    expect(prompt).toContain("Zwroty");
  });
});

describe("buildOutputSchema", () => {
  it("enum kategorii bez duplikatów (Inne występuje w obu rodzajach)", () => {
    const schema = buildOutputSchema() as {
      properties: { items: { items: { properties: { category: { enum: string[] } } } } };
    };
    const names = schema.properties.items.items.properties.category.enum;
    expect(names).toContain("Inne");
    expect(names).toContain("CIT");
    expect(new Set(names).size).toBe(names.length); // brak duplikatów
  });
});

describe("validateAiSuggestions", () => {
  const rows: AiRowInput[] = [
    { index: 0, kind: "KOSZT", description: "META ADS", amountGr: -100000 },
    { index: 3, kind: "PRZYCHOD", description: "ABONAMENT", amountGr: 500000 },
  ];

  it("przyjmuje poprawne propozycje z kanoniczną nazwą", () => {
    const out = validateAiSuggestions(
      {
        items: [
          { i: 0, category: "Marketing - budżety", confidence: "high" },
          { i: 3, category: "Abonament marketingowy", confidence: "medium" },
        ],
      },
      rows
    );
    expect(out).toEqual([
      { index: 0, category: "Marketing - budżety", confidence: "high" },
      { index: 3, category: "Abonament marketingowy", confidence: "medium" },
    ]);
  });

  it("odrzuca kategorię złego RODZAJU (CIT to koszt, nie przychód)", () => {
    const out = validateAiSuggestions(
      { items: [{ i: 3, category: "CIT", confidence: "high" }] },
      rows
    );
    expect(out).toEqual([]);
  });

  it("odrzuca nieznany index i nieznaną kategorię; zły confidence → medium", () => {
    const out = validateAiSuggestions(
      {
        items: [
          { i: 99, category: "Inne", confidence: "high" }, // nieznany index
          { i: 0, category: "Wymyślona kategoria", confidence: "high" }, // spoza taksonomii
          { i: 0, category: "Inne", confidence: "banana" }, // zły confidence
        ],
      },
      rows
    );
    expect(out).toEqual([{ index: 0, category: "Inne", confidence: "medium" }]);
  });

  it("duplikat indexu — pierwszy wygrywa; śmieciowe wejście → []", () => {
    const out = validateAiSuggestions(
      {
        items: [
          { i: 0, category: "Marketing - budżety", confidence: "high" },
          { i: 0, category: "Inne", confidence: "low" },
        ],
      },
      rows
    );
    expect(out).toHaveLength(1);
    expect(out[0].category).toBe("Marketing - budżety");

    expect(validateAiSuggestions(null, rows)).toEqual([]);
    expect(validateAiSuggestions({ items: "nie-tablica" }, rows)).toEqual([]);
    expect(validateAiSuggestions({ items: [null, 42, "x"] }, rows)).toEqual([]);
  });
});
