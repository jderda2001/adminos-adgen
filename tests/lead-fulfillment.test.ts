// Testy realizacji kontraktów leadowych (lib/lead-fulfillment.ts).

import { describe, expect, it } from "vitest";
import {
  buildDeliveryStatus,
  buildFulfillmentPlan,
  qtyWithGuarantee,
  type InvoiceLeadLine,
  type DeliveryLine,
} from "@/lib/lead-fulfillment";

const inv = (clientId: string, vertical: string, period: string, leadsQty: number): InvoiceLeadLine => ({
  clientId,
  vertical,
  period,
  leadsQty,
});
const del = (clientId: string, vertical: string, period: string, leadsCount: number): DeliveryLine => ({
  clientId,
  vertical,
  period,
  leadsCount,
});

describe("buildDeliveryStatus", () => {
  it("kontrakt z faktur, dostarczone z dostaw, bilans = owed − delivered", () => {
    const s = buildDeliveryStatus(
      "2026-07",
      [inv("votum", "SKD", "2026-07", 400)],
      [del("votum", "SKD", "2026-07", 300)]
    );
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      contractedThisMonth: 400,
      deliveredThisMonth: 300,
      carriedIn: 0,
      owed: 400,
      balance: 100, // 100 leadów do dowiezienia
    });
  });

  it("dług przenosi się z poprzedniego miesiąca (auto-carry)", () => {
    // czerwiec: kontrakt 400, dowieziono 250 → dług 150
    // lipiec: kontrakt 400, dowieziono 300 → zobowiązanie 150+400=550, bilans 250
    const invoices = [inv("v", "SKD", "2026-06", 400), inv("v", "SKD", "2026-07", 400)];
    const deliveries = [del("v", "SKD", "2026-06", 250), del("v", "SKD", "2026-07", 300)];
    const s = buildDeliveryStatus("2026-07", invoices, deliveries)[0];
    expect(s.carriedIn).toBe(150);
    expect(s.owed).toBe(550);
    expect(s.balance).toBe(250);
  });

  it("nadwyżka zmniejsza dług kolejnego miesiąca (carriedIn ujemny)", () => {
    // czerwiec: kontrakt 100, dowieziono 130 → nadwyżka 30
    // lipiec: kontrakt 100 → owed 100−30=70
    const invoices = [inv("v", "OZE", "2026-06", 100), inv("v", "OZE", "2026-07", 100)];
    const deliveries = [del("v", "OZE", "2026-06", 130)];
    const s = buildDeliveryStatus("2026-07", invoices, deliveries)[0];
    expect(s.carriedIn).toBe(-30);
    expect(s.owed).toBe(70);
    expect(s.balance).toBe(70);
  });

  it("miesiące po `month` są ignorowane", () => {
    const s = buildDeliveryStatus(
      "2026-07",
      [inv("v", "SKD", "2026-07", 100), inv("v", "SKD", "2026-08", 999)],
      []
    );
    expect(s[0].contractedThisMonth).toBe(100);
    expect(s[0].balance).toBe(100);
  });

  it("rozdziela wertykały i klientów", () => {
    const s = buildDeliveryStatus(
      "2026-07",
      [inv("a", "SKD", "2026-07", 100), inv("a", "OZE", "2026-07", 50), inv("b", "SKD", "2026-07", 30)],
      []
    );
    expect(s).toHaveLength(3);
  });

  it("puste pary (0 kontrakt, 0 dostawa, 0 bilans) pomijane", () => {
    const s = buildDeliveryStatus("2026-07", [inv("v", "SKD", "2026-06", 100)], [del("v", "SKD", "2026-06", 100)]);
    expect(s).toHaveLength(0); // rozliczone w czerwcu, w lipcu nic
  });
});

describe("qtyWithGuarantee", () => {
  it("gwarancja dorzuca leady ponad zapłacone (50 + 10% → 55)", () => {
    expect(qtyWithGuarantee(50, 10)).toBe(55);
    expect(qtyWithGuarantee(50, 20)).toBe(60);
  });

  it("ułamki zaokrągla w górę (gwarancja to obietnica)", () => {
    expect(qtyWithGuarantee(25, 10)).toBe(28); // 2,5 → 3
    expect(qtyWithGuarantee(33, 10)).toBe(37); // 3,3 → 4
  });

  it("liczy na liczbach całkowitych — bez artefaktów float", () => {
    // 50 × 1.1 = 55.000000000000007 → naiwny ceil dałby 56
    expect(qtyWithGuarantee(50, 10)).toBe(55);
    expect(qtyWithGuarantee(300, 10)).toBe(330);
  });

  it("brak/zerowa/ujemna gwarancja = bez zmian", () => {
    expect(qtyWithGuarantee(50, null)).toBe(50);
    expect(qtyWithGuarantee(50, undefined)).toBe(50);
    expect(qtyWithGuarantee(50, 0)).toBe(50);
  });
});

describe("buildFulfillmentPlan", () => {
  it("needed = brakujące × CPL; wzrost budżetu = needed − już wydane", () => {
    const statuses = [
      { clientId: "a", vertical: "SKD", contractedThisMonth: 400, deliveredThisMonth: 300, carriedIn: 0, owed: 400, balance: 100 },
      { clientId: "b", vertical: "SKD", contractedThisMonth: 50, deliveredThisMonth: 20, carriedIn: 0, owed: 50, balance: 30 },
    ];
    const plan = buildFulfillmentPlan(statuses, { SKD: 2000 }, { SKD: 100_000 });
    const skd = plan.verticals.find((v) => v.vertical === "SKD")!;
    expect(skd.remaining).toBe(130); // 100 + 30
    expect(skd.neededSpendGr).toBe(130 * 2000); // 260 000 = koszt wygenerowania brakujących
    expect(skd.budgetIncreaseGr).toBe(260_000); // dokładamy pełny koszt (brakujące są PONAD dostarczone)
    expect(skd.spentGr).toBe(100_000); // kontekst — już wydane w tym miesiącu
    expect(plan.totalNeededSpendGr).toBe(260_000);
  });

  it("nadwyżka (balance<0) nie tworzy zapotrzebowania", () => {
    const statuses = [
      { clientId: "a", vertical: "OZE", contractedThisMonth: 100, deliveredThisMonth: 130, carriedIn: 0, owed: 100, balance: -30 },
    ];
    const plan = buildFulfillmentPlan(statuses, { OZE: 5000 }, {});
    expect(plan.totalRemaining).toBe(0);
    expect(plan.totalNeededSpendGr).toBe(0);
  });

  it("brak CPL → needed 0 (nie zgadujemy)", () => {
    const statuses = [
      { clientId: "a", vertical: "X", contractedThisMonth: 10, deliveredThisMonth: 0, carriedIn: 0, owed: 10, balance: 10 },
    ];
    const plan = buildFulfillmentPlan(statuses, { X: null }, {});
    expect(plan.verticals[0].neededSpendGr).toBe(0);
    expect(plan.verticals[0].remaining).toBe(10);
  });

  it("brak zaległości: nic nie trzeba dokładać (increase 0), spent w kontekście", () => {
    const plan = buildFulfillmentPlan([], {}, { SKD: 50_000 });
    const skd = plan.verticals.find((v) => v.vertical === "SKD")!;
    expect(skd.remaining).toBe(0);
    expect(skd.budgetIncreaseGr).toBe(0);
    expect(plan.totalSpentGr).toBe(50_000);
  });
});
