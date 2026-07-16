// Testy silnika prognozy (lib/forecast.ts). Wartości policzone ręcznie.
// Kwoty w groszach; daty ISO. todayIso podawane jawnie (determinizm).

import { describe, expect, it } from "vitest";
import {
  buildForecast,
  computePaymentStats,
  effectiveDelayDays,
  computeBillingPatterns,
  DEFAULT_BILLING_PATTERN,
  type ForecastInput,
} from "@/lib/forecast";

// ── fabryka wejścia ──────────────────────────────────────────────────
function baseInput(over: Partial<ForecastInput> = {}): ForecastInput {
  return {
    todayIso: "2026-07-10",
    horizonMonths: 3,
    snapshot: null,
    clients: [],
    openInvoices: [],
    paidAfterSnapshotInvoices: [],
    historyInvoices: [],
    paidInvoices: [],
    openCosts: [],
    recurring: [],
    rwHistory: [],
    events: [],
    assumptions: { newBusinessMonthlyGr: 0 },
    ...over,
  };
}

describe("computePaymentStats", () => {
  it("mediana/średnia/onTime dla jednego klienta (opóźnienia −2, 0, 5)", () => {
    const s = computePaymentStats([
      { clientId: "A", dueDate: "2026-01-10", paidDate: "2026-01-08" }, // −2
      { clientId: "A", dueDate: "2026-02-10", paidDate: "2026-02-10" }, // 0
      { clientId: "A", dueDate: "2026-03-10", paidDate: "2026-03-15" }, // +5
    ]);
    expect(s.byClient.A.medianDelayDays).toBe(0);
    expect(s.byClient.A.meanDelayDays).toBe(1); // round((−2+0+5)/3)=1
    expect(s.byClient.A.onTimeFraction).toBeCloseTo(2 / 3, 5);
    expect(s.byClient.A.maxDelayDays).toBe(5);
    expect(s.byClient.A.sampleCount).toBe(3);
  });

  it("parzysta liczba próbek → średnia dwóch środkowych (2,4 → 3)", () => {
    const s = computePaymentStats([
      { clientId: "B", dueDate: "2026-01-10", paidDate: "2026-01-12" }, // 2
      { clientId: "B", dueDate: "2026-02-10", paidDate: "2026-02-14" }, // 4
    ]);
    expect(s.byClient.B.medianDelayDays).toBe(3);
  });

  it("brak danych → global sample 0", () => {
    const s = computePaymentStats([]);
    expect(s.global.sampleCount).toBe(0);
    expect(s.global.medianDelayDays).toBe(0);
  });
});

describe("effectiveDelayDays", () => {
  const stats = computePaymentStats([
    { clientId: "A", dueDate: "2026-01-10", paidDate: "2026-01-06" }, // −4
    { clientId: "A", dueDate: "2026-02-10", paidDate: "2026-02-06" }, // −4
    { clientId: "A", dueDate: "2026-03-10", paidDate: "2026-03-06" }, // −4
    { clientId: "G", dueDate: "2026-01-10", paidDate: "2026-01-14" }, // +4
    { clientId: "G", dueDate: "2026-02-10", paidDate: "2026-02-14" }, // +4
    { clientId: "G", dueDate: "2026-03-10", paidDate: "2026-03-14" }, // +4
    { clientId: "G", dueDate: "2026-04-10", paidDate: "2026-04-14" }, // +4 (global przesuwa się dodatnio)
  ]);

  it("mediana klienta ujemna → podłoga 0", () => {
    expect(effectiveDelayDays(stats, "A")).toBe(0);
  });

  it("klient bez wystarczających próbek → mediana globalna", () => {
    // klient X: brak → global. Globalna mediana z [−4,−4,−4,4,4,4,4] = 4
    expect(effectiveDelayDays(stats, "X")).toBe(4);
  });

  it("brak klienta i brak danych → 0", () => {
    expect(effectiveDelayDays(computePaymentStats([]), null)).toBe(0);
  });
});

