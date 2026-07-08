// Testy silnika Rachunku Wyników (lib/rw.ts) — formuły na danych syntetycznych
// z ręcznie policzonymi wartościami oczekiwanymi.

import { describe, expect, it } from "vitest";
import { buildRwReport, type RwEntryLike, type RwManualLike } from "@/lib/rw";

// Miesiąc styczeń (miesiąc=1), kwoty w groszach:
//   przychody: abonament 10 000 zł, pilotaż 5 000 zł, inne 500 zł → 15 500 zł
//   delivery:  wynagrodzenia −4 000, budżet reklamowy −1 000 → −5 000
//   growth:    marketing budżety −2 000, sprzedaż wynagrodzenia −1 000 → −3 000
//   overhead:  wypłaty zarządu −2 000, administracja abonamenty −500 → −2 500
//   odłożone:  oszczędności −1 000, zaliczka premie −200 → −1 200
//   CIT:       −300
const ENTRIES: RwEntryLike[] = [
  { month: 1, kind: "PRZYCHOD", category: "Abonament marketingowy", amountGr: 1_000_000 },
  { month: 1, kind: "PRZYCHOD", category: "Paczki leadów (pilotaż)", amountGr: 500_000 },
  { month: 1, kind: "PRZYCHOD", category: "Inne", amountGr: 50_000 },
  { month: 1, kind: "KOSZT", category: "Delivery - wynagrodzenia", amountGr: -400_000 },
  { month: 1, kind: "KOSZT", category: "Delivery - budżet reklamowy", amountGr: -100_000 },
  { month: 1, kind: "KOSZT", category: "Marketing - budżety", amountGr: -200_000 },
  { month: 1, kind: "KOSZT", category: "Sprzedaż - wynagrodzenia", amountGr: -100_000 },
  { month: 1, kind: "KOSZT", category: "Wypłaty zarządu", amountGr: -200_000 },
  { month: 1, kind: "KOSZT", category: "Administracja - abonamenty", amountGr: -50_000 },
  { month: 1, kind: "KOSZT", category: "Środki przelane na oszczędności", amountGr: -100_000 },
  { month: 1, kind: "KOSZT", category: "Zaliczka na premie zespołu", amountGr: -20_000 },
  { month: 1, kind: "KOSZT", category: "CIT", amountGr: -30_000 },
  // luty: tylko koszt (miesiąc bez przychodu)
  { month: 2, kind: "KOSZT", category: "Biuro - czynsz", amountGr: -300_000 },
];

const MANUAL: RwManualLike[] = [
  { month: 1, key: "zysk_estymacja", valueNum: 10_000, valueText: null }, // 10 000 zł
  { month: 1, key: "nowi_klienci", valueNum: 3, valueText: null },
  { month: 3, key: "zysk_estymacja", valueNum: -13_000, valueText: null },
];

