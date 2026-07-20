// Raporty oparte o bazę — pobierają dane Prismą i liczą przez czyste funkcje z lib/calc.
// Wspólne źródło prawdy dla Dashboardu i Rentowności (zgodność w pionie).

import "server-only";
import { db } from "./db";
import {
  computePnL,
  computeProfitability,
  computeVatSummary,
  effectiveRateGr,
  laborCostGr,
  type LaborByClient,
  type PnL,
  type ProfitabilityResult,
  type VatSummary,
} from "./calc";
import { todayUTC } from "./format";
import {
  lastMonths,
  lastMonthsRange,
  monthBounds,
  monthKey,
  monthKeysInRange,
  nextMonthKey,
  type Period,
} from "./periods";
import {
  getAdBudgetCategoryIds,
  getSalaryCategoryIds,
  isAllocationEnabled,
} from "./settings";
import { computeVatFromNet } from "./calc";
import { RW_CATEGORIES } from "./rw-types";
import type { LeadForecastData } from "./lead-forecast";
import { isMetaConfigured, isMetaMock } from "./meta-ads";
import { buildBrandEconomics, daysLeftInMonth, type BrandEconRow } from "./brand-econ";
import { DEFAULT_VERTICALS, isVatRate, LEAD_TAG_PREFIX, type LeadCostSource } from "./types";
import {
  buildLeadCosts,
  cplGr,
  type DeliveryCostRow,
  type LeadWarning,
} from "./leads";

// Filtry wspólne: przychody bez szkiców; koszty bez oczekujących na zatwierdzenie
// ORAZ bez kategorii odłożonych (isDeferred) — zaliczki CIT/premie, oszczędności
// to koszty wewnętrzne (przelew na własne konto), nie liczą się do zysku ani
// rentowności. Pozostają widoczne w rejestrze Kosztów.
const REVENUE_WHERE = { status: { not: "DRAFT" } } as const;
const COST_WHERE = {
  needsConfirmation: false,
  category: { isDeferred: false },
} as const;

/**
 * Aktualizuje statusy faktur względem terminu płatności:
 * ISSUED po terminie → OVERDUE, OVERDUE z terminem w przyszłości (po edycji) → ISSUED.
 * Wołane przy wejściu na strony korzystające ze statusów.
 */
export async function refreshInvoiceStatuses(): Promise<void> {
  const today = todayUTC();
  await db.invoice.updateMany({
    where: { status: "ISSUED", dueDate: { lt: today } },
    data: { status: "OVERDUE" },
  });
  await db.invoice.updateMany({
    where: { status: "OVERDUE", dueDate: { gte: today } },
    data: { status: "ISSUED" },
  });
}

// ── Dashboard ────────────────────────────────────────────────────────

export interface DashboardData {
  pnl: PnL;
  vat: VatSummary;
  /** należności przeterminowane — faktury sprzedażowe po terminie */
  overdue: { totalGr: number; count: number };
  /** zobowiązania przeterminowane — nieopłacone koszty po terminie */
  overdueCosts: { totalGr: number; count: number };
}

export async function getDashboardData(period: Period): Promise<DashboardData> {
  const today = todayUTC();
  const [revenueAgg, costAgg, overdueInvoices, overdueCostAgg] = await Promise.all([
    db.invoice.aggregate({
      where: { ...REVENUE_WHERE, saleDate: { gte: period.from, lt: period.to } },
      _sum: { netGr: true, vatGr: true },
    }),
    db.cost.aggregate({
      where: { ...COST_WHERE, docDate: { gte: period.from, lt: period.to } },
      _sum: { netGr: true, vatGr: true },
    }),
    // należności przeterminowane — stan na dziś, niezależnie od filtra okresu
    db.invoice.aggregate({
      where: { status: "OVERDUE" },
      _sum: { grossGr: true },
      _count: true,
    }),
    // zobowiązania przeterminowane — nieopłacone, zatwierdzalne koszty po terminie
    // (jak lista „Do zapłaty" w Płatnościach); stan na dziś, poza filtrem okresu.
    // Kategorie odłożone (isDeferred) to transfery na własne konta — nie są
    // zobowiązaniem wobec dostawcy, więc poza tym KPI (spójnie z COST_WHERE).
    db.cost.aggregate({
      where: {
        paid: false,
        needsConfirmation: false,
        category: { isDeferred: false },
        dueDate: { lt: today },
      },
      _sum: { grossGr: true },
      _count: true,
    }),
  ]);

  return {
    pnl: computePnL(revenueAgg._sum.netGr ?? 0, costAgg._sum.netGr ?? 0),
    vat: computeVatSummary(revenueAgg._sum.vatGr ?? 0, costAgg._sum.vatGr ?? 0),
    overdue: {
      totalGr: overdueInvoices._sum.grossGr ?? 0,
      count: overdueInvoices._count,
    },
    overdueCosts: {
      totalGr: overdueCostAgg._sum.grossGr ?? 0,
      count: overdueCostAgg._count,
    },
  };
}

export interface MonthlyPoint {
  month: string; // "RRRR-MM"
  revenueGr: number;
  costsGr: number;
  profitGr: number;
  marginFraction: number | null;
}

/** Przychody vs koszty per miesiąc za ostatnie n miesięcy (domyślnie 12) */
export async function getMonthlySeries(n = 12): Promise<MonthlyPoint[]> {
  const { from, to } = lastMonthsRange(n);
  const [invoices, costs] = await Promise.all([
    db.invoice.findMany({
      where: { ...REVENUE_WHERE, saleDate: { gte: from, lt: to } },
      select: { saleDate: true, netGr: true },
    }),
    db.cost.findMany({
      where: { ...COST_WHERE, docDate: { gte: from, lt: to } },
      select: { docDate: true, netGr: true },
    }),
  ]);

  const revenueByMonth = new Map<string, number>();
  for (const inv of invoices) {
    const key = monthKey(inv.saleDate);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + inv.netGr);
  }
  const costsByMonth = new Map<string, number>();
  for (const c of costs) {
    const key = monthKey(c.docDate);
    costsByMonth.set(key, (costsByMonth.get(key) ?? 0) + c.netGr);
  }

  return lastMonths(n).map((month) => {
    const revenueGr = revenueByMonth.get(month) ?? 0;
    const costsGr = costsByMonth.get(month) ?? 0;
    const profitGr = revenueGr - costsGr;
    return {
      month,
      revenueGr,
      costsGr,
      profitGr,
      marginFraction: revenueGr > 0 ? profitGr / revenueGr : null,
    };
  });
}