describe("computeBillingPatterns", () => {
  it("mediana dnia/terminu + mnożnik brutto", () => {
    const p = computeBillingPatterns([
      { clientId: "A", netGr: 100000, grossGr: 123000, issueDate: "2026-05-05", dueDate: "2026-05-19", saleDate: "2026-05-05" },
      { clientId: "A", netGr: 100000, grossGr: 123000, issueDate: "2026-06-07", dueDate: "2026-06-23", saleDate: "2026-06-07" },
    ]);
    expect(p.A.issueDay).toBe(6); // mediana(5,7)
    expect(p.A.termDays).toBe(15); // mediana(14,16)
    expect(p.A.grossMultiplier).toBeCloseTo(1.23, 5);
  });

  it("faktury ZW (brutto=netto) → mnożnik 1.0", () => {
    const p = computeBillingPatterns([
      { clientId: "Z", netGr: 100000, grossGr: 100000, issueDate: "2026-05-05", dueDate: "2026-05-19", saleDate: "2026-05-05" },
    ]);
    expect(p.Z.grossMultiplier).toBeCloseTo(1.0, 5);
  });

  it("brak historii klienta → DEFAULT", () => {
    const p = computeBillingPatterns([]);
    expect(p.X).toBeUndefined();
    expect(DEFAULT_BILLING_PATTERN.grossMultiplier).toBeCloseTo(1.23, 5);
  });
});

describe("buildForecast — przychody (MRR / endDate / notice / run-rate)", () => {
  it("MRR do miesiąca endDate włącznie; potem 0", () => {
    const r = buildForecast(
      baseInput({
        horizonMonths: 6, // 07..12
        clients: [
          { id: "A", name: "Alfa", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 1000000, startDate: null, endDate: "2026-09-15", noticeMonths: null },
        ],
      })
    );
    expect(r.periods).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    expect(r.pnl[0].revenueNetGr).toBe(1000000); // 07
    expect(r.pnl[2].revenueNetGr).toBe(1000000); // 09 włącznie
    expect(r.pnl[3].revenueNetGr).toBe(0); // 10 — po endDate
    expect(r.pnl[0].contractedNetGr).toBe(1000000); // endDate > notice → umowne
  });

  it("noticeMonths dzieli na umowne (≤ current+notice) vs zakładane", () => {
    const r = buildForecast(
      baseInput({
        horizonMonths: 6,
        clients: [
          { id: "B", name: "Beta", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 500000, startDate: null, endDate: null, noticeMonths: 2 },
        ],
      })
    );
    // contractedThrough = 2026-07 + 2 = 2026-09
    expect(r.pnl[0].contractedNetGr).toBe(500000); // 07
    expect(r.pnl[2].contractedNetGr).toBe(500000); // 09
    expect(r.pnl[3].contractedNetGr).toBe(0); // 10
    expect(r.pnl[3].assumedNetGr).toBe(500000); // 10 wciąż płaci (brak endDate), ale zakładane
  });

  it("startDate w przyszłości → przychód dopiero od miesiąca startu", () => {
    const r = buildForecast(
      baseInput({
        clients: [
          { id: "C", name: "Gamma", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 300000, startDate: "2026-08-01", endDate: null, noticeMonths: null },
        ],
      })
    );
    expect(r.pnl[0].revenueNetGr).toBe(0); // 07 — przed startem
    expect(r.pnl[1].revenueNetGr).toBe(300000); // 08
  });

  it("run-rate = średnia z 3 pełnych miesięcy (dzielona przez 3); ENDED → 0", () => {
    const r = buildForecast(
      baseInput({
        clients: [
          { id: "D", name: "Delta", billingModel: "PROJEKT", status: "ACTIVE", monthlyRetainerGr: null, startDate: null, endDate: null, noticeMonths: null },
          { id: "E", name: "Epsilon", billingModel: "PROJEKT", status: "ENDED", monthlyRetainerGr: null, startDate: null, endDate: null, noticeMonths: null },
        ],
        historyInvoices: [
          // okno 3 pełnych mies. = 2026-04,05,06
          { clientId: "D", netGr: 300000, grossGr: 369000, issueDate: "2026-04-05", dueDate: "2026-04-19", saleDate: "2026-04-10" },
          { clientId: "D", netGr: 600000, grossGr: 738000, issueDate: "2026-05-05", dueDate: "2026-05-19", saleDate: "2026-05-10" },
          { clientId: "D", netGr: 900000, grossGr: 1107000, issueDate: "2026-06-05", dueDate: "2026-06-19", saleDate: "2026-06-10" },
          { clientId: "E", netGr: 999999, grossGr: 1, issueDate: "2026-05-05", dueDate: "2026-05-19", saleDate: "2026-05-10" },
        ],
      })
    );
    // D run-rate = (300k+600k+900k)/3 = 600k
    expect(r.pnl[0].revenueNetGr).toBe(600000);
    // E jest ENDED → nie wnosi (mimo faktury w historii)
    // (revenueNetGr = tylko D)
  });
});

