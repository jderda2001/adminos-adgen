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
import { lastMonths, lastMonthsRange, monthKey, type Period } from "./periods";
import {
  getSalaryCategoryIds,
  isAllocationEnabled,
} from "./settings";
import { computeVatFromNet } from "./calc";
import { isVatRate } from "./types";

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
  overdue: { totalGr: number; count: number };
}

export async function getDashboardData(period: Period): Promise<DashboardData> {
  const [revenueAgg, costAgg, overdueInvoices] = await Promise.all([
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
  ]);

  return {
    pnl: computePnL(revenueAgg._sum.netGr ?? 0, costAgg._sum.netGr ?? 0),
    vat: computeVatSummary(revenueAgg._sum.vatGr ?? 0, costAgg._sum.vatGr ?? 0),
    overdue: {
      totalGr: overdueInvoices._sum.grossGr ?? 0,
      count: overdueInvoices._count,
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

/** Struktura kosztów per kategoria w okresie (donut na Dashboardzie) */
export async function getCostStructure(
  period: Period
): Promise<CostCategorySlice[]> {
  const grouped = await db.cost.groupBy({
    by: ["categoryId"],
    where: { ...COST_WHERE, docDate: { gte: period.from, lt: period.to } },
    _sum: { netGr: true },
  });
  const categories = await db.costCategory.findMany();
  const nameMap = new Map(categories.map((c) => [c.id, c.name]));
  return grouped
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: nameMap.get(g.categoryId) ?? "?",
      netGr: g._sum.netGr ?? 0,
    }))
    .filter((s) => s.netGr > 0)
    .sort((a, b) => b.netGr - a.netGr);
}

// ── Rentowność klientów ──────────────────────────────────────────────

export interface ProfitabilityWithNames extends ProfitabilityResult {
  clientNames: Map<string, string>;
  allocationEnabled: boolean;
}

/**
 * Rentowność wszystkich klientów w okresie — wspólna dla modułu Rentowność
 * i rankingów na Dashboardzie (Top 5 / dolna 3).
 */
export async function getClientProfitability(
  period: Period
): Promise<ProfitabilityWithNames> {
  const [invoices, costs, entries, users, clients, salaryCategoryIds, allocationEnabled] =
    await Promise.all([
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

  const result = computeProfitability({
    revenues: invoices.map((i) => ({ clientId: i.clientId, netGr: i.netGr })),
    costs,
    labor,
    salaryCategoryIds,
    allocationEnabled,
  });

  return {
    ...result,
    clientNames: new Map(clients.map((c) => [c.id, c.name])),
    allocationEnabled,
  };
}

/** Rentowność jednego klienta per miesiąc (wykres w widoku szczegółowym) */
export async function getClientMonthlyProfit(
  clientId: string,
  n = 12
): Promise<MonthlyPoint[]> {
  const { from, to } = lastMonthsRange(n);
  const [invoices, costs, entries, users] = await Promise.all([
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
  ]);

  const salaryCategoryIds = await getSalaryCategoryIds();
  const ratesByUser = new Map(users.map((u) => [u.id, u.rates]));

  const revenueByMonth = new Map<string, number>();
  for (const inv of invoices) {
    const key = monthKey(inv.saleDate);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + inv.netGr);
  }
  const costsByMonth = new Map<string, number>();
  for (const c of costs) {
    if (salaryCategoryIds.has(c.categoryId)) continue;
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

// ── Koszty cykliczne — leniwe generowanie miesięcznych kopii ────────

// Ile najdalej wstecz dogenerowywać pominięte miesiące (miesiące bez wizyty w module)
const RECURRING_BACKFILL_LIMIT = 12;

/** Kolejny miesiąc po kluczu "RRRR-MM" */
function nextMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1)); // m jest 1-indeksowane → to już następny miesiąc
  return monthKey(d);
}

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