export interface CostCategorySlice {
  categoryId: string;
  categoryName: string;
  netGr: number;
}

/**
 * Struktura kosztów per kategoria w okresie (donut na Dashboardzie).
 * Kategorie budżetu reklamowego (isAdBudget) są rozbijane na dwa slice'y:
 * „Budżet reklamowy (klienci)" = koszt leadów przypisany klientom (leady × CPL
 * z modułu Leady) i „Marketing własny" = reszta wydatków reklamowych. Suma obu
 * = łączny zaksięgowany budżet reklamowy (donut się nie zmienia w total).
 */
export async function getCostStructure(
  period: Period
): Promise<CostCategorySlice[]> {
  const leadMonths = monthKeysInRange(period.from, period.to);
  const [grouped, categories, adBudgetCategoryIds, deliveries, campaigns] =
    await Promise.all([
      db.cost.groupBy({
        by: ["categoryId"],
        where: { ...COST_WHERE, docDate: { gte: period.from, lt: period.to } },
        _sum: { netGr: true },
      }),
      db.costCategory.findMany(),
      getAdBudgetCategoryIds(),
      db.leadDelivery.findMany({
        where: { period: { in: leadMonths } },
        select: { id: true, period: true, clientId: true, vertical: true, brandId: true, leadsCount: true },
      }),
      db.leadCampaignMonth.findMany({
        where: { period: { in: leadMonths } },
        select: { brandId: true, period: true, vertical: true, spendGr: true, leadsCount: true },
      }),
    ]);

  const nameMap = new Map(categories.map((c) => [c.id, c.name]));

  // zwykłe kategorie (poza budżetem reklamowym) → slice 1:1
  const slices: CostCategorySlice[] = [];
  let bookedAdGr = 0;
  for (const g of grouped) {
    const netGr = g._sum.netGr ?? 0;
    if (adBudgetCategoryIds.has(g.categoryId)) {
      bookedAdGr += netGr;
      continue;
    }
    slices.push({
      categoryId: g.categoryId,
      categoryName: nameMap.get(g.categoryId) ?? "?",
      netGr,
    });
  }

  // rozbicie budżetu reklamowego: przypisane leadom (klienci) vs reszta (marketing własny)
  if (bookedAdGr > 0) {
    const assignedGr = buildLeadCosts(deliveries, campaigns).perClient.reduce(
      (s, c) => s + c.leadCostGr,
      0
    );
    const clientsGr = Math.min(Math.max(assignedGr, 0), bookedAdGr);
    const ownGr = bookedAdGr - clientsGr;
    if (clientsGr > 0) {
      slices.push({
        categoryId: "__adbudget_clients__",
        categoryName: "Budżet reklamowy (klienci)",
        netGr: clientsGr,
      });
    }
    if (ownGr > 0) {
      slices.push({
        categoryId: "__adbudget_own__",
        categoryName: "Marketing własny",
        netGr: ownGr,
      });
    }
  }

  return slices.filter((s) => s.netGr > 0).sort((a, b) => b.netGr - a.netGr);
}

// ── Rentowność klientów ──────────────────────────────────────────────

export interface ProfitabilityWithNames extends ProfitabilityResult {
  clientNames: Map<string, string>;
  allocationEnabled: boolean;
  /** ostrzeżenia wyceny leadów (brak kampanii itp.) — notka w UI z linkiem do /leady */
  leadWarnings: LeadWarning[];
}

/**
 * Rentowność wszystkich klientów w okresie — wspólna dla modułu Rentowność
 * i rankingów na Dashboardzie (Top 5 / dolna 3).
 */
export async function getClientProfitability(
  period: Period
): Promise<ProfitabilityWithNames> {
  // koszt leadów liczony dla PEŁNYCH miesięcy przecinających okres
  const leadMonths = monthKeysInRange(period.from, period.to);

  const [
    invoices,
    costs,
    entries,
    users,
    clients,
    salaryCategoryIds,
    allocationEnabled,
    adBudgetCategoryIds,
    deliveries,
    campaigns,
  ] = await Promise.all([
    db.invoice.findMany({
      where: { ...REVENUE_WHERE, saleDate: { gte: period.from, lt: period.to } },
      select: { clientId: true, netGr: true },
    }),
    db.cost.findMany({
      where: { ...COST_WHERE, docDate: { gte: period.from, lt: period.to } },
      select: { clientId: true, categoryId: true, netGr: true },
    }),
    db.timeEntry.findMany({
      where: { date: { gte: period.from, lt: period.to } },
      select: { userId: true, clientId: true, minutes: true, date: true },
    }),
    db.user.findMany({ select: { id: true, rates: true } }),
    db.client.findMany({ select: { id: true, name: true } }),
    getSalaryCategoryIds(),
    isAllocationEnabled(),
    getAdBudgetCategoryIds(),
    db.leadDelivery.findMany({
      where: { period: { in: leadMonths } },
      select: { id: true, period: true, clientId: true, vertical: true, brandId: true, leadsCount: true },
    }),
    db.leadCampaignMonth.findMany({
      where: { period: { in: leadMonths } },
      select: { brandId: true, period: true, vertical: true, spendGr: true, leadsCount: true },
    }),
  ]);

  // koszt pracy per wpis wg stawki obowiązującej w dniu wpisu
  const ratesByUser = new Map(users.map((u) => [u.id, u.rates]));
  const labor: LaborByClient[] = entries.map((e) => {
    const rate = effectiveRateGr(ratesByUser.get(e.userId) ?? [], e.date);
    return {
      clientId: e.clientId,
      minutes: e.minutes,
      laborGr: laborCostGr(e.minutes, rate),
    };
  });

  const leadCostsResult = buildLeadCosts(deliveries, campaigns);

  const result = computeProfitability({
    revenues: invoices.map((i) => ({ clientId: i.clientId, netGr: i.netGr })),
    costs,
    labor,
    salaryCategoryIds,
    allocationEnabled,
    adBudgetCategoryIds,
    leadCosts: leadCostsResult.perClient,
  });

  return {
    ...result,
    clientNames: new Map(clients.map((c) => [c.id, c.name])),
    allocationEnabled,
    leadWarnings: leadCostsResult.warnings,
  };
}

