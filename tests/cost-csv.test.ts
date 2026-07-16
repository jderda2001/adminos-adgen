// Testy parsera CSV kosztów (lib/cost-csv.ts).

import { describe, expect, it } from "vitest";
import { parseCostCsv, type CostCsvResult } from "@/lib/cost-csv";

function ok(text: string): CostCsvResult {
  const r = parseCostCsv(text);
  if ("formatError" in r) throw new Error("nieoczekiwany formatError: " + r.formatError);
  return r;
}

describe("parseCostCsv", () => {
  it("separator ; + różne formaty dat + kwoty PL", () => {
    const csv = [
      "Data;Dostawca;Kategoria;Kwota netto",
      "2025-03-15;Meta Platforms;Budżet reklamowy;2 460,00",
      "05.11.2025;ZUS;Wypłaty | Zespół;1200,00",
      "31/12/2026;Orlen;Samochody;300",
    ].join("\n");
    const r = ok(csv);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ dateISO: "2025-03-15", year: 2025, month: 3, supplier: "Meta Platforms", categoryText: "Budżet reklamowy", netGr: 246000 });
    expect(r.rows[1]).toMatchObject({ dateISO: "2025-11-05", year: 2025, month: 11, netGr: 120000 });
    expect(r.rows[2]).toMatchObject({ dateISO: "2026-12-31", year: 2026, month: 12, netGr: 30000 });
  });

  it("separator , wykrywany automatycznie", () => {
    const csv = ["Data,Dostawca,Kategoria,Kwota", "2025-01-10,Canva,Abonamenty,120,00"].join("\n");
    // uwaga: przecinek jako separator + przecinek dziesiętny są niejednoznaczne;
    // tu kwota bez części dziesiętnej dla jednoznaczności
    const csv2 = ["Data,Dostawca,Kategoria,Kwota", "2025-01-10,Canva,Abonamenty,120"].join("\n");
    const r = ok(csv2);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ dateISO: "2025-01-10", supplier: "Canva", netGr: 12000 });
    void csv;
  });

  it("opcjonalna kolumna VAT rozpoznawana", () => {
    const csv = [
      "Data;Dostawca;Kategoria;Kwota netto;VAT",
      "2025-02-01;X;Abonamenty;1000,00;23",
      "2025-02-02;Y;Networking;500,00;zw",
    ].join("\n");
    const r = ok(csv);
    expect(r.rows[0].vatRate).toBe("23");
    expect(r.rows[1].vatRate).toBe("ZW");
  });

  it("brak wymaganej kolumny Kwota → formatError", () => {
    const r = parseCostCsv("Data;Dostawca;Kategoria\n2025-01-01;X;Abonamenty");
    expect("formatError" in r).toBe(true);
  });

  it("złe wiersze → errors, puste → pominięte", () => {
    const csv = [
      "Data;Dostawca;Kategoria;Kwota",
      "2025-01-01;A;Abonamenty;1000,00",
      "gg.gg.gggg;B;Inne;500", // zła data
      "2025-01-03;C;Inne;abc", // zła kwota
      ";;;", // pusty
    ].join("\n");
    const r = ok(csv);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(2);
    expect(r.skippedEmpty).toBe(1);
  });

  it("brak dostawcy zastąpiony myślnikiem; kwota jako magnituda", () => {
    const csv = ["Data;Dostawca;Kategoria;Kwota", "2025-05-05;;Inne;-1000,00"].join("\n");
    const r = ok(csv);
    expect(r.rows[0].supplier).toBe("—");
    expect(r.rows[0].netGr).toBe(100000);
  });
});
