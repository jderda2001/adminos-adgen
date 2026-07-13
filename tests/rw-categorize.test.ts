// Testy auto-przypisywania kategorii (lib/rw-categorize.ts).
// UWAGA: nazwiska realnych osób trzymamy poza repo (config/rw-people.json).
// Tu testujemy: (a) reguły OGÓLNE (marki/słowa kluczowe, bez PII) oraz
// (b) MECHANIZM reguł osobowych na FIKCYJNYCH danych przekazanych parametrem.

import { describe, expect, it } from "vitest";
import { suggestCategory, type PersonRule } from "@/lib/rw-categorize";

describe("suggestCategory — reguły ogólne (koszty, bez PII)", () => {
  const cases: [string, string, string][] = [
    // [kontrahent, opis, oczekiwana kategoria]
    ["Meta Ads", "PAYPRO META ADS", "Marketing - budżety"],
    ["ClickUp", "CLICKUP ZAKUP", "Administracja - abonamenty"],
    ["Google", "Google Workspace_adgen", "Administracja - abonamenty"],
    ["Anthropic", "OPŁATA CLAUDE", "Administracja - abonamenty"],
    ["T-mobile", "OPŁATA FAKTURY", "Administracja - abonamenty"],
    ["Biuro Rachunkowe XYZ", "USŁUGI KSIĘGOWE", "Obsługa księgowa"],
    ["Wynajem Sp. z o.o.", "CZYNSZ BIURO", "Biuro - czynsz"],
    ["Urząd Skarbowy", "CIT-8 CENTRUM ROZLICZENIOWE", "CIT"],
    ["adGen", "OSZCZĘDNOŚCI - PRZELEW", "Środki przelane na oszczędności"],
    ["Instantly", "INSTANTLY", "Sprzedaż - zewnętrzny koszt"],
    ["Jakiś podwykonawca", "PODWYKONAWSTWO", "Delivery - podwykonawcy"],
  ];

  for (const [contractor, description, expected] of cases) {
    it(`"${contractor}" → ${expected}`, () => {
      expect(suggestCategory("KOSZT", { contractor, description }).category).toBe(
        expected
      );
    });
  }

  it("nieznany koszt → Inne z niską pewnością", () => {
    const s = suggestCategory("KOSZT", { contractor: "Losowa Firma XYZ", description: "coś" });
    expect(s.category).toBe("Inne");
    expect(s.confidence).toBe("low");
  });

  it("marka publiczna wygrywa (wysoka pewność)", () => {
    expect(
      suggestCategory("KOSZT", { contractor: "Canva", description: "przelew" }).confidence
    ).toBe("high");
  });
});

describe("suggestCategory — reguły osobowe (mechanizm, dane FIKCYJNE)", () => {
  // fikcyjne reguły w formacie config/rw-people.json (znormalizowane wzorce)
  const people: PersonRule[] = [
    { match: "jan kowalski|anna nowak", category: "Wypłaty zarządu", confidence: "high" },
    { match: "pawel sokol", category: "Delivery - podwykonawcy", confidence: "high" },
    { match: "biuro xyz", category: "Delivery - wynagrodzenia", confidence: "medium" },
  ];

  it("dopasowuje po nazwisku przekazanym w `people`", () => {
    expect(
      suggestCategory("KOSZT", { contractor: "Jan Kowalski", description: "WYNAGRODZENIE" }, people)
        .category
    ).toBe("Wypłaty zarządu");
  });

  it("polskie znaki (ł) są normalizowane w dopasowaniu osobowym", () => {
    // „Paweł Sokół" → norm → „pawel sokol" → trafia we wzorzec „pawel sokol"
    const s = suggestCategory(
      "KOSZT",
      { contractor: "Paweł Sokół", description: "UMOWA ZLECENIE" },
      people
    );
    expect(s.category).toBe("Delivery - podwykonawcy");
    expect(s.confidence).toBe("high");
  });

  it("reguła osobowa MA PRIORYTET nad ogólną", () => {
    // „biuro xyz" trafiłoby na słowo kluczowe, ale reguła osobowa wygrywa (Delivery - wynagrodzenia)
    expect(
      suggestCategory("KOSZT", { contractor: "Biuro XYZ", description: "" }, people).category
    ).toBe("Delivery - wynagrodzenia");
  });

  it("bez `people` (publiczny klon) nazwisko spada na regułę ogólną / Inne", () => {
    // brak reguł osobowych → „Jan Kowalski / WYNAGRODZENIE" nie ma trafienia ogólnego → Inne
    expect(
      suggestCategory("KOSZT", { contractor: "Jan Kowalski", description: "WYNAGRODZENIE" }).category
    ).toBe("Inne");
  });

  it("błędny wzorzec regex w configu nie wysypuje kategoryzacji", () => {
    const bad: PersonRule[] = [{ match: "(niezamkniety", category: "Wypłaty zarządu", confidence: "high" }];
    expect(() =>
      suggestCategory("KOSZT", { contractor: "cokolwiek", description: "" }, bad)
    ).not.toThrow();
  });
});

describe("suggestCategory — przychody", () => {
  it("pilotaż / stała współpraca / abonament", () => {
    expect(
      suggestCategory("PRZYCHOD", { description: "Paczka leadów (pilotaż)" }).category
    ).toBe("Paczki leadów (pilotaż)");
    expect(
      suggestCategory("PRZYCHOD", { description: "Paczki leadów stała współpraca" }).category
    ).toBe("Paczki leadów (stała współpraca)");
    expect(
      suggestCategory("PRZYCHOD", { description: "Abonament marketingowy" }).category
    ).toBe("Abonament marketingowy");
  });

  it("zwroty → Inne", () => {
    expect(
      suggestCategory("PRZYCHOD", { description: "Zwrot nadpłaty" }).category
    ).toBe("Inne");
  });

  it("nierozpoznany przychód → null (użytkownik wybierze)", () => {
    expect(
      suggestCategory("PRZYCHOD", { description: "losowy przelew" }).category
    ).toBeNull();
  });
});