/** Rentowność jednego klienta per miesiąc (wykres w widoku szczegółowym) */
export async function getClientMonthlyProfit(
  clientId: string,
  n = 12
): Promise<MonthlyPoint[]> {
  const { from, to } = lastMonthsRange(n);
  const months = lastMonths(n);
  const [invoices, costs, entries, users, deliveries, campaigns] = await Promise.all([
    db.invoice.findMany({
      where: { ...REVENUE_WHERE, clientId, saleDate: { gte: from, lt: to } },
      select: { saleDate: true, netGr: true },
    }),
    db.cost.findMany({
      where: { ...COST_WHERE, clientId, docDate: { gte: from, lt: to } },
      select: { docDate: true, netGr: true, categoryId: true },
    }),
    db.timeEntry.findMany({
      where: { clientId, date: { gte: from, lt: to } },
      select: { userId: true, minutes: true, date: true },
    }),
    db.user.findMany({ select: { id: true, rates: true } }),
    db.leadDelivery.findMany({
      where: { clientId, period: { in: months } },
      select: { id: true, period: true, clientId: true, vertical: true, brandId: true, leadsCount: true },
    }),
    db.leadCampaignMonth.findMany({
      where: { period: { in: months } },
      select: { brandId: true, period: true, vertical: true, spendGr: true, leadsCount: true },
    }),
  ]);

  const [salaryCategoryIds, adBudgetCategoryIds] = await Promise.all([
    getSalaryCategoryIds(),
    getAdBudgetCategoryIds(),
  ]);
  const ratesByUser = new Map(users.map((u) => [u.id, u.rates]));

  const revenueByMonth = new Map<string, number>();
  for (const inv of invoices) {
    const key = monthKey(inv.saleDate);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + inv.netGr);
  }
  const costsByMonth = new Map<string, number>();
  for (const c of costs) {
    if (salaryCategoryIds.has(c.categoryId)) continue;
    // przelewy budżetu reklamowego przypisane klientowi nie są jego kosztem —
    // koszt leadów doliczany jest niżej z dostaw × CPL (spójnie z rentownością)
    if (adBudgetCategoryIds.has(c.categoryId)) continue;
    const key = monthKey(c.docDate);
    costsByMonth.set(key, (costsByMonth.get(key) ?? 0) + c.netGr);
  }
  for (const e of entries) {
    const rate = effectiveRateGr(ratesByUser.get(e.userId) ?? [], e.date);
    const key = monthKey(e.date);
    costsByMonth.set(
      key,
      (costsByMonth.get(key) ?? 0) + laborCostGr(e.minutes, rate)
    );
  }
  // koszt leadów per miesiąc (dostawy klienta × CPL kampanii)
  for (const d of buildLeadCosts(deliveries, campaigns).perDelivery) {
    costsByMonth.set(d.period, (costsByMonth.get(d.period) ?? 0) + d.costGr);
  }

  return lastMonths(n).map((month) => {
    const revenueGr = revenueByMonth.get(month) ?? 0;
    const costsGr = costsByMonth.get(month) ?? 0;
    const profitGr = revenueGr - costsGr;
    return {
      month,
      revenueGr,
      costsGr,
      profitGr,
      marginFraction: revenueGr > 0 ? profitGr / revenueGr : null,
    };
  });
}

// ── Ekonomika leadów (moduł Leady) ───────────────────────────────────

export interface LeadMonthData {
  campaigns: {
    id: string;
    brandId: string;
    brandName: string;
    vertical: string;
    spendGr: number;
    leadsCount: number;
    cplGr: number | null;
    source: string; // MANUAL | META
    note: string | null;
  }[];
  deliveries: {
    id: string;
    clientId: string;
    clientName: string;
    vertical: string;
    brandId: string | null;
    brandName: string | null;
    leadsCount: number;
    costGr: number;
    cplGr: number | null;
    source: LeadCostSource;
    estimated: boolean;
    note: string | null;
  }[];
  totals: {
    spendGr: number;
    campaignLeads: number;
    avgCplGr: number | null;
    deliveredLeads: number;
    assignedCostGr: number;
  };
  /** Σ kosztów (COST_WHERE) w kategoriach budżetu reklamowego w tym miesiącu */
  bookedAdCostsGr: number;
  warnings: LeadWarning[];
}

/** Dane miesiąca dla modułu Leady: kampanie z CPL, dostawy z kosztem, uzgodnienie. */
export async function getLeadMonthData(month: string): Promise<LeadMonthData> {
  const bounds = monthBounds(month);
  const [campaignRows, deliveryRows, brands, clients, adBudgetCategoryIds] =
    await Promise.all([
      db.leadCampaignMonth.findMany({
        where: { period: month },
        orderBy: [{ vertical: "asc" }],
      }),
      db.leadDelivery.findMany({
        where: { period: month },
        orderBy: [{ createdAt: "asc" }],
      }),
      db.brand.findMany({ select: { id: true, name: true } }),
      db.client.findMany({ select: { id: true, name: true } }),
      getAdBudgetCategoryIds(),
    ]);

  const bookedAgg = await db.cost.aggregate({
    where: {
      ...COST_WHERE,
      categoryId: { in: [...adBudgetCategoryIds] },
      docDate: { gte: bounds.from, lt: bounds.to },
    },
    _sum: { netGr: true },
  });

  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const clientName = new Map(clients.map((c) => [c.id, c.name]));

  const result = buildLeadCosts(
    deliveryRows.map((d) => ({
      id: d.id,
      period: d.period,
      clientId: d.clientId,
      vertical: d.vertical,
      brandId: d.brandId,
      leadsCount: d.leadsCount,
    })),
    campaignRows.map((c) => ({
      brandId: c.brandId,
      period: c.period,
      vertical: c.vertical,
      spendGr: c.spendGr,
      leadsCount: c.leadsCount,
    }))
  );
  const costByDelivery = new Map(result.perDelivery.map((d) => [d.deliveryId, d]));

  const campaigns = campaignRows
    .map((c) => ({
      id: c.id,
      brandId: c.brandId,
      brandName: brandName.get(c.brandId) ?? "?",
      vertical: c.vertical,
      spendGr: c.spendGr,
      leadsCount: c.leadsCount,
      cplGr: cplGr(c.spendGr, c.leadsCount),
      source: c.source,
      note: c.note,
    }))
    .sort((a, b) => a.brandName.localeCompare(b.brandName, "pl") || a.vertical.localeCompare(b.vertical, "pl"));

  const deliveries = deliveryRows.map((d) => {
    const cost = costByDelivery.get(d.id);
    return {
      id: d.id,
      clientId: d.clientId,
      clientName: clientName.get(d.clientId) ?? "?",
      vertical: d.vertical,
      brandId: d.brandId,
      brandName: d.brandId ? (brandName.get(d.brandId) ?? "?") : null,
      leadsCount: d.leadsCount,
      costGr: cost?.costGr ?? 0,
      cplGr: cost?.cplGr ?? null,
      source: (cost?.source ?? "BRAK_KAMPANII") as LeadCostSource,
      estimated: d.estimated,
      note: d.note,
    };
  });

  const spendGr = campaigns.reduce((s, c) => s + c.spendGr, 0);
  const campaignLeads = campaigns.reduce((s, c) => s + c.leadsCount, 0);
  return {
    campaigns,
    deliveries,
    totals: {
      spendGr,
      campaignLeads,
      avgCplGr: cplGr(spendGr, campaignLeads),
      deliveredLeads: deliveries.reduce((s, d) => s + d.leadsCount, 0),
      assignedCostGr: deliveries.reduce((s, d) => s + d.costGr, 0),
    },
    bookedAdCostsGr: bookedAgg._sum.netGr ?? 0,
    warnings: result.warnings,
  };
}

