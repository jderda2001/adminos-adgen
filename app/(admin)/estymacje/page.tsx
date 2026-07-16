import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateRecurringCosts, refreshInvoiceStatuses } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
import { todayUTC } from "@/lib/format";
import { lastMonthsRange, monthBounds, monthKey } from "@/lib/periods";
import { PageHeader } from "@/components/page-header";
import {
  buildForecast,
  type ForecastInput,
  type HistoryInvoiceLike,
  type PaidInvoiceLike,
} from "@/lib/forecast";
import { EstymacjeView } from "./estymacje-view";

export const metadata: Metadata = { title: "Estymacje" };

const HORIZONS = [3, 6, 12] as const;
type Horizon = (typeof HORIZONS)[number];

/** Data (UTC) → "RRRR-MM-DD" */
function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function EstymacjePage({
  searchParams,
}: {
  searchParams: Promise<{ horyzont?: string }>;
}) {
  await requireAdmin();
  // materializuj koszty cykliczne + odśwież statusy faktur (jak Koszty/Płatności)
  await Promise.all([generateRecurringCosts(), refreshInvoiceStatuses()]);

  const params = await searchParams;
  const requested = Number(params.horyzont);
  const horizon: Horizon = (HORIZONS as readonly number[]).includes(requested)
    ? (requested as Horizon)
    : 6;

  const today = todayUTC();
  const currentPeriod = monthKey(today);
  const history12 = lastMonthsRange(12); // { from, to } — 12 pełnych mies. wstecz łącznie z bieżącym
  // 6 pełnych miesięcy PRZED bieżącym (do bazy kosztów RW / AI)
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
    snapshots,
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
    db.cashSnapshot.findMany({ orderBy: { date: "desc" }, take: 6 }),
    getSetting("estymacje_nowy_biznes_gr"),
  ]);

  const input: ForecastInput = {
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

  const result = buildForecast(input);
  const clientNames: Record<string, string> = {};
  for (const c of clients) clientNames[c.id] = c.name;

  return (
    <>
      <PageHeader
        title="Estymacje"
        description="Prognoza przychodów, kosztów i gotówki na kolejne miesiące — na bazie umów klientów, kosztów cyklicznych i historii płatności."
      />
      <EstymacjeView
        result={result}
        horizon={horizon}
        snapshots={snapshots.map((s) => ({
          id: s.id,
          dateIso: iso(s.date),
          balanceGr: s.balanceGr,
          note: s.note,
        }))}
        events={events.map((e) => ({
          id: e.id,
          period: e.period,
          kind: e.kind,
          label: e.label,
          amountGr: e.amountGr,
          note: e.note,
        }))}
        newBusinessGr={input.assumptions.newBusinessMonthlyGr}
        clientNames={clientNames}
        aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </>
  );
}
