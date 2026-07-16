// Testy parsera CSV kosztów (lib/cost-csv.ts) — realny układ arkusza (ClickUp):
// wiersz tytułowy przed nagłówkiem, polskie daty słowne bez roku, netto+brutto.

import { describe, expect, it } from "vitest";
import { parseCostCsv, yearFromFilename, type CostCsvResult } from "@/lib/cost-csv";

function ok(text: string, year = 2026): CostCsvResult {
  const r = parseCostCsv(text, year);
  if ("formatError" in r) throw new Error("nieoczekiwany formatError: " + r.formatError);
  return r;
}

describe("parseCostCsv — realny arkusz (tytuł + polskie daty + netto/brutto)", () => {
  const csv = [
    "Koszta", // wiersz tytułowy — pomijany
    "Status;Opłacone;Faktura;Data rozliczenia;Kategoria;Wartość netto;Wartość Brutto;Wartość VAT;Komentarz",
    "Brak działań;NIE;Google Workspace;1 sierpnia;Abonamenty;493,53;607,04;114;",
    "Brak działań;NIE;Czynsz administracyjny | biuro;1 lipca;Pozostałe wydatki operacyjne;1100;1353;253;",
    "Brak działań;NIE;Wypłaty UGC;15 lipca;Wypłaty | UGC;5000;5000;0;",
  ].join("\n");

  it("znajduje nagłówek po tytule i parsuje daty słowne z rokiem z parametru", () => {
    const r = ok(csv, 2026);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      dateISO: "2026-08-01",
      year: 2026,
      month: 8,
      supplier: "Google Workspace",
      categoryText: "Abonamenty",
      netGr: 49353,
      grossGr: 60704,
    });
    // 607,04 / 493,53 ≈ 1,23 → stawka 23
    expect(r.rows[0].vatRate).toBe("23");
    expect(r.rows[1]).toMatchObject({ dateISO: "2026-07-01", month: 7, netGr: 110000, grossGr: 135300 });
    // brutto = netto → 0%
    expect(r.rows[2].vatRate).toBe("0");
  });

  it("rok z parametru stosowany do wszystkich wierszy bez roku w dacie", () => {
    const r = ok(csv, 2025);
    expect(r.rows.every((x) => x.year === 2025)).toBe(true);
  });
});

describe("parseCostCsv — formaty i błędy", () => {
  it("daty numeryczne nadal działają", () => {
    const csv = ["Data;Faktura;Kategoria;Wartość netto", "2025-03-15;Meta;Budżet reklamowy;2 460,00"].join("\n");
    const r = ok(csv);
    expect(r.rows[0]).toMatchObject({ dateISO: "2025-03-15", netGr: 246000 });
  });

  it("separator , wykrywany", () => {
    const csv = ["Data,Faktura,Kategoria,Wartość netto", "2025-01-10,Canva,Abonamenty,120"].join("\n");
    const r = ok(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].netGr).toBe(12000);
  });

  it("brak kolumny daty → formatError", () => {
    const r = parseCostCsv("Faktura;Kategoria;Wartość netto\nX;Abonamenty;1000", 2026);
    expect("formatError" in r).toBe(true);
  });

  it("złe/puste wiersze → errors; puste → pominięte", () => {
    const csv = [
      "Data;Faktura;Kategoria;Wartość netto",
      "1 stycznia;A;Abonamenty;1000,00",
      "gg gg;B;Inne;500", // zła data
      "3 stycznia;C;Inne;", // brak kwoty
      ";;;", // pusty
    ].join("\n");
    const r = ok(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.skippedEmpty).toBe(1);
  });

  it("brutto bez netto → netto = brutto; brak dostawcy → myślnik", () => {
    const csv = ["Data;Faktura;Kategoria;Wartość Brutto", "5 maja;;Inne;1230,00"].join("\n");
    const r = ok(csv);
    expect(r.rows[0].supplier).toBe("—");
    expect(r.rows[0].netGr).toBe(123000);
    expect(r.rows[0].grossGr).toBe(123000);
  });
});

describe("yearFromFilename", () => {
  it("wyciąga rok z nazwy pliku", () => {
    expect(yearFromFilename("Sierpień 2026 - Podsumowanie.csv")).toBe(2026);
    expect(yearFromFilename("koszty.csv")).toBeNull();
  });
});
