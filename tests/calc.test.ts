// Testy jednostkowe kluczowych wyliczeń finansowych (lib/calc.ts).
// Wszystkie kwoty w groszach (int).

import { describe, expect, it } from "vitest";
import {
  computeItemAmounts,
  computeVatFromNet,
  sumAmounts,
  effectiveRateGr,
  laborCostGr,
  computeProfitability,
  computePnL,
  computeVatSummary,
  type RateRecord,
} from "@/lib/calc";

// ── computeItemAmounts ───────────────────────────────────────────────

describe("computeItemAmounts", () => {
  it("1 × 10000 gr przy 23% → netto 10000, VAT 2300, brutto 12300", () => {
    expect(computeItemAmounts(1, 10000, "23")).toEqual({
      netGr: 10000,
      vatGr: 2300,
      grossGr: 12300,
    });
  });

  it("ilość 1,5 × 12345 gr → netto 18518 (Math.round z 18517,5)", () => {
    const a = computeItemAmounts(1.5, 12345, "23");
    expect(a.netGr).toBe(18518);
    // VAT liczony od zaokrąglonego netto: round(18518 × 0,23) = round(4259,14) = 4259
    expect(a.vatGr).toBe(4259);
    expect(a.grossGr).toBe(18518 + 4259);
  });

  it("stawka 8%", () => {
    expect(computeItemAmounts(1, 10000, "8")).toEqual({
      netGr: 10000,
      vatGr: 800,
      grossGr: 10800,
    });
  });

  it("stawka 5%", () => {
    expect(computeItemAmounts(2, 5000, "5")).toEqual({
      netGr: 10000,
      vatGr: 500,
      grossGr: 10500,
    });
  });

  it("stawka 0%", () => {
    expect(computeItemAmounts(1, 10000, "0")).toEqual({
      netGr: 10000,
      vatGr: 0,
      grossGr: 10000,
    });
  });

  it("stawka ZW (zwolnione)", () => {
    expect(computeItemAmounts(1, 10000, "ZW")).toEqual({
      netGr: 10000,
      vatGr: 0,
      grossGr: 10000,
    });
  });

  it("VAT zaokrąglany do grosza (ilość ułamkowa, stawka 8%)", () => {
    const a = computeItemAmounts(1.5, 12345, "8");
    // round(18518 × 0,08) = round(1481,44) = 1481
    expect(a.vatGr).toBe(1481);
    expect(a.grossGr).toBe(18518 + 1481);
  });
});

// ── computeVatFromNet ────────────────────────────────────────────────

describe("computeVatFromNet", () => {
  it("23%: 10000 → VAT 2300, brutto 12300", () => {
    expect(computeVatFromNet(10000, "23")).toEqual({
      netGr: 10000,
      vatGr: 2300,
      grossGr: 12300,
    });
  });

  it("8%: 10000 → VAT 800", () => {
    expect(computeVatFromNet(10000, "8")).toEqual({
      netGr: 10000,
      vatGr: 800,
      grossGr: 10800,
    });
  });

  it("5%: 10000 → VAT 500", () => {
    expect(computeVatFromNet(10000, "5")).toEqual({
      netGr: 10000,
      vatGr: 500,
      grossGr: 10500,
    });
  });

  it("0%: 10000 → VAT 0", () => {
    expect(computeVatFromNet(10000, "0")).toEqual({
      netGr: 10000,
      vatGr: 0,
      grossGr: 10000,
    });
  });

  it("ZW: 10000 → VAT 0", () => {
    expect(computeVatFromNet(10000, "ZW")).toEqual({
      netGr: 10000,
      vatGr: 0,
      grossGr: 10000,
    });
  });

  it("zaokrągla VAT do grosza: 333 gr × 23% → 77 gr (round z 76,59)", () => {
    expect(computeVatFromNet(333, "23").vatGr).toBe(77);
  });
});

// ── sumAmounts ───────────────────────────────────────────────────────

