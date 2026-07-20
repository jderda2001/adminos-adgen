// Testy ekonomiki marek wewnętrznych (lib/brand-econ.ts).

import { describe, expect, it } from "vitest";
import { buildBrandEconomics, daysLeftInMonth } from "@/lib/brand-econ";

const BRANDS = [
  { id: "rst", name: "Restartiz" },
  { id: "reb", name: "Rebalancer" },
];

describe("buildBrandEconomics", () => {
  it("liczy spend, leady i CPL per marka", () => {
    const rows = buildBrandEconomics({
      brands: BRANDS,
      campaigns: [
        { brandId: "rst", spendGr: 320_000, leadsCount: 140 },
        { brandId: "rst", spendGr: 140_000, leadsCount: 31 },
        { brandId: "reb", spendGr: 100_000, leadsCount: 20 },
      ],
      deliveries: [],
      unitPriceByClientVertical: new Map(),
      unitPriceByVertical: {},
      budgets: new Map(),
      accounts: [],
    });
    const rst = rows.find((r) => r.brandId === "rst")!;
    expect(rst.spendGr).toBe(460_000);
    expect(rst.leadsCount).toBe(171);
    expect(rst.cplGr).toBe(Math.round(460_000 / 171));
  });

  it("przychód: cena klient×wertykal wygrywa, fallback cena wertykalu, reszta unpriced", () => {
    const rows = buildBrandEconomics({
      brands: BRANDS,
      campaigns: [],
      deliveries: [
        { brandId: "rst", clientId: "votum", vertical: "SKD", leadsCount: 100 }, // cena klienta 90 zł
        { brandId: "rst", clientId: "bevalex", vertical: "SKD", leadsCount: 30 }, // fallback 80 zł
        { brandId: "rst", clientId: "x", vertical: "OZE", leadsCount: 5 }, // brak ceny
        { brandId: null, clientId: "mix", vertical: "SKD", leadsCount: 999 }, // mix — poza kartą
      ],
      unitPriceByClientVertical: new Map([["votum|SKD", 9_000]]),
      unitPriceByVertical: { SKD: 8_000 },
      budgets: new Map(),
      accounts: [],
    });
    const rst = rows.find((r) => r.brandId === "rst")!;
    expect(rst.deliveredLeads).toBe(135);
    expect(rst.revenueGr).toBe(100 * 9_000 + 30 * 8_000);
    expect(rst.unpricedLeads).toBe(5);
  });

  it("marża = przychód − spend; procent od przychodu", () => {
    const rows = buildBrandEconomics({
      brands: [BRANDS[0]],
      campaigns: [{ brandId: "rst", spendGr: 460_000, leadsCount: 171 }],
      deliveries: [{ brandId: "rst", clientId: "votum", vertical: "SKD", leadsCount: 138 }],
      unitPriceByClientVertical: new Map(),
      unitPriceByVertical: { SKD: 10_000 },
      budgets: new Map(),
      accounts: [],
    });
    expect(rows[0].marginGr).toBe(1_380_000 - 460_000);
    expect(rows[0].marginPct).toBeCloseTo((1_380_000 - 460_000) / 1_380_000, 6);
  });

  it("budżet: remaining i usedPct; brak budżetu → null", () => {
    const rows = buildBrandEconomics({
      brands: BRANDS,
      campaigns: [{ brandId: "rst", spendGr: 460_000, leadsCount: 171 }],
      deliveries: [],
      unitPriceByClientVertical: new Map(),
      unitPriceByVertical: {},
      budgets: new Map([["rst", 700_000]]),
      accounts: [],
    });
    const rst = rows.find((r) => r.brandId === "rst")!;
    expect(rst.remainingGr).toBe(240_000);
    expect(rst.usedPct).toBe(66);
    const reb = rows.find((r) => r.brandId === "reb")!;
    expect(reb.budgetGr).toBeNull();
    expect(reb.remainingGr).toBeNull();
  });

  it("przepał budżetu → remaining ujemny, usedPct > 100", () => {
    const rows = buildBrandEconomics({
      brands: [BRANDS[0]],
      campaigns: [{ brandId: "rst", spendGr: 800_000, leadsCount: 100 }],
      deliveries: [],
      unitPriceByClientVertical: new Map(),
      unitPriceByVertical: {},
      budgets: new Map([["rst", 700_000]]),
      accounts: [],
    });
    expect(rows[0].remainingGr).toBe(-100_000);
    expect(rows[0].usedPct).toBe(114);
  });

  it("konta: tylko przypisane i nieignorowane, posortowane", () => {
    const rows = buildBrandEconomics({
      brands: [BRANDS[0]],
      campaigns: [],
      deliveries: [],
      unitPriceByClientVertical: new Map(),
      unitPriceByVertical: {},
      budgets: new Map(),
      accounts: [
        { brandId: "rst", adAccountName: "Fides", ignored: false },
        { brandId: "rst", adAccountName: "33Bots", ignored: false },
        { brandId: "rst", adAccountName: "Stare", ignored: true },
        { brandId: null, adAccountName: "Klient", ignored: false },
      ],
    });
    expect(rows[0].accountNames).toEqual(["33Bots", "Fides"]);
  });

  it("marka bez danych → zera i nulle (karta „pusta”)", () => {
    const rows = buildBrandEconomics({
      brands: [BRANDS[1]],
      campaigns: [],
      deliveries: [],
      unitPriceByClientVertical: new Map(),
      unitPriceByVertical: {},
      budgets: new Map(),
      accounts: [],
    });
    expect(rows[0].spendGr).toBe(0);
    expect(rows[0].cplGr).toBeNull();
    expect(rows[0].marginGr).toBeNull();
  });
});

describe("daysLeftInMonth", () => {
  it("bieżący miesiąc: dni do końca łącznie z dziś", () => {
    expect(daysLeftInMonth("2026-07", new Date(Date.UTC(2026, 6, 20)))).toBe(12);
    expect(daysLeftInMonth("2026-07", new Date(Date.UTC(2026, 6, 31)))).toBe(1);
  });
  it("miesiąc przeszły → 0, przyszły → pełna długość", () => {
    expect(daysLeftInMonth("2026-06", new Date(Date.UTC(2026, 6, 20)))).toBe(0);
    expect(daysLeftInMonth("2026-08", new Date(Date.UTC(2026, 6, 20)))).toBe(31);
    expect(daysLeftInMonth("2026-02", new Date(Date.UTC(2026, 0, 1)))).toBe(28);
  });
});