describe("buildRwReport — formuły miesięczne", () => {
  const report = buildRwReport(2026, ENTRIES, MANUAL);
  const jan = report.months[0];

  it("sumy przychodów per kategoria i łącznie", () => {
    expect(jan.revenueByCategory["Abonament marketingowy"]).toBe(1_000_000);
    expect(jan.revenueByCategory["Paczki leadów (stała współpraca)"]).toBe(0);
    expect(jan.revenueTotalGr).toBe(1_550_000);
  });

  it("grupy kosztów i koszty łącznie (bez odłożonych i bez CIT)", () => {
    expect(jan.bucketTotalsGr.DELIVERY).toBe(-500_000);
    expect(jan.bucketTotalsGr.GROWTH).toBe(-300_000);
    expect(jan.bucketTotalsGr.OVERHEAD).toBe(-250_000);
    expect(jan.bucketTotalsGr.ODLOZONE).toBe(-120_000);
    expect(jan.bucketTotalsGr.CIT).toBe(-30_000);
    expect(jan.costsTotalGr).toBe(-1_050_000);
  });

  it("zysk po produkcji, Marża I, zysk, Marża II, zysk po podatkach", () => {
    expect(jan.zyskPoProdukcjiGr).toBe(1_050_000); // 15 500 − 5 000
    expect(jan.marza1).toBeCloseTo(1_050_000 / 1_550_000, 10);
    expect(jan.zyskGr).toBe(500_000); // 15 500 − 10 500
    expect(jan.marza2).toBeCloseTo(500_000 / 1_550_000, 10);
    expect(jan.zyskPoPodatkachGr).toBe(470_000); // 5 000 − 300 zł
  });

  it("udział grup w kosztach i w przychodzie", () => {
    expect(jan.bucketShareOfCosts.DELIVERY).toBeCloseTo(-500_000 / -1_050_000, 10);
    expect(jan.bucketShareOfCosts.OVERHEAD).toBeCloseTo(-250_000 / -1_050_000, 10);
    expect(jan.bucketShareOfRevenue.GROWTH).toBeCloseTo(300_000 / 1_550_000, 10);
  });

  it("LIVE BOA — udziały w przychodzie", () => {
    expect(jan.liveBoa.oszczednosci).toBeCloseTo(100_000 / 1_550_000, 10);
    expect(jan.liveBoa.wlasciciele).toBeCloseTo(200_000 / 1_550_000, 10);
    // operacyjne = (koszty łączne − wypłaty zarządu) / przychód = (10 500 − 2 000) / 15 500
    expect(jan.liveBoa.operacyjne).toBeCloseTo(850_000 / 1_550_000, 10);
    expect(jan.liveBoa.zaliczkaCit).toBe(0);
    expect(jan.liveBoa.cit).toBeCloseTo(30_000 / 1_550_000, 10);
  });

  it("odchylenie zysku = (realizacja − estymacja) / estymacja — konwencja arkusza", () => {
    // estymacja 10 000 zł = 1 000 000 gr; realizacja 500 000 gr
    expect(jan.odchylenie).toBeCloseTo((500_000 - 1_000_000) / 1_000_000, 10); // −50%
    // marzec: estymacja jest, ale MIESIĄC BEZ DANYCH → null (nie mylące −100%)
    expect(report.months[2].hasData).toBe(false);
    expect(report.months[2].odchylenie).toBeNull();
    // luty: brak estymacji → null
    expect(report.months[1].odchylenie).toBeNull();
  });

  it("odchylenie w miesiącu z danymi i ujemną estymacją — znak jak w arkuszu", () => {
    const rep = buildRwReport(2026, [
      { month: 3, kind: "KOSZT", category: "Biuro - czynsz", amountGr: -182_200 },
    ], [
      { month: 3, key: "zysk_estymacja", valueNum: -13_000, valueText: null },
    ]);
    // realizacja −1 822 zł, estymacja −13 000 zł → (−182 200 + 1 300 000)/(−1 300 000) ≈ −85,98%
    expect(rep.months[2].odchylenie).toBeCloseTo((-182_200 + 1_300_000) / -1_300_000, 10);
  });

  it("CAC = |koszty growth| / nowi klienci (tylko miesiące z danymi)", () => {
    expect(jan.cacGr).toBe(100_000); // 3 000 zł / 3 = 1 000 zł
    expect(report.months[1].cacGr).toBeNull();
    // nowi klienci w miesiącu bez danych → null
    const rep = buildRwReport(2026, [], [
      { month: 5, key: "nowi_klienci", valueNum: 4, valueText: null },
    ]);
    expect(rep.months[4].cacGr).toBeNull();
  });

  it("miesiąc bez przychodów: marże null, dzielenia bez wybuchu", () => {
    const feb = report.months[1];
    expect(feb.revenueTotalGr).toBe(0);
    expect(feb.marza1).toBeNull();
    expect(feb.marza2).toBeNull();
    expect(feb.liveBoa.oszczednosci).toBeNull();
    expect(feb.zyskGr).toBe(-300_000);
    expect(feb.bucketShareOfCosts.OVERHEAD).toBeCloseTo(1, 10);
  });

  it("miesiąc bez danych: hasData=false, wszystko zerowe/null", () => {
    const jul = report.months[6];
    expect(jul.hasData).toBe(false);
    expect(jul.revenueTotalGr).toBe(0);
    expect(jul.costsTotalGr).toBe(0);
    expect(jul.bucketShareOfCosts.DELIVERY).toBeNull();
  });
});

describe("buildRwReport — SUMA / ŚREDNIA / rok", () => {
  const report = buildRwReport(2026, ENTRIES, MANUAL);

  it("SUMA roczna", () => {
    expect(report.suma.revenueTotalGr).toBe(1_550_000);
    expect(report.suma.costsTotalGr).toBe(-1_350_000); // −10 500 − 3 000 czynsz
    expect(report.suma.zyskGr).toBe(200_000);
    expect(report.suma.marza2).toBeCloseTo(200_000 / 1_550_000, 10);
  });

  it("ŚREDNIA = SUMA / liczba miesięcy z danymi (tu 2)", () => {
    expect(report.monthsWithData).toEqual([1, 2]);
    expect(report.srednia?.revenueTotalGr).toBe(775_000);
    expect(report.srednia?.costsTotalGr).toBe(-675_000);
  });

  it("brak danych w roku → średnia null", () => {
    const empty = buildRwReport(2027, [], []);
    expect(empty.srednia).toBeNull();
    expect(empty.monthsWithData).toEqual([]);
    expect(empty.suma.zyskGr).toBe(0);
  });

  it("nieznane kategorie trafiają do unknownCategories i nie psują sum", () => {
    const rep = buildRwReport(2026, [
      ...ENTRIES,
      { month: 1, kind: "KOSZT", category: "Kategoria widmo", amountGr: -999_999 },
    ], []);
    expect(rep.unknownCategories).toEqual(["KOSZT: Kategoria widmo"]);
    expect(rep.suma.costsTotalGr).toBe(-1_350_000);
  });

  it("„Inne” przychodowe nie miesza się z „Inne” kosztowym", () => {
    const rep = buildRwReport(2026, [
      { month: 1, kind: "PRZYCHOD", category: "Inne", amountGr: 100_000 },
      { month: 1, kind: "KOSZT", category: "Inne", amountGr: -40_000 },
    ], []);
    expect(rep.months[0].revenueByCategory["Inne"]).toBe(100_000);
    expect(rep.months[0].costByCategory["Inne"]).toBe(-40_000);
    expect(rep.months[0].bucketTotalsGr.OVERHEAD).toBe(-40_000);
    expect(rep.months[0].revenueTotalGr).toBe(100_000);
  });
});