describe("sumAmounts", () => {
  it("sumuje netto/VAT/brutto pozycji", () => {
    const sum = sumAmounts([
      { netGr: 10000, vatGr: 2300, grossGr: 12300 },
      { netGr: 5000, vatGr: 400, grossGr: 5400 },
      { netGr: 100, vatGr: 0, grossGr: 100 },
    ]);
    expect(sum).toEqual({ netGr: 15100, vatGr: 2700, grossGr: 17800 });
  });

  it("pusta lista → same zera", () => {
    expect(sumAmounts([])).toEqual({ netGr: 0, vatGr: 0, grossGr: 0 });
  });
});

// ── effectiveRateGr / laborCostGr ────────────────────────────────────

describe("effectiveRateGr", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
  // celowo w kolejności od najnowszej — wybór ma zależeć od dat, nie od kolejności tablicy
  const rates: RateRecord[] = [
    { ratePerHourGr: 12000, validFrom: d("2026-06-01") },
    { ratePerHourGr: 10000, validFrom: d("2026-01-01") },
  ];

  it("brak stawek → 0", () => {
    expect(effectiveRateGr([], d("2026-07-03"))).toBe(0);
  });

  it("data przed pierwszą validFrom → 0", () => {
    expect(effectiveRateGr(rates, d("2025-12-31"))).toBe(0);
  });

  it("wybiera najnowszą stawkę z validFrom <= dacie", () => {
    expect(effectiveRateGr(rates, d("2026-05-31"))).toBe(10000);
    expect(effectiveRateGr(rates, d("2026-07-03"))).toBe(12000);
  });

  it("dokładnie w dniu validFrom obowiązuje już nowa stawka", () => {
    expect(effectiveRateGr(rates, d("2026-01-01"))).toBe(10000);
    expect(effectiveRateGr(rates, d("2026-06-01"))).toBe(12000);
  });
});

describe("laborCostGr", () => {
  it("90 min × 12000 gr/h = 18000 gr", () => {
    expect(laborCostGr(90, 12000)).toBe(18000);
  });

  it("zaokrągla do grosza: 50 min × 10000 gr/h → 8333 gr", () => {
    // 50 × 10000 / 60 = 8333,33…
    expect(laborCostGr(50, 10000)).toBe(8333);
  });

  it("0 minut → 0", () => {
    expect(laborCostGr(0, 12000)).toBe(0);
  });
});

// ── computePnL / computeVatSummary ───────────────────────────────────

describe("computePnL", () => {
  it("liczy zysk i marżę", () => {
    const pnl = computePnL(100000, 25000);
    expect(pnl.profitGr).toBe(75000);
    expect(pnl.marginFraction).toBe(0.75);
  });

  it("marża null przy zerowych przychodach", () => {
    const pnl = computePnL(0, 5000);
    expect(pnl.profitGr).toBe(-5000);
    expect(pnl.marginFraction).toBeNull();
  });

  it("marża ujemna przy stracie", () => {
    const pnl = computePnL(10000, 15000);
    expect(pnl.profitGr).toBe(-5000);
    expect(pnl.marginFraction).toBe(-0.5);
  });
});

describe("computeVatSummary", () => {
  it("VAT do zapłaty = należny − naliczony", () => {
    expect(computeVatSummary(2300, 800)).toEqual({
      outputVatGr: 2300,
      inputVatGr: 800,
      dueGr: 1500,
    });
  });

  it("nadwyżka naliczonego → ujemne dueGr", () => {
    expect(computeVatSummary(800, 2300).dueGr).toBe(-1500);
  });
});

// ── computeProfitability ─────────────────────────────────────────────

/** Tożsamość pionowa: suma zysków klientów − niealokowane ogólne − niepokryte pensje = zysk firmy */
function expectVerticalIdentity(r: ReturnType<typeof computeProfitability>) {
  expect(
    r.clientProfitSumGr - r.unallocatedGeneralGr - r.salariesNotCoveredGr
  ).toBe(r.companyProfitGr);
}