export interface ClientLeadCostsRow extends DeliveryCostRow {
  brandName: string | null;
}

/** Dostawy leadów klienta z kosztami w okresie — sekcja na karcie klienta. */
export async function getClientLeadCosts(
  clientId: string,
  period: Period
): Promise<{ rows: ClientLeadCostsRow[]; totalGr: number; totalLeads: number }> {
  const months = monthKeysInRange(period.from, period.to);
  const [deliveries, campaigns, brands] = await Promise.all([
    db.leadDelivery.findMany({
      where: { clientId, period: { in: months } },
      select: { id: true, period: true, clientId: true, vertical: true, brandId: true, leadsCount: true },
    }),
    db.leadCampaignMonth.findMany({
      where: { period: { in: months } },
      select: { brandId: true, period: true, vertical: true, spendGr: true, leadsCount: true },
    }),
    db.brand.findMany({ select: { id: true, name: true } }),
  ]);
  const brandName = new Map(brands.map((b) => [b.id, b.name]));
  const { perDelivery } = buildLeadCosts(deliveries, campaigns);
  const rows = perDelivery
    .map((d) => ({ ...d, brandName: d.brandId ? (brandName.get(d.brandId) ?? "?") : null }))
    .sort((a, b) => a.period.localeCompare(b.period) || a.vertical.localeCompare(b.vertical, "pl"));
  return {
    rows,
    totalGr: rows.reduce((s, r) => s + r.costGr, 0),
    totalLeads: rows.reduce((s, r) => s + r.leadsCount, 0),
  };
}

// ── Rentowność nisz (wertykali) ──────────────────────────────────────

/** Wertykal z tagów oferty faktury (np. „PAKIETY LEADÓW,Leady: SKD" → „SKD"). */
function verticalFromOfferTags(offerTags: string | null): string | null {
  if (!offerTags) return null;
  for (const raw of offerTags.split(",")) {
    const tag = raw.trim();
    if (tag.startsWith(LEAD_TAG_PREFIX)) {
      return tag.slice(LEAD_TAG_PREFIX.length).trim() || null;
    }
  }
  return null;
}

export interface VerticalProfitRow {
  vertical: string;
  leadsCount: number; // pozyskane w kampaniach
  spendGr: number; // wydatki kampanii (koszt pozyskania)
  revenueGr: number; // przychód z faktur z tagiem „Leady: <wertykal>"
  profitGr: number; // przychód − wydatki (P&L niszy)
  marginFraction: number | null;
}

/**
 * Rentowność per nisza (wertykal) w okresie: wydatki kampanii (koszt
 * pozyskania) vs przychód przypisany po tagu faktury „Leady: <wertykal>".
 * Zysk = przychód − wydatki (uwzględnia też leady niesprzedane jako koszt).
 * Uwaga: przychód zależy od konsekwentnego tagowania faktur w Przychodach.
 */
export async function getVerticalProfitability(
  period: Period
): Promise<VerticalProfitRow[]> {
  const months = monthKeysInRange(period.from, period.to);
  const [campaigns, invoices] = await Promise.all([
    db.leadCampaignMonth.findMany({
      where: { period: { in: months } },
      select: { vertical: true, spendGr: true, leadsCount: true },
    }),
    db.invoice.findMany({
      where: {
        ...REVENUE_WHERE,
        saleDate: { gte: period.from, lt: period.to },
        offerTags: { contains: LEAD_TAG_PREFIX },
      },
      select: { netGr: true, offerTags: true },
    }),
  ]);

  const map = new Map<string, { leadsCount: number; spendGr: number; revenueGr: number }>();
  const bucket = (v: string) => {
    let e = map.get(v);
    if (!e) {
      e = { leadsCount: 0, spendGr: 0, revenueGr: 0 };
      map.set(v, e);
    }
    return e;
  };
  for (const c of campaigns) {
    const e = bucket(c.vertical);
    e.spendGr += c.spendGr;
    e.leadsCount += c.leadsCount;
  }
  for (const inv of invoices) {
    const v = verticalFromOfferTags(inv.offerTags);
    if (v) bucket(v).revenueGr += inv.netGr;
  }

  return [...map.entries()]
    .map(([vertical, e]) => {
      const profitGr = e.revenueGr - e.spendGr;
      return {
        vertical,
        leadsCount: e.leadsCount,
        spendGr: e.spendGr,
        revenueGr: e.revenueGr,
        profitGr,
        marginFraction: e.revenueGr > 0 ? profitGr / e.revenueGr : null,
      };
    })
    .sort((a, b) => b.revenueGr - a.revenueGr || b.spendGr - a.spendGr);
}

/** Rentowność jednej niszy per miesiąc (wykres w widoku szczegółowym niszy). */
export async function getVerticalMonthlyProfit(
  vertical: string,
  n = 12
): Promise<MonthlyPoint[]> {
  const { from, to } = lastMonthsRange(n);
  const months = lastMonths(n);
  const [campaigns, invoices] = await Promise.all([
    db.leadCampaignMonth.findMany({
      where: { vertical, period: { in: months } },
      select: { period: true, spendGr: true },
    }),
    db.invoice.findMany({
      where: {
        ...REVENUE_WHERE,
        saleDate: { gte: from, lt: to },
        offerTags: { contains: `${LEAD_TAG_PREFIX}${vertical}` },
      },
      select: { saleDate: true, netGr: true, offerTags: true },
    }),
  ]);

  const spendByMonth = new Map<string, number>();
  for (const c of campaigns) {
    spendByMonth.set(c.period, (spendByMonth.get(c.period) ?? 0) + c.spendGr);
  }
  const revByMonth = new Map<string, number>();
  for (const inv of invoices) {
    // `contains` to wstępny filtr — dokładne dopasowanie wertykalu w JS
    if (verticalFromOfferTags(inv.offerTags) !== vertical) continue;
    const key = monthKey(inv.saleDate);
    revByMonth.set(key, (revByMonth.get(key) ?? 0) + inv.netGr);
  }

  return months.map((month) => {
    const revenueGr = revByMonth.get(month) ?? 0;
    const costsGr = spendByMonth.get(month) ?? 0;
    const profitGr = revenueGr - costsGr;
    return {
      month,
      revenueGr,
      costsGr,
      profitGr,
      marginFraction: revenueGr > 0 ? profitGr / revenueGr : null,
    };
  });
}

