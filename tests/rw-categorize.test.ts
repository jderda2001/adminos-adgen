// Testy auto-przypisywania kategorii (lib/rw-categorize.ts).
// UWAGA: nazwiska realnych osób trzymamy poza repo (config/rw-people.json).
// Tu testujemy: (a) reguły OGÓLNE (marki/słowa kluczowe, bez PII) oraz
// (b) MECHANIZM reguł osobowych na FIKCYJNYCH danych przekazanych parametrem.

import { describe, expect, it } from "vitest";
import { suggestCategory, type PersonRule } from "@/lib/rw-categorize";

describe("suggestCategory — reguły ogólne (koszty, bez PII)", () => {
  const cases: [string, string, string][] = [
    // [kontrahent, opis, oczekiwana kategoria] — nowa taksonomia (14 kategorii)
    ["Meta Ads", "PAYPRO META ADS", "Budżet reklamowy"],
    ["ClickUp", "CLICKUP ZAKUP", "Abonamenty"],
    ["Google", "Google Workspace_adgen", "Abonamenty"],
    ["Anthropic", "OPŁATA CLAUDE", "Abonamenty"],
    ["T-mobile", "OPŁATA FAKTURY", "Abonamenty"],
    ["Instantly", "INSTANTLY", "Abonamenty"],
    ["Biuro Rachunkowe XYZ", "USŁUGI KSIĘGOWE", "Pozostałe wydatki operacyjne"],
    ["Wynajem Sp. z o.o.", "CZYNSZ BIURO", "Pozostałe wydatki operacyjne"],
    ["Urząd Skarbowy", "CIT-8 CENTRUM ROZLICZENIOWE", "CIT"],
    ["Urząd Skarbowy", "PODATEK VAT-7", "VAT"],
    ["Urząd Skarbowy", "PIT-4 ZALICZKA", "PIT"],
    ["adGen", "OSZCZĘDNOŚCI - PRZELEW", "Oszczędności"],
    ["Orlen", "PALIWO STACJA", "Samochody"],
    ["Restauracja Nocna", "OBIAD RESTAURACJA", "Networking"],
    ["Jakiś podwykonawca", "PODWYKONAWSTWO UGC", "Wypłaty | UGC"],
  ];

  for (const [contractor, description, expected] of cases) {
    it(`"${contractor}" → ${expected}`, () => {
      expect(suggestCategory("KOSZT", { contractor, description }).category).toBe(
        expected
      );
    });
  }

  it("nieznany koszt → Pozostałe wydatki operacyjne z niską pewnością", () => {
    const s = suggestCategory("KOSZT", { contractor: "Losowa Firma XYZ", description: "coś" });
    expect(s.category).toBe("Pozostałe wydatki operacyjne");
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
  // reguły osobowe (config) używają STARYCH nazw — silnik mapuje je na aktywne
  const people: PersonRule[] = [
    { match: "jan kowalski|anna nowak", category: "Wypłaty zarządu", confidence: "high" },
    { match: "pawel sokol", category: "Delivery - podwykonawcy", confidence: "high" },
    { match: "biuro xyz", category: "Delivery - wynagrodzenia", confidence: "medium" },
  ];

  it("dopasowuje po nazwisku + mapuje starą kategorię na aktywną", () => {
    // „Wypłaty zarządu" (stara) → „Wypłaty | Zarząd" (aktywna)
    expect(
      suggestCategory("KOSZT", { contractor: "Jan Kowalski", description: "WYNAGRODZENIE" }, people)
        .category
    ).toBe("Wypłaty | Zarząd");
  });

  it("polskie znaki (ł) są normalizowane w dopasowaniu osobowym", () => {
    // „Paweł Sokół" → norm → „pawel sokol"; „Delivery - podwykonawcy" → „Wypłaty | UGC"
    const s = suggestCategory(
      "KOSZT",
      { contractor: "Paweł Sokół", description: "UMOWA ZLECENIE" },
      people
    );
    expect(s.category).toBe("Wypłaty | UGC");
    expect(s.confidence).toBe("high");
  });

  it("reguła osobowa MA PRIORYTET nad ogólną (mapowana na aktywną)", () => {
    // „Delivery - wynagrodzenia" (stara) → „Wypłaty | Zespół" (aktywna)
    expect(
      suggestCategory("KOSZT", { contractor: "Biuro XYZ", description: "" }, people).category
    ).toBe("Wypłaty | Zespół");
  });

  it("bez `people` (publiczny klon) nazwisko spada na fallback operacyjny", () => {
    // brak reguł osobowych → brak trafienia ogólnego → „Pozostałe wydatki operacyjne"
    expect(
      suggestCategory("KOSZT", { contractor: "Jan Kowalski", description: "WYNAGRODZENIE" }).category
    ).toBe("Pozostałe wydatki operacyjne");
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
