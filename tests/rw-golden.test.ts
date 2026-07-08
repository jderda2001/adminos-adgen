// ZŁOTY TEST Rachunku Wyników: parsuje PRAWDZIWE pliki CSV adGen
// (z ~/Downloads — nie są commitowane do repo, dane wrażliwe) i porównuje
// wynik silnika z wartościami z arkusza „Rachunek wyników 2026 (adGen)".
//
// Wartości oczekiwane przepisane z zakładki „Rachunek wyników" arkusza
// (zaokrąglone do pełnych złotych — stąd tolerancja 1 zł = 100 gr).
//
// Test jest pomijany, gdy plików nie ma (np. CI) — lokalnie MUSI przechodzić.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseRwCsv } from "@/lib/rw-parse";
import { buildRwReport, type RwEntryLike } from "@/lib/rw";

const DIR = join(homedir(), "Downloads");
const REVENUE_FILE = join(DIR, "Rachunek wyników 2026 (adGen) - Przychody 2026.csv");
const COST_FILE = join(DIR, "Rachunek wyników 2026 (adGen) - Koszty 2026.csv");

const filesPresent = existsSync(REVENUE_FILE) && existsSync(COST_FILE);

// tolerancje: kwoty ±1 zł (arkusz pokazuje zaokrąglone złote), procenty ±0,02 p.p.
const ZL = 100;
function expectZl(actualGr: number, expectedZl: number, label: string) {
  const diff = Math.abs(actualGr - expectedZl * ZL);
  expect(diff, `${label}: silnik ${(actualGr / 100).toFixed(2)} zł vs arkusz ${expectedZl} zł`).toBeLessThanOrEqual(ZL);
}
function expectPct(actual: number | null, expectedPct: number, label: string) {
  expect(actual, label).not.toBeNull();
  expect(Math.abs((actual as number) * 100 - expectedPct), `${label}: silnik ${((actual as number) * 100).toFixed(2)}% vs arkusz ${expectedPct}%`).toBeLessThanOrEqual(0.02);
}

// ── Wartości z arkusza (kolumny styczeń–czerwiec) ────────────────────
const SHEET = {
  przychody: [98804, 37816, 77523, 49703, 79014, 66650],
  abonament: [55569, 28716, 22363, 41010, 50680, 37400],
  paczkiStala: [14640, 4100, 18080, 7350, 21350, 13550],
  paczkiPilotaz: [27500, 5000, 36910, 0, 5400, 13500],
  przychodyInne: [1095, 0, 170, 1343, 1584, 2200],
  delivery: [-30222, -11891, -34396, -22729, -27509, -28362],
  deliveryWynagrodzenia: [-24222, -9574, -23056, -20037, -20663, -16222],
  deliveryBudzet: [-5000, -2317, -10340, -1992, -2747, -11140],
  deliveryPodwykonawcy: [-1000, 0, -1000, -700, -4100, -1000],
  growth: [-19191, -18690, -20922, -18766, -12913, -6213],
  overhead: [-34204, -21239, -24027, -10951, -39285, -36381],
  odlozone: [-9014, 0, -197, 0, 0, -1780],
  kosztyLacznie: [-83618, -51819, -79345, -52447, -79707, -70956],
  zysk: [15186, -14003, -1822, -2744, -693, -4306],
  marza1: [69.41, 68.56, 55.63, 54.27, 65.18, 57.45],
  marza2: [15.37, -37.03, -2.35, -5.52, -0.88, -6.46],
  // LIVE BOA (udziały w przychodzie)
  boaOszczednosci: [6.42, 0, 0.25, 0, 0, 2.67],
  boaWlasciciele: [14.57, 34.64, 6.58, 1.25, 5.25, 16.95],
  boaOperacyjne: [70.06, 102.39, 95.77, 104.27, 95.62, 89.51],
  // SUMY roczne (kolumna SUMA arkusza)
  sumaPrzychody: 409510,
  sumaAbonament: 235738,
  sumaPaczkiStala: 79070,
  sumaPaczkiPilotaz: 88310,
  sumaInne: 6392,
  sumaDelivery: -155110,
  sumaGrowth: -96695,
  sumaOverhead: -166086,
  sumaKoszty: -417891,
  sumaZysk: -8382,
  sumaMarza2: -2.05,
};