// ── Auto-przenoszenie dostaw leadów na kolejny miesiąc ──────────────

/** Poprzedni miesiąc dla klucza "RRRR-MM". */
function prevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return monthKey(new Date(Date.UTC(y, m - 2, 1)));
}

/**
 * Dla klientów na paczkach leadów (PAKIETY_LEADOW, ACTIVE) z TRWAJĄCĄ umową
 * (endDate null = na czas nieokreślony, lub endDate ≥ ten miesiąc = w okresie
 * wypowiedzenia) auto-kopiuje dostawy z poprzedniego miesiąca do `targetPeriod`
 * jako `estimated` (do potwierdzenia/korekty) — o ile klient nie ma jeszcze
 * żadnej dostawy w tym miesiącu. Idempotentne. Wywoływane dla BIEŻĄCEGO miesiąca.
 */
export async function ensureCarriedLeadDeliveries(targetPeriod: string): Promise<void> {
  const prev = prevMonthKey(targetPeriod);
  const [prevDeliveries, currentClientIds, leadClients] = await Promise.all([
    db.leadDelivery.findMany({
      where: { period: prev },
      select: { clientId: true, vertical: true, brandId: true, leadsCount: true },
    }),
    db.leadDelivery.findMany({
      where: { period: targetPeriod },
      select: { clientId: true },
      distinct: ["clientId"],
    }),
    db.client.findMany({
      where: { status: "ACTIVE", billingModel: "PAKIETY_LEADOW" },
      select: { id: true, endDate: true },
    }),
  ]);
  if (prevDeliveries.length === 0) return;

  const hasCurrent = new Set(currentClientIds.map((c) => c.clientId));
  // klient z trwającą umową w targetPeriod (endDate null lub obejmuje miesiąc)
  const contractCovers = new Map(
    leadClients.map((c) => [
      c.id,
      c.endDate === null || monthKey(c.endDate) >= targetPeriod,
    ])
  );

  const toCreate = prevDeliveries.filter(
    (d) => contractCovers.get(d.clientId) === true && !hasCurrent.has(d.clientId)
  );
  if (toCreate.length === 0) return;

  await db.leadDelivery.createMany({
    data: toCreate.map((d) => ({
      period: targetPeriod,
      clientId: d.clientId,
      vertical: d.vertical,
      brandId: d.brandId,
      leadsCount: d.leadsCount,
      estimated: true,
    })),
  });
}

// ── Wertykały leadowe (edytowalne) ──────────────────────────────────

/** Nazwy aktywnych wertykali (po pozycji). Fallback do DEFAULT_VERTICALS, gdy tabela pusta. */
export async function getActiveVerticalNames(): Promise<string[]> {
  const rows = await db.leadVertical.findMany({
    where: { active: true },
    orderBy: { position: "asc" },
    select: { name: true },
  });
  return rows.length > 0 ? rows.map((r) => r.name) : [...DEFAULT_VERTICALS];
}

export interface VerticalManageRow {
  id: string;
  name: string;
  active: boolean;
  usageCount: number; // kampanie + dostawy (po nazwie wertykalu)
}

/** Wertykały do zarządzania (dialog „Wertykały") — z licznikiem użycia. */
export async function getVerticalsForManagement(): Promise<VerticalManageRow[]> {
  const [verticals, campByV, delByV] = await Promise.all([
    db.leadVertical.findMany({ orderBy: { position: "asc" } }),
    db.leadCampaignMonth.groupBy({ by: ["vertical"], _count: { _all: true } }),
    db.leadDelivery.groupBy({ by: ["vertical"], _count: { _all: true } }),
  ]);
  const usage = new Map<string, number>();
  for (const c of campByV) usage.set(c.vertical, (usage.get(c.vertical) ?? 0) + c._count._all);
  for (const d of delByV) usage.set(d.vertical, (usage.get(d.vertical) ?? 0) + d._count._all);
  return verticals.map((v) => ({
    id: v.id,
    name: v.name,
    active: v.active,
    usageCount: usage.get(v.name) ?? 0,
  }));
}

// ── Integracja Meta (status + kampanie do mapowania) ────────────────

export interface MetaStatus {
  configured: boolean; // token obecny (realne dane) vs mock
  mock: boolean;
  lastRun: {
    ranAt: string;
    month: string;
    ok: boolean;
    campaignsPulled: number;
    mappedCount: number;
    unmappedSpendGr: number;
    error: string | null;
  } | null;
  accountsPending: number; // konta bez decyzji (marka vs konto klienta)
  campaignsPending: number; // kampanie z kont z marką, bez wertykalu
  pendingTotal: number; // do badge'a „Przypisz"
}

export async function getMetaStatus(): Promise<MetaStatus> {
  const [last, accounts, campaigns, configured, mock] = await Promise.all([
    db.metaSyncRun.findFirst({ orderBy: { ranAt: "desc" } }),
    db.metaAdAccountMap.findMany({
      select: { adAccountId: true, brandId: true, mixed: true, ignored: true },
    }),
    db.metaCampaignMap.findMany({
      where: { ignored: false },
      select: { adAccountId: true, brandId: true, vertical: true },
    }),
    isMetaConfigured(),
    isMetaMock(),
  ]);
  const accById = new Map(accounts.map((a) => [a.adAccountId, a]));
  const accountsPending = accounts.filter((a) => !a.ignored && !a.mixed && !a.brandId).length;
  const campaignsPending = campaigns.filter((c) => {
    const acc = accById.get(c.adAccountId);
    if (!acc || acc.ignored) return false;
    if (acc.mixed) return !c.brandId || !c.vertical; // mieszane: marka+wertykal per kampania
    const brand = c.brandId ?? acc.brandId ?? null;
    return Boolean(brand) && !c.vertical;
  }).length;
  return {
    configured,
    mock,
    lastRun: last
      ? {
          ranAt: last.ranAt.toISOString(),
          month: last.month,
          ok: last.ok,
          campaignsPulled: last.campaignsPulled,
          mappedCount: last.mappedCount,
          unmappedSpendGr: last.unmappedSpendGr,
          error: last.error,
        }
      : null,
    accountsPending,
    campaignsPending,
    pendingTotal: accountsPending + campaignsPending,
  };
}