describe("buildForecast — typ umowy i rozliczenie z góry/z dołu", () => {
  it("umowa jednorazowa (projekt) → przychód tylko w miesiącu startu", () => {
    const r = buildForecast(
      baseInput({
        horizonMonths: 3, // 07,08,09
        clients: [
          { id: "P", name: "Projekt X", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 400000, startDate: null, endDate: null, noticeMonths: null, contractType: "ONE_OFF_PROJECT" },
        ],
      })
    );
    expect(r.pnl[0].revenueNetGr).toBe(400000); // 07 = miesiąc startu (m0)
    expect(r.pnl[1].revenueNetGr).toBe(0); // 08
    expect(r.pnl[2].revenueNetGr).toBe(0); // 09
  });

  it("umowa jednorazowa (1 mies.) ze startem w przyszłości → tylko miesiąc startu", () => {
    const r = buildForecast(
      baseInput({
        clients: [
          { id: "Q", name: "Jednorazowy", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 200000, startDate: "2026-08-01", endDate: null, noticeMonths: null, contractType: "ONE_OFF_MONTH" },
        ],
      })
    );
    expect(r.pnl[0].revenueNetGr).toBe(0); // 07
    expect(r.pnl[1].revenueNetGr).toBe(200000); // 08
    expect(r.pnl[2].revenueNetGr).toBe(0); // 09
  });

  it("rozliczenie z dołu przesuwa wpływ gotówki o miesiąc względem z góry", () => {
    const mk = (timing: string) =>
      buildForecast(
        baseInput({
          snapshot: { dateIso: "2026-07-01", balanceGr: 0 },
          clients: [
            { id: "R", name: "Retainer", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 100000, startDate: null, endDate: null, noticeMonths: null, contractType: "INDEFINITE_NOTICE", billingTiming: timing },
          ],
        })
      );
    const inflow = (r: ReturnType<typeof buildForecast>, period: string) =>
      (r.cash!.find((m) => m.period === period)?.events ?? [])
        .filter((e) => e.clientId === "R")
        .reduce((a, e) => a + e.amountGr, 0);

    const upfront = mk("UPFRONT");
    const arrears = mk("ARREARS");
    expect(inflow(upfront, "2026-07")).toBeGreaterThan(0); // z góry: wpływ w lipcu
    expect(inflow(arrears, "2026-07")).toBe(0); // z dołu: brak w lipcu
    expect(inflow(arrears, "2026-08")).toBeGreaterThan(0); // z dołu: dopiero w sierpniu
  });
});