describe("computeProfitability", () => {
  const SALARY = "kat-wynagrodzenia";

  // Scenariusz bazowy: 2 klientów, koszty bezpośrednie, koszt pracy,
  // koszty ogólne pozapłacowe (pula 200000) + koszty wynagrodzeń (350000).
  const baseInput = {
    revenues: [
      { clientId: "A", netGr: 600000 },
      { clientId: "B", netGr: 400000 },
    ],
    costs: [
      { clientId: "A", categoryId: "kat-podwykonawcy", netGr: 100000 },
      { clientId: "B", categoryId: "kat-narzedzia", netGr: 50000 },
      { clientId: null, categoryId: "kat-biuro", netGr: 200000 },
      { clientId: null, categoryId: SALARY, netGr: 300000 },
      // wynagrodzenie przypisane do klienta — też poza kosztami bezpośrednimi
      { clientId: "A", categoryId: SALARY, netGr: 50000 },
    ],
    labor: [
      { clientId: "A", minutes: 600, laborGr: 120000 },
      { clientId: "B", minutes: 300, laborGr: 60000 },
    ],
    salaryCategoryIds: new Set([SALARY]),
  };

  it("a) alokacja włączona: proporcjonalnie do przychodów, wynagrodzenia poza pulą i poza kosztami bezpośrednimi, tożsamość pionowa", () => {
    const r = computeProfitability({ ...baseInput, allocationEnabled: true });

    // pula alokacji = tylko koszty ogólne pozapłacowe
    expect(r.generalPoolGr).toBe(200000);
    // wynagrodzenia (ogólne 300000 + przypisane 50000) w salaryCostsGr
    expect(r.salaryCostsGr).toBe(350000);
    expect(r.laborTotalGr).toBe(180000);
    expect(r.salariesNotCoveredGr).toBe(350000 - 180000);

    const a = r.rows.find((x) => x.clientId === "A")!;
    const b = r.rows.find((x) => x.clientId === "B")!;

    // koszty bezpośrednie NIE zawierają wynagrodzeń przypisanych do klienta
    expect(a.directCostsGr).toBe(100000);
    expect(b.directCostsGr).toBe(50000);

    // alokacja proporcjonalna do przychodów: 60% / 40% puli 200000
    expect(a.allocationGr).toBe(120000);
    expect(b.allocationGr).toBe(80000);
    expect(r.allocatedGr).toBe(200000);
    expect(r.unallocatedGeneralGr).toBe(0);

    // zyski klientów
    expect(a.profitGr).toBe(600000 - 100000 - 120000 - 120000); // 260000
    expect(b.profitGr).toBe(400000 - 50000 - 60000 - 80000); // 210000
    expect(r.clientProfitSumGr).toBe(470000);

    // zysk firmy = przychody − WSZYSTKIE koszty (razem z wynagrodzeniami)
    expect(r.companyProfitGr).toBe(1000000 - 700000);

    // TOŻSAMOŚĆ PIONOWA co do grosza:
    // 470000 − 0 − 170000 = 300000
    expectVerticalIdentity(r);
  });

  it("b) alokacja wyłączona: allocationGr = 0, unallocatedGeneralGr = cała pula, tożsamość zachodzi", () => {
    const r = computeProfitability({ ...baseInput, allocationEnabled: false });

    for (const row of r.rows) expect(row.allocationGr).toBe(0);
    expect(r.allocatedGr).toBe(0);
    expect(r.unallocatedGeneralGr).toBe(r.generalPoolGr);
    expect(r.unallocatedGeneralGr).toBe(200000);

    const a = r.rows.find((x) => x.clientId === "A")!;
    const b = r.rows.find((x) => x.clientId === "B")!;
    expect(a.profitGr).toBe(600000 - 100000 - 120000); // 380000
    expect(b.profitGr).toBe(400000 - 50000 - 60000); // 290000

    // 670000 − 200000 − 170000 = 300000
    expect(r.companyProfitGr).toBe(300000);
    expectVerticalIdentity(r);
  });

  it("c) zaokrąglenia alokacji: przychody 1/1/1 gr i pula 100 gr — alokacja + niealokowane = pula, tożsamość co do grosza", () => {
    const r = computeProfitability({
      revenues: [
        { clientId: "A", netGr: 1 },
        { clientId: "B", netGr: 1 },
        { clientId: "C", netGr: 1 },
      ],
      costs: [{ clientId: null, categoryId: "kat-biuro", netGr: 100 }],
      labor: [],
      salaryCategoryIds: new Set<string>(),
      allocationEnabled: true,
    });

    // round(100 × 1/3) = 33 dla każdego klienta
    for (const row of r.rows) expect(row.allocationGr).toBe(33);
    expect(r.allocatedGr).toBe(99);
    // reszta z zaokrągleń trafia do niealokowanych
    expect(r.unallocatedGeneralGr).toBe(1);
    expect(r.allocatedGr + r.unallocatedGeneralGr).toBe(100);

    // zysk firmy: 3 − 100 = −97; suma zysków klientów: 3 × (1 − 33) = −96
    expect(r.companyProfitGr).toBe(-97);
    expect(r.clientProfitSumGr).toBe(-96);
    expectVerticalIdentity(r);
  });

  it("d) klient z godzinami bez przychodów i klient z przychodami bez godzin; marża i efektywna stawka", () => {
    const r = computeProfitability({
      revenues: [{ clientId: "R", netGr: 100000 }],
      costs: [],
      labor: [
        { clientId: "H", minutes: 120, laborGr: 20000 },
        { clientId: "R", minutes: 0, laborGr: 0 },
      ],
      salaryCategoryIds: new Set<string>(),
      allocationEnabled: true,
    });

    const h = r.rows.find((x) => x.clientId === "H")!; // godziny, brak przychodów
    const rr = r.rows.find((x) => x.clientId === "R")!; // przychody, brak godzin

    // brak przychodów → marża null
    expect(h.marginFraction).toBeNull();
    expect(h.profitGr).toBe(-20000);
    // UWAGA: wg dokumentacji lib/calc.ts efektywna stawka jest null tylko przy braku
    // godzin; przy godzinach i zerowych przychodach wynosi 0 gr/h (0 / godziny).
    expect(h.effectiveRateGr).toBe(0);

    // brak godzin → efektywna stawka null
    expect(rr.effectiveRateGr).toBeNull();
    // marginFraction = zysk / przychody
    expect(rr.marginFraction).toBe(rr.profitGr / rr.revenueGr);
    expect(rr.marginFraction).toBe(1);

    expectVerticalIdentity(r);
  });

  it("d2) efektywna stawka = przychody / (minuty/60), zaokrąglona do grosza", () => {
    const r = computeProfitability({
      revenues: [{ clientId: "A", netGr: 100000 }],
      costs: [],
      labor: [{ clientId: "A", minutes: 90, laborGr: 30000 }],
      salaryCategoryIds: new Set<string>(),
      allocationEnabled: false,
    });
    const a = r.rows.find((x) => x.clientId === "A")!;
    // 100000 / 1,5 h = 66666,67 → 66667
    expect(a.effectiveRateGr).toBe(66667);
    expect(a.marginFraction).toBe((100000 - 30000) / 100000);
  });

  it("e) brak kategorii wynagrodzeń (pusty zbiór): wszystkie koszty ogólne w puli, salariesNotCovered = −laborTotal, tożsamość zachodzi", () => {
    const r = computeProfitability({
      revenues: [{ clientId: "A", netGr: 100000 }],
      costs: [
        // kategoria "wynagrodzenia" istnieje, ale nie jest wskazana — traktowana zwyczajnie
        { clientId: null, categoryId: "kat-wynagrodzenia", netGr: 40000 },
      ],
      labor: [{ clientId: "A", minutes: 60, laborGr: 20000 }],
      salaryCategoryIds: new Set<string>(),
      allocationEnabled: true,
    });

    expect(r.salaryCostsGr).toBe(0);
    expect(r.generalPoolGr).toBe(40000);
    expect(r.salariesNotCoveredGr).toBe(-20000);

    const a = r.rows.find((x) => x.clientId === "A")!;
    expect(a.allocationGr).toBe(40000);
    expect(a.profitGr).toBe(100000 - 20000 - 40000); // 40000

    // 40000 − 0 − (−20000) = 60000 = 100000 − 40000
    expect(r.companyProfitGr).toBe(60000);
    expectVerticalIdentity(r);
  });

  it("puste wejście → same zera, tożsamość trywialnie zachodzi", () => {
    const r = computeProfitability({
      revenues: [],
      costs: [],
      labor: [],
      salaryCategoryIds: new Set<string>(),
      allocationEnabled: true,
    });
    expect(r.rows).toEqual([]);
    expect(r.companyProfitGr).toBe(0);
    expectVerticalIdentity(r);
  });
});
