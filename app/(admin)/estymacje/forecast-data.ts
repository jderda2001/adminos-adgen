// Wspólne ładowanie wejścia prognozy (server-only, NIE „use server"): używane
// przez page.tsx i przez akcję AI (serwer sam odbudowuje input, nie ufa klientowi).

import { db } from "@/lib/db";
import { generateRecurringCosts, refreshInvoiceStatuses } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { todayUTC } from "@/lib/format";
import { lastMonthsRange, monthBounds, monthKey } from "@/lib/periods";
import type { ForecastInput, HistoryInvoiceLike, PaidInvoiceLike } from "@/lib/forecast";

export type Horizon = 3 | 6 | 12;

/** Data (UTC) → "RRRR-MM-DD" */
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Buduje ForecastInput z bazy (materializuje koszty cykliczne + odświeża statusy). */
export async function loadForecastInput(horizon: Horizon): Promise<ForecastInput> {
  await Promise.all([generateRecurringCosts(), refreshInvoiceStatuses()]);

  const today = todayUTC();
  const currentPeriod = monthKey(today);
  const history12 = lastMonthsRange(12);
  const rwWindowFrom = monthBounds(currentPeriod).from;
  rwWindowFrom.setUTCMonth(rwWindowFrom.getUTCMonth() - 6);
  const rwFromYear = rwWindowFrom.getUTCFullYear();

  const snapshot = await db.cashSnapshot.findFirst({ orderBy: { date: "desc" } });
  const snapDate = snapshot?.date ?? null;

  const [
    clients,
    openInvoices,
    paidAfterSnap,
    historyInvoices,
    paidInvoices,
    openCosts,
    recurring,
    rwEntries,
    events,
    newBusinessSetting,
  ] = await Promise.all([
    db.client.findMany({
      select: {
        id: true,
        name: true,
        billingModel: true,
        status: true,
        monthlyRetainerGr: true,
        startDate: true,
        endDate: true,
        noticeMonths: true,
      },
      orderBy: { name: "asc" },
    }),
    db.invoice.findMany({
      where: { status: { in: ["ISSUED", "OVERDUE"] } },
      select: { id: true, clientId: true, grossGr: true, dueDate: true, status: true },
    }),
    snapDate
      ? db.invoice.findMany({
          where: { status: "PAID", paidDate: { gt: snapDate } },
          select: { clientId: true, grossGr: true, paidDate: true },
        })
      : Promise.resolve([]),
    db.invoice.findMany({
      where: { status: { not: "DRAFT" }, saleDate: { gte: history12.from } },
      select: { clientId: true, netGr: true, grossGr: true, issueDate: true, dueDate: true, saleDate: true },
    }),
    db.invoice.findMany({
      where: { status: "PAID", paidDate: { not: null, gte: history12.from } },
      select: { clientId: true, dueDate: true, paidDate: true },
    }),
    db.cost.findMany({
      where: snapDate
        ? { OR: [{ paid: false }, { paidDate: { gt: snapDate } }] }
        : { paid: false },
      select: {
        id: true,
        grossGr: true,
        netGr: true,
        dueDate: true,
        docDate: true,
        paidDate: true,
        supplierName: true,
        recurringCostId: true,
        category: { select: { name: true } },
      },
    }),
    db.recurringCost.findMany({
      where: { active: true },
      select: {
        id: true,
        supplierName: true,
        netGr: true,
        vatRate: true,
        dueDayOfMonth: true,
        active: true,
        endPeriod: true,
        lastGeneratedPeriod: true,
        category: { select: { name: true } },
      },
    }),
    db.rwEntry.findMany({
      where: { kind: "KOSZT", year: { gte: rwFromYear } },
      select: { year: true, month: true, category: true, amountGr: true, grossGr: true },
    }),
    db.finPlanEvent.findMany({
      where: { period: { gte: currentPeriod } },
      orderBy: { period: "asc" },
    }),
    getSetting("estymacje_nowy_biznes_gr"),
  ]);

  return {
    todayIso: iso(today),
    horizonMonths: horizon,
    snapshot: snapshot ? { dateIso: iso(snapshot.date), balanceGr: snapshot.balanceGr } : null,
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      billingModel: c.billingModel,
      status: c.status,
      monthlyRetainerGr: c.monthlyRetainerGr,
      startDate: c.startDate ? iso(c.startDate) : null,
      endDate: c.endDate ? iso(c.endDate) : null,
      noticeMonths: c.noticeMonths,
    })),
    openInvoices: openInvoices.map((i) => ({
      id: i.id,
      clientId: i.clientId,
      grossGr: i.grossGr,
      dueDate: iso(i.dueDate),
      status: i.status,
    })),
    paidAfterSnapshotInvoices: paidAfterSnap.map((i) => ({
      clientId: i.clientId,
      grossGr: i.grossGr,
      paidDate: iso(i.paidDate as Date),
    })),
    historyInvoices: historyInvoices.map<HistoryInvoiceLike>((i) => ({
      clientId: i.clientId,
      netGr: i.netGr,
      grossGr: i.grossGr,
      issueDate: iso(i.issueDate),
      dueDate: iso(i.dueDate),
      saleDate: iso(i.saleDate),
    })),
    paidInvoices: paidInvoices.map<PaidInvoiceLike>((i) => ({
      clientId: i.clientId,
      dueDate: iso(i.dueDate),
      paidDate: iso(i.paidDate as Date),
    })),
    openCosts: openCosts.map((c) => ({
      id: c.id,
      grossGr: c.grossGr,
      netGr: c.netGr,
      dueDate: c.dueDate ? iso(c.dueDate) : null,
      docDate: iso(c.docDate),
      paidDate: c.paidDate ? iso(c.paidDate) : null,
      supplierName: c.supplierName,
      categoryName: c.category.name,
      recurringCostId: c.recurringCostId,
    })),
    recurring: recurring.map((t) => ({
      id: t.id,
      supplierName: t.supplierName,
      netGr: t.netGr,
      vatRate: t.vatRate,
      dueDayOfMonth: t.dueDayOfMonth,
      active: t.active,
      endPeriod: t.endPeriod,
      lastGeneratedPeriod: t.lastGeneratedPeriod,
      categoryName: t.category.name,
    })),
    rwHistory: rwEntries.map((e) => ({
      period: `${e.year}-${String(e.month).padStart(2, "0")}`,
      kind: "KOSZT" as const,
      category: e.category,
      amountGr: e.amountGr,
      grossGr: e.grossGr,
    })),
    events: events.map((e) => ({
      id: e.id,
      period: e.period,
      kind: e.kind,
      label: e.label,
      amountGr: e.amountGr,
    })),
    assumptions: { newBusinessMonthlyGr: parseInt(newBusinessSetting, 10) || 0 },
  };
}
