// Ekonomika leadów — czyste funkcje (bez bazy). Marki wewnętrzne prowadzą
// miesięczne kampanie (marka × wertykal) o znanym spendzie i liczbie leadów
// (z Meta Ads Manager). Dostawy leadów do klientów wyceniamy:
//
//   koszt dostawy = round(leady × spend_kampanii / leady_kampanii)   [CPL marki]
//   brak marki (mix) / brak kampanii marki → średnia ważona wertykalu:
//   koszt = round(leady × Σspend / Σleady) po wszystkich kampaniach wertykalu
//   brak jakiejkolwiek kampanii wertykalu → koszt 0 + ostrzeżenie
//
// Celowo bez pośredniego CPL (float) — mnożenie przed dzieleniem minimalizuje
// błąd zaokrąglenia. Drift groszowy per-dostawa absorbuje pozycja
// „nieprzypisane wydatki reklamowe" w rentowności (tożsamość dokładna).

import type { LeadCostByClient } from "./calc";
import type { LeadCostSource } from "./types";

export interface LeadCampaignInput {
  brandId: string;
  period: string; // "RRRR-MM"
  vertical: string;
  spendGr: number; // netto, grosze
  leadsCount: number;
}

export interface LeadDeliveryInput {
  id: string;
  period: string; // "RRRR-MM"
  clientId: string;
  vertical: string;
  brandId: string | null; // null = mix marek (średnia wertykalu)
  leadsCount: number;
}

export interface DeliveryCostRow {
  deliveryId: string;
  clientId: string;
  period: string;
  vertical: string;
  brandId: string | null;
  leadsCount: number;
  costGr: number;
  cplGr: number | null; // zastosowany CPL (informacyjnie); null gdy brak kampanii
  source: LeadCostSource;
}

export interface LeadWarning {
  kind: "BRAK_KAMPANII_MARKI" | "BRAK_KAMPANII_WERTYKALU" | "KAMPANIA_BEZ_LEADOW";
  period: string;
  vertical: string;
  brandId: string | null;
}

export interface LeadCostsResult {
  perClient: LeadCostByClient[];
  perDelivery: DeliveryCostRow[];
  warnings: LeadWarning[];
}

/** CPL w groszach (zaokrąglony); null gdy leadsCount <= 0 (dzielenie przez zero) */
export function cplGr(spendGr: number, leadsCount: number): number | null {
  if (!Number.isFinite(spendGr) || !Number.isFinite(leadsCount) || leadsCount <= 0) {
    return null;
  }
  return Math.round(spendGr / leadsCount);
}

/**
 * Wycena dostaw leadów wg kampanii. Zwraca koszt per klient (do rentowności),
 * rozbicie per dostawa (do UI) i ostrzeżenia o brakujących kampaniach.
 */
export function buildLeadCosts(
  deliveries: readonly LeadDeliveryInput[],
  campaigns: readonly LeadCampaignInput[]
): LeadCostsResult {
  // indeksy kampanii: dokładna (period|brand|vertical) i zagregowana per wertykal
  const byBrand = new Map<string, { spendGr: number; leadsCount: number }>();
  const byVertical = new Map<string, { spendGr: number; leadsCount: number }>();
  for (const c of campaigns) {
    const bKey = `${c.period}|${c.brandId}|${c.vertical}`;
    const prevB = byBrand.get(bKey) ?? { spendGr: 0, leadsCount: 0 };
    byBrand.set(bKey, {
      spendGr: prevB.spendGr + c.spendGr,
      leadsCount: prevB.leadsCount + c.leadsCount,
    });
    const vKey = `${c.period}|${c.vertical}`;
    const prevV = byVertical.get(vKey) ?? { spendGr: 0, leadsCount: 0 };
    // spend kampanii z 0 leadów wchodzi do licznika średniej wertykalu —
    // to realny koszt pozyskania wertykalu w miesiącu
    byVertical.set(vKey, {
      spendGr: prevV.spendGr + c.spendGr,
      leadsCount: prevV.leadsCount + c.leadsCount,
    });
  }

  const warnings = new Map<string, LeadWarning>();
  const warn = (w: LeadWarning) =>
    warnings.set(`${w.kind}|${w.period}|${w.vertical}|${w.brandId ?? ""}`, w);

  // kampanie ze spendem bez leadów — zawsze raportowane
  for (const c of campaigns) {
    if (c.leadsCount <= 0 && c.spendGr > 0) {
      warn({ kind: "KAMPANIA_BEZ_LEADOW", period: c.period, vertical: c.vertical, brandId: c.brandId });
    }
  }

  const perDelivery: DeliveryCostRow[] = [];
  const perClientMap = new Map<string, number>();

  for (const d of deliveries) {
    let costGr = 0;
    let usedCpl: number | null = null;
    let source: LeadCostSource;

    const vertical = byVertical.get(`${d.period}|${d.vertical}`);
    const brand = d.brandId ? byBrand.get(`${d.period}|${d.brandId}|${d.vertical}`) : undefined;

    if (brand && brand.leadsCount > 0) {
      costGr = Math.round((d.leadsCount * brand.spendGr) / brand.leadsCount);
      usedCpl = cplGr(brand.spendGr, brand.leadsCount);
      source = "MARKA";
    } else {
      if (d.brandId) {
        // marka wskazana, ale bez (użytecznej) kampanii → fallback na wertykal
        warn({ kind: "BRAK_KAMPANII_MARKI", period: d.period, vertical: d.vertical, brandId: d.brandId });
      }
      if (vertical && vertical.leadsCount > 0) {
        costGr = Math.round((d.leadsCount * vertical.spendGr) / vertical.leadsCount);
        usedCpl = cplGr(vertical.spendGr, vertical.leadsCount);
        source = "SREDNIA_WERTYKALU";
      } else {
        warn({ kind: "BRAK_KAMPANII_WERTYKALU", period: d.period, vertical: d.vertical, brandId: null });
        costGr = 0;
        usedCpl = null;
        source = "BRAK_KAMPANII";
      }
    }

    perDelivery.push({
      deliveryId: d.id,
      clientId: d.clientId,
      period: d.period,
      vertical: d.vertical,
      brandId: d.brandId,
      leadsCount: d.leadsCount,
      costGr,
      cplGr: usedCpl,
      source,
    });
    perClientMap.set(d.clientId, (perClientMap.get(d.clientId) ?? 0) + costGr);
  }

  return {
    perClient: [...perClientMap.entries()].map(([clientId, leadCostGr]) => ({
      clientId,
      leadCostGr,
    })),
    perDelivery,
    warnings: [...warnings.values()],
  };
}
