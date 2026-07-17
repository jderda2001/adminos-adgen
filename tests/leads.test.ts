// Testy ekonomiki leadów (lib/leads.ts) — CPL, wycena dostaw wg kampanii
// (CPL marki / średnia ważona wertykalu / brak kampanii) i ostrzeżenia.
// Wartości policzone ręcznie.

import { describe, expect, it } from "vitest";
import { buildLeadCosts, cplGr, type LeadCampaignInput, type LeadDeliveryInput } from "@/lib/leads";

const P = "2026-07";

function campaign(over: Partial<LeadCampaignInput>): LeadCampaignInput {
  return { brandId: "brandA", period: P, vertical: "SKD", spendGr: 0, leadsCount: 0, ...over };
}
function delivery(over: Partial<LeadDeliveryInput> & { id: string }): LeadDeliveryInput {
  return { period: P, clientId: "clientA", vertical: "SKD", brandId: "brandA", leadsCount: 0, ...over };
}

describe("cplGr", () => {
  it("12 900 zł / 430 leadów → 30 zł (3000 gr)", () => {
    expect(cplGr(1_290_000, 430)).toBe(3000);
  });
  it("0 leadów → null (bez dzielenia przez zero)", () => {
    expect(cplGr(1_290_000, 0)).toBeNull();
  });
  it("spend 0 → CPL 0", () => {
    expect(cplGr(0, 100)).toBe(0);
  });
});