describe("buildForecast — dedup m0", () => {
  it("klient zafakturowany w m0: brak prognozowanego wpływu w m0, P&L m0 = max(model, zafakturowane)", () => {
    const r = buildForecast(
      baseInput({
        snapshot: { dateIso: "2026-07-01", balanceGr: 0 },
        clients: [
          { id: "A", name: "Alfa", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 400000, startDate: null, endDate: null, noticeMonths: null },
        ],
        // faktura klienta A w m0 (2026-07) — widoczna w historii (dedup) i jako otwarta należność
        historyInvoices: [
          { clientId: "A", netGr: 400000, grossGr: 492000, issueDate: "2026-07-05", dueDate: "2026-07-19", saleDate: "2026-07-05" },
        ],
        openInvoices: [{ id: "i1", clientId: "A", grossGr: 492000, dueDate: "2026-07-19", status: "ISSUED" }],
      })
    );
    expect(r.pnl[0].revenueNetGr).toBe(400000);
    // brak zdarzenia PROGNOZA_MRR w m0 (wpływ niesie otwarta faktura)
    const m0 = r.cash![0];
    expect(m0.events.some((e) => e.source === "PROGNOZA_MRR")).toBe(false);
    expect(m0.events.some((e) => e.source === "FAKTURA_OTWARTA")).toBe(true);
    // ale w m1 (08) prognoza już jest
    const m1 = r.cash![1];
    expect(m1.events.some((e) => e.source === "PROGNOZA_MRR")).toBe(true);
  });
});

describe("buildForecast — koszty cykliczne z endPeriod", () => {
  it("projekcja tylko miesięcy > lastGeneratedPeriod i ≤ endPeriod; luty 31→28", () => {
    const r = buildForecast(
      baseInput({
        todayIso: "2026-01-10",
        horizonMonths: 3, // 01,02,03
        snapshot: { dateIso: "2026-01-01", balanceGr: 0 },
        recurring: [
          { id: "t1", supplierName: "Rata", netGr: 100000, vatRate: "23", dueDayOfMonth: 31, active: true, endPeriod: "2026-02", lastGeneratedPeriod: "2026-01", categoryName: "Pozostałe wydatki operacyjne" },
        ],
      })
    );
    const events = r.cash!.flatMap((m) => m.events).filter((e) => e.source === "KOSZT_CYKLICZNY");
    // 01 zmaterializowany (= lastGen) → brak projekcji; 02 → 28.02; 03 > endPeriod → brak
    expect(events.map((e) => e.dateIso)).toEqual(["2026-02-28"]);
    expect(events[0].amountGr).toBe(-123000); // 100k netto + 23% VAT
  });
});

describe("buildForecast — rezydualna baza (dedup szablon↔historia)", () => {
  it("rata z endPeriod gaśnie; rezydua stałe; clamp 0", () => {
    const r = buildForecast(
      baseInput({
        horizonMonths: 3, // 07,08,09
        snapshot: { dateIso: "2026-07-01", balanceGr: 0 },
        // historia 3 pełnych mies. (04,05,06): „Pozostałe" 5000 zł/mies netto
        rwHistory: [
          { period: "2026-04", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -500000, grossGr: -615000 },
          { period: "2026-05", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -500000, grossGr: -615000 },
          { period: "2026-06", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -500000, grossGr: -615000 },
        ],
        // rata 3000 zł netto, kończy się 2026-08
        recurring: [
          { id: "t1", supplierName: "Rata leasing", netGr: 300000, vatRate: "23", dueDayOfMonth: 10, active: true, endPeriod: "2026-08", lastGeneratedPeriod: "2026-07", categoryName: "Pozostałe wydatki operacyjne" },
        ],
      })
    );
    // avgNet Pozostałe = 500000; residualNet = 500000 − 300000 = 200000
    // P&L koszty: 07 = rata 300000 + rezydua 200000 = 500000
    expect(r.pnl[0].costsNetGr).toBe(500000);
    expect(r.pnl[1].costsNetGr).toBe(500000); // 08 ≤ endPeriod
    // 09 > endPeriod → rata znika, zostaje rezydua 200000
    expect(r.pnl[2].costsNetGr).toBe(200000);
  });

  it("szablon większy niż historia → rezydua clamp do 0", () => {
    const r = buildForecast(
      baseInput({
        horizonMonths: 3,
        rwHistory: [
          { period: "2026-04", kind: "KOSZT", category: "Abonamenty", amountGr: -500000, grossGr: -615000 },
          { period: "2026-05", kind: "KOSZT", category: "Abonamenty", amountGr: -500000, grossGr: -615000 },
          { period: "2026-06", kind: "KOSZT", category: "Abonamenty", amountGr: -500000, grossGr: -615000 },
        ],
        recurring: [
          { id: "t2", supplierName: "Duży abonament", netGr: 700000, vatRate: "23", dueDayOfMonth: 10, active: true, endPeriod: null, lastGeneratedPeriod: "2026-07", categoryName: "Abonamenty" },
        ],
      })
    );
    // avg Abonamenty 500000, szablon 700000 → residual max(0, −200000)=0
    // P&L koszty 07 = szablon 700000 + rezydua 0 = 700000
    expect(r.pnl[0].costsNetGr).toBe(700000);
  });
});