export interface MetaAccountRow {
  adAccountId: string;
  adAccountName: string;
  brandId: string | null;
  mixed: boolean;
  ignored: boolean;
  campaignCount: number;
}

export interface MetaCampaignMapRow {
  id: string;
  metaCampaignId: string;
  metaCampaignName: string;
  adAccountId: string;
  adAccountName: string;
  brandId: string | null; // override per kampania (zwykle null — marka z konta)
  vertical: string | null;
  ignored: boolean;
}

export interface MetaMappingData {
  accounts: MetaAccountRow[];
  campaigns: MetaCampaignMapRow[];
}

/** Konta + kampanie Meta do dialogu przypisywania (krok 1: konta, krok 2: kampanie). */
export async function getMetaMappingData(): Promise<MetaMappingData> {
  const [accountRows, campaignRows] = await Promise.all([
    db.metaAdAccountMap.findMany({ orderBy: { adAccountName: "asc" } }),
    db.metaCampaignMap.findMany({
      orderBy: [{ adAccountName: "asc" }, { metaCampaignName: "asc" }],
    }),
  ]);
  const countByAccount = new Map<string, number>();
  for (const c of campaignRows) {
    countByAccount.set(c.adAccountId, (countByAccount.get(c.adAccountId) ?? 0) + 1);
  }
  // konta widziane tylko w kampaniach (sprzed wprowadzenia mapy kont) też pokazujemy
  const known = new Set(accountRows.map((a) => a.adAccountId));
  const extra = new Map<string, string>();
  for (const c of campaignRows) {
    if (!known.has(c.adAccountId)) extra.set(c.adAccountId, c.adAccountName);
  }
  const accounts: MetaAccountRow[] = [
    ...accountRows.map((a) => ({
      adAccountId: a.adAccountId,
      adAccountName: a.adAccountName,
      brandId: a.brandId,
      mixed: a.mixed,
      ignored: a.ignored,
      campaignCount: countByAccount.get(a.adAccountId) ?? 0,
    })),
    ...[...extra.entries()].map(([id, name]) => ({
      adAccountId: id,
      adAccountName: name,
      brandId: null,
      mixed: false,
      ignored: false,
      campaignCount: countByAccount.get(id) ?? 0,
    })),
  ].sort((a, b) => a.adAccountName.localeCompare(b.adAccountName, "pl"));

  return {
    accounts,
    campaigns: campaignRows.map((r) => ({
      id: r.id,
      metaCampaignId: r.metaCampaignId,
      metaCampaignName: r.metaCampaignName,
      adAccountId: r.adAccountId,
      adAccountName: r.adAccountName,
      brandId: r.brandId,
      vertical: r.vertical,
      ignored: r.ignored,
    })),
  };
}

// ── Ekonomika marek wewnętrznych + budżet reklamowy miesiąca ────────

export interface BrandEconomics {
  rows: BrandEconRow[];
  daysLeft: number; // dni do końca miesiąca (łącznie z dziś); 0 dla przeszłych
}

/**
 * Karty marek: leady/spend/CPL z LeadCampaignMonth, przychód z dostaw wyceniony
 * cenami jednostkowymi z faktur (klient×wertykal → fallback wertykal), marża
 * i budżet plan vs wydane (BrandBudget).
 */
export async function getBrandEconomics(month: string): Promise<BrandEconomics> {
  const [brands, campaigns, deliveries, budgets, accounts, pricedInvoices] = await Promise.all([
    db.brand.findMany({
      where: { active: true },
      orderBy: { position: "asc" },
      select: { id: true, name: true },
    }),
    db.leadCampaignMonth.findMany({
      where: { period: month },
      select: { brandId: true, spendGr: true, leadsCount: true },
    }),
    db.leadDelivery.findMany({
      where: { period: month },
      select: { brandId: true, clientId: true, vertical: true, leadsCount: true },
    }),
    db.brandBudget.findMany({ where: { period: month } }),
    db.metaAdAccountMap.findMany({
      select: { brandId: true, adAccountName: true, ignored: true },
    }),
    db.invoice.findMany({
      where: {
        ...REVENUE_WHERE,
        leadUnitPriceGr: { not: null },
        offerTags: { contains: LEAD_TAG_PREFIX },
        saleDate: { gte: new Date(Date.now() - 365 * 86_400_000) },
      },
      orderBy: { saleDate: "desc" },
      select: { clientId: true, leadUnitPriceGr: true, offerTags: true },
    }),
  ]);

  const unitPriceByClientVertical = new Map<string, number>();
  const unitPriceByVertical: Record<string, number> = {};
  for (const inv of pricedInvoices) {
    const v = verticalFromOfferTags(inv.offerTags);
    if (!v || inv.leadUnitPriceGr == null) continue;
    if (inv.clientId) {
      const key = `${inv.clientId}|${v}`;
      if (!unitPriceByClientVertical.has(key))
        unitPriceByClientVertical.set(key, inv.leadUnitPriceGr);
    }
    if (unitPriceByVertical[v] === undefined) unitPriceByVertical[v] = inv.leadUnitPriceGr;
  }

  const rows = buildBrandEconomics({
    brands,
    campaigns,
    deliveries,
    unitPriceByClientVertical,
    unitPriceByVertical,
    budgets: new Map(budgets.map((b) => [b.brandId, b.budgetGr])),
    accounts,
  });

  return { rows, daysLeft: daysLeftInMonth(month, todayUTC()) };
}

export interface AdBudgetStatus {
  month: string;
  planGr: number; // Σ budżetów marek
  spentGr: number; // Σ spend kampanii (Meta + ręczne)
  bookedGr: number; // zaksięgowane koszty w kategoriach budżetu reklamowego
  remainingGr: number; // plan − wydane (ujemne = przepał)
  daysLeft: number;
  dailyPaceGr: number | null; // ile dziennie, by domknąć plan (null gdy nie dotyczy)
}

