// Prognoza ekonomiki leadów (czysta, bez bazy) — nakładka na główną prognozę
// dla agencji leadowej. Sprzęga sprzedaż leadów z kosztem reklamowym:
//
//   przychód/mies. per wertykal = leady_run-rate × cena jednostkowa (netto)
//   koszt reklamowy/mies.        = leady_run-rate × forward CPL (× mnożnik scenariusza)
//   marża                        = przychód − koszt reklamowy
//
// Run-rate = średnia z ostatnich N miesięcy (jak run-rate faktur w forecast.ts).
// Scenariusze: mnożnik CPL (np. 1.2 = +20%) i wolumenu leadów.

import { cplGr } from "./leads";

export interface LeadForecastDelivery {
  period: string; // "RRRR-MM"
  vertical: string;
  leadsCount: number;
}
export interface LeadForecastCampaign {
  period: string;
  vertical: string;
  spendGr: number;
  leadsCount: number;
}

export interface LeadForecastScenario {
  /** mnożnik CPL, 1 = bez zmian (1.2 = +20%) */
  cplMultiplier: number;
  /** mnożnik wolumenu leadów, 1 = bez zmian */
  volumeMultiplier: number;
}

export interface LeadForecastVerticalRow {
  vertical: string;
  leadsPerMonth: number; // run-rate × wolumen scenariusza (zaokrąglone)
  baseCplGr: number | null; // forward CPL (run-rate), przed scenariuszem
  cplGr: number | null; // CPL po scenariuszu
  unitPriceGr: number | null; // cena za lead netto (z faktur); null = nieznana
  revenueGr: number | null; // leady × cena; null gdy brak ceny
  adCostGr: number; // leady × CPL
  marginGr: number | null; // przychód − koszt reklamowy; null gdy brak ceny
}

export interface LeadForecastResult {
  perVertical: LeadForecastVerticalRow[];
  totals: {
    leadsPerMonth: number;
    revenueGr: number; // suma znanych przychodów
    adCostGr: number;
    marginGr: number; // revenueGr − adCostGr (tylko wertykale ze znaną ceną w rev)
    hasUnknownPrice: boolean; // któryś wertykal bez ceny → przychód niepełny
  };
}

/** Dane historyczne do prognozy (bez scenariusza) — zwracane przez reports. */
export interface LeadForecastData {
  /** miesiące historii do run-rate (np. 3 ostatnie) */
  historyMonths: string[];
  deliveries: readonly LeadForecastDelivery[];
  campaigns: readonly LeadForecastCampaign[];
  /** cena jednostkowa netto (grosze) per wertykal — z ostatnich faktur */
  unitPriceByVertical: Record<string, number>;
}

export interface LeadForecastInput extends LeadForecastData {
  scenario: LeadForecastScenario;
}

/**
 * Steady-state miesięczna prognoza leadów per wertykal (run-rate + scenariusz).
 * Bazuje na wertykalach, które mają historię dostaw LUB kampanii.
 */
export function buildLeadForecast(input: LeadForecastInput): LeadForecastResult {
  const { historyMonths, deliveries, campaigns, unitPriceByVertical, scenario } = input;
  const monthsSet = new Set(historyMonths);
  const n = Math.max(1, historyMonths.length);
  const cplMul = Number.isFinite(scenario.cplMultiplier) ? Math.max(0, scenario.cplMultiplier) : 1;
  const volMul = Number.isFinite(scenario.volumeMultiplier) ? Math.max(0, scenario.volumeMultiplier) : 1;

  // run-rate dostaw per wertykal (średnia z historii)
  const deliveredByVertical = new Map<string, number>();
  for (const d of deliveries) {
    if (!monthsSet.has(d.period)) continue;
    deliveredByVertical.set(d.vertical, (deliveredByVertical.get(d.vertical) ?? 0) + d.leadsCount);
  }
  // run-rate kampanii per wertykal (spend + leady → forward CPL)
  const campaignByVertical = new Map<string, { spendGr: number; leadsCount: number }>();
  for (const c of campaigns) {
    if (!monthsSet.has(c.period)) continue;
    const prev = campaignByVertical.get(c.vertical) ?? { spendGr: 0, leadsCount: 0 };
    campaignByVertical.set(c.vertical, {
      spendGr: prev.spendGr + c.spendGr,
      leadsCount: prev.leadsCount + c.leadsCount,
    });
  }

  const verticals = new Set<string>([...deliveredByVertical.keys(), ...campaignByVertical.keys()]);

  const perVertical: LeadForecastVerticalRow[] = [];
  for (const vertical of verticals) {
    const deliveredRunRate = Math.round((deliveredByVertical.get(vertical) ?? 0) / n);
    const leadsPerMonth = Math.round(deliveredRunRate * volMul);
    const camp = campaignByVertical.get(vertical);
    const baseCplGr = camp ? cplGr(camp.spendGr, camp.leadsCount) : null;
    const scenarioCplGr = baseCplGr === null ? null : Math.round(baseCplGr * cplMul);
    const unitPriceGr = unitPriceByVertical[vertical] ?? null;
    const revenueGr = unitPriceGr === null ? null : leadsPerMonth * unitPriceGr;
    const adCostGr = scenarioCplGr === null ? 0 : leadsPerMonth * scenarioCplGr;
    const marginGr = revenueGr === null ? null : revenueGr - adCostGr;
    perVertical.push({
      vertical,
      leadsPerMonth,
      baseCplGr,
      cplGr: scenarioCplGr,
      unitPriceGr,
      revenueGr,
      adCostGr,
      marginGr,
    });
  }
  perVertical.sort((a, b) => (b.revenueGr ?? 0) - (a.revenueGr ?? 0) || b.adCostGr - a.adCostGr);

  const totals = perVertical.reduce(
    (acc, r) => ({
      leadsPerMonth: acc.leadsPerMonth + r.leadsPerMonth,
      revenueGr: acc.revenueGr + (r.revenueGr ?? 0),
      adCostGr: acc.adCostGr + r.adCostGr,
      marginGr: acc.marginGr + (r.marginGr ?? 0),
      hasUnknownPrice: acc.hasUnknownPrice || (r.leadsPerMonth > 0 && r.unitPriceGr === null),
    }),
    { leadsPerMonth: 0, revenueGr: 0, adCostGr: 0, marginGr: 0, hasUnknownPrice: false }
  );

  return { perVertical, totals };
}