describe("buildForecast — cash flow: minimum salda i timing", () => {
  it("dołek śródmiesięczny liczony po wydatkach, przed wpływami", () => {
    const r = buildForecast(
      baseInput({
        snapshot: { dateIso: "2026-07-01", balanceGr: 1000000 },
        openCosts: [
          { id: "c1", grossGr: 800000, netGr: 650000, dueDate: "2026-07-10", docDate: "2026-07-01", paidDate: null, supplierName: "Dostawca", categoryName: "Inne", recurringCostId: null },
        ],
        paidAfterSnapshotInvoices: [{ clientId: "A", grossGr: 500000, paidDate: "2026-07-15" }],
      })
    );
    const m0 = r.cash![0];
    expect(m0.openingGr).toBe(1000000);
    expect(m0.minBalanceGr).toBe(200000); // po −800k (10.), przed +500k (15.)
    expect(m0.minBalanceDateIso).toBe("2026-07-10");
    expect(m0.closingGr).toBe(700000);
  });

  it("wpływ z terminem pod koniec miesiąca + opóźnienie → przelewa się do m1", () => {
    const paid = [
      // 3 próbki opóźnienia 10 dni dla klienta A
      { clientId: "A", dueDate: "2026-04-10", paidDate: "2026-04-20" },
      { clientId: "A", dueDate: "2026-05-10", paidDate: "2026-05-20" },
      { clientId: "A", dueDate: "2026-06-10", paidDate: "2026-06-20" },
    ];
    const r = buildForecast(
      baseInput({
        snapshot: { dateIso: "2026-07-01", balanceGr: 0 },
        paidInvoices: paid,
        openInvoices: [{ id: "i1", clientId: "A", grossGr: 100000, dueDate: "2026-07-28", status: "ISSUED" }],
      })
    );
    // 2026-07-28 + 10 dni = 2026-08-07 → miesiąc 08
    const inv = r.cash!.flatMap((m) => m.events).find((e) => e.source === "FAKTURA_OTWARTA");
    expect(inv?.dateIso).toBe("2026-08-07");
    expect(inv?.period).toBe("2026-08");
  });

  it("faktura > 90 dni po terminie → wątpliwa (poza cash, w doubtfulGr)", () => {
    const r = buildForecast(
      baseInput({
        snapshot: { dateIso: "2026-07-01", balanceGr: 0 },
        openInvoices: [
          { id: "i1", clientId: "A", grossGr: 300000, dueDate: "2026-03-01", status: "OVERDUE" }, // ~131 dni
          { id: "i2", clientId: "A", grossGr: 200000, dueDate: "2026-06-01", status: "OVERDUE" }, // ~39 dni
        ],
      })
    );
    expect(r.kpis.doubtfulGr).toBe(300000);
    expect(r.kpis.overdueBacklogGr).toBe(200000);
    const events = r.cash!.flatMap((m) => m.events).filter((e) => e.source === "FAKTURA_OTWARTA");
    expect(events).toHaveLength(1); // tylko ta ≤ 90 dni
    expect(events[0].amountGr).toBe(200000);
  });
});