/** Status budżetu reklamowego miesiąca — karta w Leady i banner w Kosztach. */
export async function getAdBudgetStatus(month: string): Promise<AdBudgetStatus> {
  const bounds = monthBounds(month);
  const [budgetAgg, spendAgg, adBudgetCategoryIds] = await Promise.all([
    db.brandBudget.aggregate({ where: { period: month }, _sum: { budgetGr: true } }),
    db.leadCampaignMonth.aggregate({ where: { period: month }, _sum: { spendGr: true } }),
    getAdBudgetCategoryIds(),
  ]);
  const bookedAgg = await db.cost.aggregate({
    where: {
      ...COST_WHERE,
      categoryId: { in: [...adBudgetCategoryIds] },
      docDate: { gte: bounds.from, lt: bounds.to },
    },
    _sum: { netGr: true },
  });
  const planGr = budgetAgg._sum.budgetGr ?? 0;
  const spentGr = spendAgg._sum.spendGr ?? 0;
  const remainingGr = planGr - spentGr;
  const daysLeft = daysLeftInMonth(month, todayUTC());
  return {
    month,
    planGr,
    spentGr,
    bookedGr: bookedAgg._sum.netGr ?? 0,
    remainingGr,
    daysLeft,
    dailyPaceGr: daysLeft > 0 && remainingGr > 0 ? Math.round(remainingGr / daysLeft) : null,
  };
}

// ── Dane wejściowe do prognozy leadów (moduł Estymacje) ─────────────

/**
 * Historia leadów do prognozy: dostawy + kampanie z ostatnich n miesięcy oraz
 * najświeższa cena jednostkowa netto per wertykal (z faktur „Leady: <wertykal>"
 * z wypełnionym leadUnitPriceGr). Silnik: lib/lead-forecast.ts.
 */
export async function getLeadForecastData(n = 3): Promise<LeadForecastData> {
  const historyMonths = lastMonths(n);
  const { from, to } = lastMonthsRange(n);
  const [deliveries, campaigns, pricedInvoices] = await Promise.all([
    db.leadDelivery.findMany({
      where: { period: { in: historyMonths } },
      select: { period: true, vertical: true, leadsCount: true },
    }),
    db.leadCampaignMonth.findMany({
      where: { period: { in: historyMonths } },
      select: { period: true, vertical: true, spendGr: true, leadsCount: true },
    }),
    // najświeższa cena za lead per wertykal — z ostatnich 12 mies. (nie tylko okna run-rate)
    db.invoice.findMany({
      where: {
        ...REVENUE_WHERE,
        leadUnitPriceGr: { not: null },
        offerTags: { contains: LEAD_TAG_PREFIX },
        saleDate: { gte: new Date(to.getTime() - 365 * 86_400_000), lt: to },
      },
      orderBy: { saleDate: "desc" },
      select: { saleDate: true, leadUnitPriceGr: true, offerTags: true },
    }),
  ]);
  void from;

  const unitPriceByVertical: Record<string, number> = {};
  for (const inv of pricedInvoices) {
    const v = verticalFromOfferTags(inv.offerTags);
    // pierwsza (najświeższa) cena wygrywa — invoices posortowane malejąco po dacie
    if (v && inv.leadUnitPriceGr != null && unitPriceByVertical[v] === undefined) {
      unitPriceByVertical[v] = inv.leadUnitPriceGr;
    }
  }

  return { historyMonths, deliveries, campaigns, unitPriceByVertical };
}

// ── Uzgodnienie rejestrów: RW (kasowo, z wyciągów) vs Przychody/Koszty ──

// Kategorie RW odłożone/podatkowe (ODLOZONE + CIT) — transfery wewnętrzne i
// podatki; wykluczane z „kosztu operacyjnego" RW, by porównanie z modułem
// Koszty (który wyklucza isDeferred) było jabłka-do-jabłek.
const RW_DEFERRED_CATEGORIES = new Set(
  RW_CATEGORIES.filter((c) => c.bucket === "ODLOZONE" || c.bucket === "CIT").map(
    (c) => c.name
  )
);

export interface LedgerReconRow {
  month: number; // 1–12
  invoiceAccrualGr: number; // Σ faktur (netto, bez DRAFT) po dacie sprzedaży
  invoiceCashGr: number; // Σ faktur opłaconych (netto) po dacie zapłaty
  rwRevenueGr: number; // Σ RW PRZYCHODY (netto) w miesiącu wyciągu
  costGr: number; // Σ Cost (netto, COST_WHERE) po dacie wystawienia
  rwCostGr: number; // Σ RW koszty operacyjne (bez odłożonych/podatków), dodatnio
}

export interface LedgerReconciliation {
  year: number;
  rows: LedgerReconRow[];
}

/**
 * Zestawienie miesięczne dwóch rejestrów za rok:
 * - Przychód memoriałowy (faktury po saleDate) i kasowy (faktury opłacone po
 *   paidDate) vs RW PRZYCHODY (miesiąc wpływu na konto z wyciągu).
 * - Koszt (moduł Koszty, COST_WHERE, po docDate) vs RW koszty operacyjne.
 * Delty liczy UI. Odpowiada na „przychód w adminOS nie zgadza się z arkuszami":
 * lokalizuje miesiąc i stronę rozjazdu (kasowo vs memoriałowo, braki importów).
 */
export async function getLedgerReconciliation(
  year: number
): Promise<LedgerReconciliation> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));

  const [accrualInvoices, cashInvoices, costs, rwEntries] = await Promise.all([
    db.invoice.findMany({
      where: { ...REVENUE_WHERE, saleDate: { gte: from, lt: to } },
      select: { saleDate: true, netGr: true },
    }),
    db.invoice.findMany({
      where: { status: "PAID", paidDate: { gte: from, lt: to } },
      select: { paidDate: true, netGr: true },
    }),
    db.cost.findMany({
      where: { ...COST_WHERE, docDate: { gte: from, lt: to } },
      select: { docDate: true, netGr: true },
    }),
    db.rwEntry.findMany({
      where: { year },
      select: { month: true, kind: true, category: true, amountGr: true },
    }),
  ]);

  const rows: LedgerReconRow[] = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    invoiceAccrualGr: 0,
    invoiceCashGr: 0,
    rwRevenueGr: 0,
    costGr: 0,
    rwCostGr: 0,
  }));

  for (const inv of accrualInvoices) {
    rows[inv.saleDate.getUTCMonth()].invoiceAccrualGr += inv.netGr;
  }
  for (const inv of cashInvoices) {
    if (inv.paidDate) rows[inv.paidDate.getUTCMonth()].invoiceCashGr += inv.netGr;
  }
  for (const c of costs) {
    rows[c.docDate.getUTCMonth()].costGr += c.netGr;
  }
  for (const e of rwEntries) {
    const idx = e.month - 1;
    if (idx < 0 || idx > 11) continue;
    if (e.kind === "PRZYCHOD") {
      rows[idx].rwRevenueGr += e.amountGr;
    } else if (!RW_DEFERRED_CATEGORIES.has(e.category)) {
      // koszty RW są ujemne — do porównania z Cost.netGr (dodatnie) bierzemy wartość bezwzględną
      rows[idx].rwCostGr += -e.amountGr;
    }
  }

  return { year, rows };
}

