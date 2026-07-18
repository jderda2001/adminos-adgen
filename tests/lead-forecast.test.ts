// Testy prognozy leadów (lib/lead-forecast.ts) — run-rate + scenariusze CPL/wolumen.

import { describe, expect, it } from "vitest";
import { buildLeadForecast, type LeadForecastInput } from "@/lib/lead-forecast";

const HISTORY = ["2026-05", "2026-06", "2026-07"];

function input(over: Partial<LeadForecastInput> = {}): LeadForecastInput {
  return {
    historyMonths: HISTORY,
    deliveries: [
      { period: "2026-05", vertical: "SKD", leadsCount: 300 },
      { period: "2026-06", vertical: "SKD", leadsCount: 300 },
      { period: "2026-07", vertical: "SKD", leadsCount: 300 },
    ],
    campaigns: [
      { period: "2026-05", vertical: "SKD", spendGr: 900_000, leadsCount: 300 },
      { period: "2026-06", vertical: "SKD", spendGr: 900_000, leadsCount: 300 },
      { period: "2026-07", vertical: "SKD", spendGr: 900_000, leadsCount: 300 },
    ],
    unitPriceByVertical: { SKD: 5000 }, // 50 zł/lead
    scenario: { cplMultiplier: 1, volumeMultiplier: 1 },
    ...over,
  };
}

describe("buildLeadForecast", () => {
  it("run-rate bazowy: 300 leadów/mies, CPL 30 zł, cena 50 zł → przychód 15 000, koszt 9 000, marża 6 000", () => {
    const r = buildLeadForecast(input());
    expect(r.perVertical).toHaveLength(1);
    const skd = r.perVertical[0];
    expect(skd.leadsPerMonth).toBe(300);
    expect(skd.baseCplGr).toBe(3000);
    expect(skd.cplGr).toBe(3000);
    expect(skd.revenueGr).toBe(1_500_000);
    expect(skd.adCostGr).toBe(900_000);
    expect(skd.marginGr).toBe(600_000);
    expect(r.totals).toMatchObject({
      leadsPerMonth: 300,
      revenueGr: 1_500_000,
      adCostGr: 900_000,
      marginGr: 600_000,
      hasUnknownPrice: false,
    });
  });

  it("scenariusz CPL +20% → koszt reklamowy rośnie, marża spada", () => {
    const r = buildLeadForecast(input({ scenario: { cplMultiplier: 1.2, volumeMultiplier: 1 } }));
    const skd = r.perVertical[0];
    expect(skd.cplGr).toBe(3600); // 3000 × 1.2
    expect(skd.adCostGr).toBe(300 * 3600); // 1 080 000
    expect(skd.marginGr).toBe(1_500_000 - 1_080_000); // 420 000
  });

  it("scenariusz wolumen +50% → więcej leadów, przychód i koszt skalują się", () => {
    const r = buildLeadForecast(input({ scenario: { cplMultiplier: 1, volumeMultiplier: 1.5 } }));
    const skd = r.perVertical[0];
    expect(skd.leadsPerMonth).toBe(450);
    expect(skd.revenueGr).toBe(450 * 5000); // 2 250 000
    expect(skd.adCostGr).toBe(450 * 3000); // 1 350 000
  });

  it("brak ceny wertykalu → przychód/marża null, flaga hasUnknownPrice", () => {
    const r = buildLeadForecast(input({ unitPriceByVertical: {} }));
    const skd = r.perVertical[0];
    expect(skd.unitPriceGr).toBeNull();
    expect(skd.revenueGr).toBeNull();
    expect(skd.marginGr).toBeNull();
    expect(skd.adCostGr).toBe(900_000); // koszt liczony mimo braku ceny
    expect(r.totals.hasUnknownPrice).toBe(true);
  });

  it("dostawy bez kampanii → CPL null, koszt 0 (nie ma z czego liczyć)", () => {
    const r = buildLeadForecast(input({ campaigns: [] }));
    const skd = r.perVertical[0];
    expect(skd.baseCplGr).toBeNull();
    expect(skd.adCostGr).toBe(0);
    expect(skd.revenueGr).toBe(1_500_000);
    expect(skd.marginGr).toBe(1_500_000);
  });

  it("miesiące spoza historii są ignorowane w run-rate", () => {
    const r = buildLeadForecast(
      input({
        deliveries: [
          { period: "2026-07", vertical: "SKD", leadsCount: 300 },
          { period: "2026-01", vertical: "SKD", leadsCount: 9999 }, // poza historią
        ],
      })
    );
    // tylko 1 miesiąc w oknie z danymi, ale run-rate dzieli przez |history|=3 → 100
    expect(r.perVertical[0].leadsPerMonth).toBe(100);
  });

  it("puste wejście → puste wyniki", () => {
    const r = buildLeadForecast(input({ deliveries: [], campaigns: [] }));
    expect(r.perVertical).toEqual([]);
    expect(r.totals.revenueGr).toBe(0);
  });
});