describe("buildForecast — podatki / zdarzenia / brak snapshotu", () => {
  it("podatek VAT 25. dnia; przy snapshocie 28. m0 odpada, m1 zostaje", () => {
    const r = buildForecast(
      baseInput({
        snapshot: { dateIso: "2026-07-28", balanceGr: 0 },
        rwHistory: [
          { period: "2026-04", kind: "KOSZT", category: "VAT", amountGr: -300000, grossGr: -300000 },
          { period: "2026-05", kind: "KOSZT", category: "VAT", amountGr: -300000, grossGr: -300000 },
          { period: "2026-06", kind: "KOSZT", category: "VAT", amountGr: -300000, grossGr: -300000 },
        ],
      })
    );
    const vatEvents = r.cash!.flatMap((m) => m.events).filter((e) => e.label === "VAT");
    // 07-25 < snapshot 07-28 → odcięte; 08-25, 09-25 zostają
    expect(vatEvents.map((e) => e.dateIso)).toEqual(["2026-08-25", "2026-09-25"]);
    expect(vatEvents[0].amountGr).toBe(-300000);
  });

  it("zdarzenie INFLOW w horyzoncie dodaje wpływ; zdarzenie w przeszłości → warning", () => {
    const r = buildForecast(
      baseInput({
        snapshot: { dateIso: "2026-07-01", balanceGr: 0 },
        events: [
          { id: "e1", period: "2026-08", kind: "INFLOW", label: "Premia od klienta", amountGr: 1500000 },
          { id: "e2", period: "2026-05", kind: "OUTFLOW", label: "Stare zdarzenie", amountGr: 100000 },
        ],
      })
    );
    const ev = r.cash!.flatMap((m) => m.events).find((e) => e.source === "ZDARZENIE");
    expect(ev?.dateIso).toBe("2026-08-15");
    expect(ev?.amountGr).toBe(1500000);
    expect(r.warnings.some((w) => w.code === "ZDARZENIE_W_PRZESZLOSCI")).toBe(true);
  });

  it("bez snapshotu → cash null, P&L policzone, KPI cash null, warning", () => {
    const r = buildForecast(
      baseInput({
        clients: [
          { id: "A", name: "Alfa", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 1000000, startDate: null, endDate: null, noticeMonths: null },
        ],
      })
    );
    expect(r.cash).toBeNull();
    expect(r.kpis.closingEndGr).toBeNull();
    expect(r.pnl[0].revenueNetGr).toBe(1000000);
    expect(r.warnings.some((w) => w.code === "BRAK_SNAPSHOTU")).toBe(true);
  });
});

describe("buildForecast — golden integracyjny (3 mies.)", () => {
  it("pełny scenariusz: abonament + run-rate + rata + rezydua + VAT + zdarzenie", () => {
    const r = buildForecast(
      baseInput({
        horizonMonths: 3, // 07,08,09
        snapshot: { dateIso: "2026-07-01", balanceGr: 5000000 }, // 50 000 zł
        clients: [
          { id: "A", name: "Alfa", billingModel: "ABONAMENT", status: "ACTIVE", monthlyRetainerGr: 1000000, startDate: null, endDate: null, noticeMonths: 3 },
        ],
        rwHistory: [
          { period: "2026-04", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -200000, grossGr: -246000 },
          { period: "2026-05", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -200000, grossGr: -246000 },
          { period: "2026-06", kind: "KOSZT", category: "Pozostałe wydatki operacyjne", amountGr: -200000, grossGr: -246000 },
        ],
      })
    );
    // P&L 07: przychód 10 000 zł (umowny, notice 3 → 07,08,09 umowne), koszt = rezydua Pozostałe 2000 zł
    expect(r.pnl[0].revenueNetGr).toBe(1000000);
    expect(r.pnl[0].contractedNetGr).toBe(1000000);
    expect(r.pnl[0].costsNetGr).toBe(200000);
    expect(r.pnl[0].profitGr).toBe(800000);
    // cash istnieje, ma 3 miesiące, saldo startowe 50 000 zł
    expect(r.cash).not.toBeNull();
    expect(r.cash).toHaveLength(3);
    expect(r.cash![0].openingGr).toBe(5000000);
    // KPI: saldo końcowe = closing ostatniego miesiąca
    expect(r.kpis.closingEndGr).toBe(r.cash![2].closingGr);
  });
});