// ── Budżet: plan vs wykonanie (moduł Budżet) ────────────────────────

export interface BudgetVsActualRow {
  period: string; // "RRRR-MM"
  month: number; // 1–12
  revenuePlanGr: number;
  revenueActualGr: number;
  costPlanGr: number;
  costActualGr: number;
  leadsPlan: number | null;
  leadsActual: number;
  note: string | null;
}

/**
 * Plan (MonthlyBudget) vs wykonanie za rok, per miesiąc. Wykonanie:
 * przychód = faktury (bez DRAFT, po saleDate), koszt = Cost (COST_WHERE, po
 * docDate), leady = Σ LeadDelivery. Marża/delty liczy UI.
 */
export async function getBudgetVsActual(year: number): Promise<BudgetVsActualRow[]> {
  const from = new Date(Date.UTC(year, 0, 1));
  const to = new Date(Date.UTC(year + 1, 0, 1));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);

  const [budgets, invoices, costs, deliveries] = await Promise.all([
    db.monthlyBudget.findMany({ where: { period: { in: months } } }),
    db.invoice.findMany({
      where: { ...REVENUE_WHERE, saleDate: { gte: from, lt: to } },
      select: { saleDate: true, netGr: true },
    }),
    db.cost.findMany({
      where: { ...COST_WHERE, docDate: { gte: from, lt: to } },
      select: { docDate: true, netGr: true },
    }),
    db.leadDelivery.findMany({
      where: { period: { in: months } },
      select: { period: true, leadsCount: true },
    }),
  ]);

  const budgetByPeriod = new Map(budgets.map((b) => [b.period, b]));
  const revActual = new Array(12).fill(0);
  const costActual = new Array(12).fill(0);
  const leadsActual = new Array(12).fill(0);
  for (const inv of invoices) revActual[inv.saleDate.getUTCMonth()] += inv.netGr;
  for (const c of costs) costActual[c.docDate.getUTCMonth()] += c.netGr;
  for (const d of deliveries) {
    const idx = Number(d.period.slice(5, 7)) - 1;
    if (idx >= 0 && idx < 12) leadsActual[idx] += d.leadsCount;
  }

  return months.map((period, i) => {
    const b = budgetByPeriod.get(period);
    return {
      period,
      month: i + 1,
      revenuePlanGr: b?.revenuePlanGr ?? 0,
      revenueActualGr: revActual[i],
      costPlanGr: b?.costPlanGr ?? 0,
      costActualGr: costActual[i],
      leadsPlan: b?.leadsPlan ?? null,
      leadsActual: leadsActual[i],
      note: b?.note ?? null,
    };
  });
}

// ── Koszty cykliczne — leniwe generowanie miesięcznych kopii ────────

// Ile najdalej wstecz dogenerowywać pominięte miesiące (miesiące bez wizyty w module)
const RECURRING_BACKFILL_LIMIT = 12;

/**
 * Tworzy kopie „do potwierdzenia" dla wszystkich aktywnych szablonów kosztów
 * cyklicznych, którym brakuje wpisów od lastGeneratedPeriod do bieżącego
 * miesiąca (dogenerowuje też pominięte miesiące, maks. 12 wstecz). Idempotentne
 * i odporne na współbieżne wywołania (optymistyczna blokada na updateMany) —
 * wołane przy wejściu na strony Kosztów i Płatności (self-hosted, bez crona).
 */
export async function generateRecurringCosts(): Promise<number> {
  const today = todayUTC();
  const currentPeriod = monthKey(today);
  const templates = await db.recurringCost.findMany({
    where: {
      active: true,
      OR: [
        { lastGeneratedPeriod: null },
        { lastGeneratedPeriod: { lt: currentPeriod } },
      ],
    },
  });

  let created = 0;
  for (const t of templates) {
    // optymistyczna blokada: tylko jedno współbieżne wywołanie "wygrywa" szablon
    const claimed = await db.recurringCost.updateMany({
      where: {
        id: t.id,
        active: true,
        lastGeneratedPeriod: t.lastGeneratedPeriod,
      },
      data: { lastGeneratedPeriod: currentPeriod },
    });
    if (claimed.count !== 1) continue;

    // lista brakujących miesięcy: od następnego po lastGeneratedPeriod do bieżącego;
    // endPeriod (raty/leasingi) ucina generowanie po ostatnim umownym miesiącu
    const periods: string[] = [];
    let period = t.lastGeneratedPeriod
      ? nextMonthKey(t.lastGeneratedPeriod)
      : currentPeriod;
    while (
      period <= currentPeriod &&
      (t.endPeriod === null || period <= t.endPeriod) &&
      periods.length < RECURRING_BACKFILL_LIMIT
    ) {
      periods.push(period);
      period = nextMonthKey(period);
    }

    for (const p of periods) {
      const [y, m1] = p.split("-").map(Number);
      const m = m1 - 1;
      const docDate = new Date(Date.UTC(y, m, 1));
      const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      const dueDate = new Date(
        Date.UTC(y, m, Math.min(t.dueDayOfMonth, lastDay))
      );
      const mmYYYY = `${String(m1).padStart(2, "0")}/${y}`;
      const { vatGr, grossGr } = computeVatFromNet(
        t.netGr,
        isVatRate(t.vatRate) ? t.vatRate : "23"
      );

      await db.cost.create({
        data: {
          supplierName: t.supplierName,
          supplierAccount: t.supplierAccount,
          docNumber: t.docNumber
            ? t.docNumber.replace("{MM/RRRR}", mmYYYY)
            : `Koszt cykliczny ${mmYYYY}`,
          docDate,
          dueDate,
          netGr: t.netGr,
          vatRate: t.vatRate,
          vatGr,
          grossGr,
          categoryId: t.categoryId,
          clientId: t.clientId,
          needsConfirmation: true,
          note: t.note,
          recurringCostId: t.id,
        },
      });
      created++;
    }
  }
  return created;
}