describe.skipIf(!filesPresent)("ZŁOTY TEST: realne CSV vs arkusz RW (6 miesięcy)", () => {
  if (!filesPresent) return;

  const revenueParsed = parseRwCsv(readFileSync(REVENUE_FILE, "utf-8"));
  const costParsed = parseRwCsv(readFileSync(COST_FILE, "utf-8"));

  it("oba pliki parsują się bez błędów", () => {
    if ("formatError" in revenueParsed) throw new Error(revenueParsed.formatError);
    if ("formatError" in costParsed) throw new Error(costParsed.formatError);
    expect(revenueParsed.kind).toBe("PRZYCHOD");
    expect(costParsed.kind).toBe("KOSZT");
    expect(revenueParsed.errors).toEqual([]);
    expect(costParsed.errors).toEqual([]);
    expect(revenueParsed.entries.length).toBeGreaterThan(70);
    expect(costParsed.entries.length).toBeGreaterThan(400);
  });

  if ("formatError" in revenueParsed || "formatError" in costParsed) return;

  const entries: RwEntryLike[] = [...revenueParsed.entries, ...costParsed.entries];
  const report = buildRwReport(2026, entries, []);

  it("brak nieznanych kategorii", () => {
    expect(report.unknownCategories).toEqual([]);
  });

  for (let m = 0; m < 6; m++) {
    const nazwa = ["styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec"][m];
    describe(`${nazwa} 2026`, () => {
      const mm = report.months[m];

      it("przychody per kategoria i łącznie", () => {
        expectZl(mm.revenueTotalGr, SHEET.przychody[m], "przychody łącznie");
        expectZl(mm.revenueByCategory["Abonament marketingowy"], SHEET.abonament[m], "abonament");
        expectZl(mm.revenueByCategory["Paczki leadów (stała współpraca)"], SHEET.paczkiStala[m], "paczki stała");
        expectZl(mm.revenueByCategory["Paczki leadów (pilotaż)"], SHEET.paczkiPilotaz[m], "paczki pilotaż");
        expectZl(mm.revenueByCategory["Inne"], SHEET.przychodyInne[m], "inne");
      });

      it("koszty produkcyjne (delivery) — grupa i kluczowe wiersze", () => {
        expectZl(mm.bucketTotalsGr.DELIVERY, SHEET.delivery[m], "delivery łącznie");
        expectZl(mm.costByCategory["Delivery - wynagrodzenia"], SHEET.deliveryWynagrodzenia[m], "delivery wynagrodzenia");
        expectZl(mm.costByCategory["Delivery - budżet reklamowy"], SHEET.deliveryBudzet[m], "delivery budżet");
        expectZl(mm.costByCategory["Delivery - podwykonawcy"], SHEET.deliveryPodwykonawcy[m], "delivery podwykonawcy");
      });

      it("growth, overhead, odłożone środki", () => {
        expectZl(mm.bucketTotalsGr.GROWTH, SHEET.growth[m], "growth");
        expectZl(mm.bucketTotalsGr.OVERHEAD, SHEET.overhead[m], "overhead");
        expectZl(mm.bucketTotalsGr.ODLOZONE, SHEET.odlozone[m], "odłożone");
      });

      it("koszty łącznie, zysk, marże", () => {
        expectZl(mm.costsTotalGr, SHEET.kosztyLacznie[m], "koszty łącznie");
        expectZl(mm.zyskGr, SHEET.zysk[m], "zysk");
        expectPct(mm.marza1, SHEET.marza1[m], "Marża I");
        expectPct(mm.marza2, SHEET.marza2[m], "Marża II");
      });

      it("LIVE BOA", () => {
        expectPct(mm.liveBoa.oszczednosci, SHEET.boaOszczednosci[m], "BOA oszczędności");
        expectPct(mm.liveBoa.wlasciciele, SHEET.boaWlasciciele[m], "BOA właściciele");
        expectPct(mm.liveBoa.operacyjne, SHEET.boaOperacyjne[m], "BOA operacyjne");
      });
    });
  }

  describe("SUMA roczna (kolumna SUMA arkusza)", () => {
    it("przychody", () => {
      expectZl(report.suma.revenueTotalGr, SHEET.sumaPrzychody, "SUMA przychody");
      expectZl(report.suma.revenueByCategory["Abonament marketingowy"], SHEET.sumaAbonament, "SUMA abonament");
      expectZl(report.suma.revenueByCategory["Paczki leadów (stała współpraca)"], SHEET.sumaPaczkiStala, "SUMA paczki stała");
      expectZl(report.suma.revenueByCategory["Paczki leadów (pilotaż)"], SHEET.sumaPaczkiPilotaz, "SUMA paczki pilotaż");
      expectZl(report.suma.revenueByCategory["Inne"], SHEET.sumaInne, "SUMA inne");
    });
    it("koszty i wynik", () => {
      expectZl(report.suma.bucketTotalsGr.DELIVERY, SHEET.sumaDelivery, "SUMA delivery");
      expectZl(report.suma.bucketTotalsGr.GROWTH, SHEET.sumaGrowth, "SUMA growth");
      expectZl(report.suma.bucketTotalsGr.OVERHEAD, SHEET.sumaOverhead, "SUMA overhead");
      expectZl(report.suma.costsTotalGr, SHEET.sumaKoszty, "SUMA koszty");
      expectZl(report.suma.zyskGr, SHEET.sumaZysk, "SUMA zysk");
      expectPct(report.suma.marza2, SHEET.sumaMarza2, "SUMA Marża II");
    });
    it("miesiące z danymi: styczeń–czerwiec", () => {
      expect(report.monthsWithData).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });
});

if (!filesPresent) {
  describe("ZŁOTY TEST: realne CSV", () => {
    it.skip("pominięty — brak plików źródłowych w ~/Downloads", () => {});
  });
}