describe("buildLeadCosts", () => {
  it("Pełne przypisanie: 430 leadów × 30 zł — koszty 12 000 zł i 900 zł, suma = spend", () => {
    const campaigns = [campaign({ spendGr: 1_290_000, leadsCount: 430 })];
    const deliveries = [
      delivery({ id: "d1", clientId: "clientA", leadsCount: 400 }),
      delivery({ id: "d2", clientId: "clientB", leadsCount: 30 }),
    ];
    const r = buildLeadCosts(deliveries, campaigns);

    expect(r.perDelivery).toHaveLength(2);
    expect(r.perDelivery[0]).toMatchObject({ clientId: "clientA", costGr: 1_200_000, cplGr: 3000, source: "MARKA" });
    expect(r.perDelivery[1]).toMatchObject({ clientId: "clientB", costGr: 90_000, cplGr: 3000, source: "MARKA" });

    const perClient = Object.fromEntries(r.perClient.map((c) => [c.clientId, c.leadCostGr]));
    expect(perClient).toEqual({ clientA: 1_200_000, clientB: 90_000 });
    // pełne przypisanie: suma kosztów = spend kampanii
    expect(1_200_000 + 90_000).toBe(1_290_000);
    expect(r.warnings).toEqual([]);
  });

  it("brand null (mix) → średnia ważona wertykalu z 2 marek", () => {
    const campaigns = [
      campaign({ brandId: "brandA", spendGr: 1_290_000, leadsCount: 430 }),
      campaign({ brandId: "brandB", spendGr: 240_000, leadsCount: 60 }),
    ];
    // średnia: (1 290 000 + 240 000) / (430 + 60) = 1 530 000 / 490
    const r = buildLeadCosts([delivery({ id: "d1", brandId: null, leadsCount: 100 })], campaigns);
    expect(r.perDelivery[0].costGr).toBe(Math.round((100 * 1_530_000) / 490)); // 312 245
    expect(r.perDelivery[0].source).toBe("SREDNIA_WERTYKALU");
    expect(r.perDelivery[0].cplGr).toBe(Math.round(1_530_000 / 490)); // 3122
    expect(r.warnings).toEqual([]);
  });

  it("marka bez kampanii → fallback średnia wertykalu + ostrzeżenie BRAK_KAMPANII_MARKI", () => {
    const campaigns = [campaign({ brandId: "brandB", spendGr: 240_000, leadsCount: 60 })];
    const r = buildLeadCosts([delivery({ id: "d1", brandId: "brandC", leadsCount: 10 })], campaigns);
    expect(r.perDelivery[0]).toMatchObject({ costGr: 40_000, source: "SREDNIA_WERTYKALU" }); // 10 × 4000
    expect(r.warnings).toEqual([
      { kind: "BRAK_KAMPANII_MARKI", period: P, vertical: "SKD", brandId: "brandC" },
    ]);
  });

  it("wertykal bez żadnej kampanii → koszt 0, cpl null + BRAK_KAMPANII_WERTYKALU", () => {
    const r = buildLeadCosts([delivery({ id: "d1", vertical: "OZE", leadsCount: 50 })], []);
    expect(r.perDelivery[0]).toMatchObject({ costGr: 0, cplGr: null, source: "BRAK_KAMPANII" });
    expect(r.warnings).toContainEqual({
      kind: "BRAK_KAMPANII_WERTYKALU", period: P, vertical: "OZE", brandId: null,
    });
    expect(r.perClient).toEqual([{ clientId: "clientA", leadCostGr: 0 }]);
  });

  it("kampania spend>0 leads=0 → KAMPANIA_BEZ_LEADOW; jej spend wchodzi do średniej wertykalu", () => {
    const campaigns = [
      campaign({ brandId: "brandA", spendGr: 100_000, leadsCount: 0 }), // testowa, bez leadów
      campaign({ brandId: "brandB", spendGr: 200_000, leadsCount: 100 }),
    ];
    // średnia wertykalu: (100 000 + 200 000) / 100 = 3000 gr/lead
    const r = buildLeadCosts([delivery({ id: "d1", brandId: null, leadsCount: 10 })], campaigns);
    expect(r.perDelivery[0].costGr).toBe(30_000);
    expect(r.warnings).toContainEqual({
      kind: "KAMPANIA_BEZ_LEADOW", period: P, vertical: "SKD", brandId: "brandA",
    });
  });

  it("dostawa na markę z kampanią 0 leadów → fallback średnia + oba ostrzeżenia", () => {
    const campaigns = [
      campaign({ brandId: "brandA", spendGr: 100_000, leadsCount: 0 }),
      campaign({ brandId: "brandB", spendGr: 200_000, leadsCount: 100 }),
    ];
    const r = buildLeadCosts([delivery({ id: "d1", brandId: "brandA", leadsCount: 10 })], campaigns);
    expect(r.perDelivery[0].source).toBe("SREDNIA_WERTYKALU");
    const kinds = r.warnings.map((w) => w.kind).sort();
    expect(kinds).toEqual(["BRAK_KAMPANII_MARKI", "KAMPANIA_BEZ_LEADOW"]);
  });

  it("zaokrąglenia per-dostawa: 100 gr / 3 leady, dostawy 1+1+1 → 33×3 = 99 (1 gr driftu)", () => {
    const campaigns = [campaign({ spendGr: 100, leadsCount: 3 })];
    const deliveries = [
      delivery({ id: "d1", clientId: "a", leadsCount: 1 }),
      delivery({ id: "d2", clientId: "b", leadsCount: 1 }),
      delivery({ id: "d3", clientId: "c", leadsCount: 1 }),
    ];
    const r = buildLeadCosts(deliveries, campaigns);
    const total = r.perDelivery.reduce((s, x) => s + x.costGr, 0);
    expect(r.perDelivery.every((x) => x.costGr === 33)).toBe(true);
    expect(total).toBe(99); // drift 1 gr → pochłonie „nieprzypisany spend" w rentowności
  });

  it("kilka dostaw tego samego klienta sumuje się w perClient", () => {
    const campaigns = [campaign({ spendGr: 300_000, leadsCount: 100 })];
    const r = buildLeadCosts(
      [
        delivery({ id: "d1", leadsCount: 10 }),
        delivery({ id: "d2", leadsCount: 5 }),
      ],
      campaigns
    );
    expect(r.perClient).toEqual([{ clientId: "clientA", leadCostGr: 45_000 }]);
  });

  it("różne miesiące i wertykale nie mieszają się", () => {
    const campaigns = [
      campaign({ period: "2026-06", spendGr: 100_000, leadsCount: 100 }), // CPL 1000
      campaign({ period: "2026-07", spendGr: 400_000, leadsCount: 100 }), // CPL 4000
    ];
    const r = buildLeadCosts(
      [
        delivery({ id: "d1", period: "2026-06", leadsCount: 10 }),
        delivery({ id: "d2", period: "2026-07", leadsCount: 10 }),
      ],
      campaigns
    );
    expect(r.perDelivery[0].costGr).toBe(10_000);
    expect(r.perDelivery[1].costGr).toBe(40_000);
  });

  it("puste wejścia → puste wyniki", () => {
    expect(buildLeadCosts([], [])).toEqual({ perClient: [], perDelivery: [], warnings: [] });
  });
});
