import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin, isAuthDisabled } from "@/lib/auth";
import {
  generateRecurringCosts,
  getAdBudgetStatus,
  getPreviousMonthVat,
} from "@/lib/reports";
import { monthKey } from "@/lib/periods";
import { formatMonth, todayUTC } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { AdBudgetSummary } from "@/components/ad-budget-summary";
import { buildCostFilters, type CostFilterParams } from "./filters";
import { CostsTable, type CostRow } from "./costs-table";
import { PendingCosts, type PendingCostRow } from "./pending-costs";
import type { RecurringRow } from "./recurring-dialog";

export const metadata: Metadata = { title: "Koszty" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireAdmin();

  // leniwe generowanie miesięcznych kopii kosztów cyklicznych
  await generateRecurringCosts();

  const raw = await searchParams;
  const filters: CostFilterParams = {
    okres: first(raw.okres),
    od: first(raw.od),
    do: first(raw.do),
    kategoria: first(raw.kategoria),
    przypisanie: first(raw.przypisanie),
    platnosc: first(raw.platnosc),
  };
  // od 1. dnia następnego miesiąca zaczynają się „zaplanowane" kopie cykliczne
  const today = todayUTC();
  const nextMonthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)
  );
  // tabela per miesiąc pokazuje też zaplanowane przyszłe kopie (estymacja)
  const { where } = buildCostFilters(filters, { plannedFrom: nextMonthStart });

  // budżet reklamowy bieżącego miesiąca (plan marek vs wydane wg Mety) — banner
  const adBudget = await getAdBudgetStatus(monthKey(today));
  // VAT za poprzedni miesiąc (odłożony, płatny do US w tym miesiącu) — kafelek
  const prevVatRaw = await getPreviousMonthVat();
  const prevVat = { monthLabel: formatMonth(prevVatRaw.month), dueGr: prevVatRaw.dueGr };

  const [costs, pendingCosts, categories, clients, suppliers, templates] =
    await Promise.all([
      db.cost.findMany({
        where,
        include: {
          category: true,
          client: true,
          comments: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { docDate: "desc" },
      }),
      db.cost.findMany({
        // kolejka „Do potwierdzenia" — tylko bieżący i wcześniejsze miesiące
        // (przyszłe zaplanowane kopie widać w tabeli danego miesiąca, nie tutaj)
        where: { needsConfirmation: true, docDate: { lt: nextMonthStart } },
        include: { category: true },
        orderBy: [{ supplierName: "asc" }, { docDate: "desc" }],
      }),
      db.costCategory.findMany({ orderBy: { position: "asc" } }),
      db.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.cost.findMany({
        select: { supplierName: true },
        distinct: ["supplierName"],
        orderBy: { supplierName: "asc" },
      }),
      db.recurringCost.findMany({
        include: { category: true, client: true },
        orderBy: { supplierName: "asc" },
      }),
    ]);

  const rows: CostRow[] = costs.map((c) => ({
    id: c.id,
    supplierName: c.supplierName,
    supplierAccount: c.supplierAccount,
    docNumber: c.docNumber,
    docDate: c.docDate.toISOString(),
    dueDate: c.dueDate?.toISOString() ?? null,
    netGr: c.netGr,
    vatRate: c.vatRate,
    vatGr: c.vatGr,
    grossGr: c.grossGr,
    categoryId: c.categoryId,
    categoryName: c.category.name,
    clientId: c.clientId,
    clientName: c.client?.name ?? null,
    paid: c.paid,
    approvedForPayment: c.approvedForPayment,
    delayed: c.delayed,
    paidDate: c.paidDate?.toISOString() ?? null,
    comments: c.comments.map((cm) => ({
      id: cm.id,
      authorId: cm.authorId,
      authorName: cm.authorName,
      body: cm.body,
      createdAt: cm.createdAt.toISOString(),
    })),
    attachmentName: c.attachmentPath ? (c.attachmentName ?? c.attachmentPath) : null,
    recurringCostId: c.recurringCostId,
    planned: c.needsConfirmation, // zaplanowana przyszła kopia cykliczna
  }));

  const pendingRows: PendingCostRow[] = pendingCosts.map((c) => ({
    id: c.id,
    supplierName: c.supplierName,
    docNumber: c.docNumber,
    grossGr: c.grossGr,
    categoryName: c.category.name,
  }));

  const templateRows: RecurringRow[] = templates.map((t) => ({
    id: t.id,
    active: t.active,
    supplierName: t.supplierName,
    docNumber: t.docNumber,
    netGr: t.netGr,
    vatRate: t.vatRate,
    categoryName: t.category.name,
    clientName: t.client?.name ?? null,
    dueDayOfMonth: t.dueDayOfMonth,
    endPeriod: t.endPeriod,
  }));

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const supplierNames = suppliers.map((s) => s.supplierName);

  return (
    <>
      <PageHeader
        title="Koszty"
        description="Rejestr kosztów adGen — wydatki, koszty cykliczne, pozycje do potwierdzenia."
      />
      <div className="space-y-4">
        {(adBudget.planGr > 0 || adBudget.spentGr > 0) && (
          <AdBudgetSummary status={adBudget} variant="banner" />
        )}
        {pendingRows.length > 0 && <PendingCosts items={pendingRows} />}
        <CostsTable
          costs={rows}
          categories={categoryOptions}
          clients={clients}
          supplierNames={supplierNames}
          templates={templateRows}
          prevVat={prevVat}
          currentUserId={me.id}
          authDisabled={isAuthDisabled()}
        />
      </div>
    </>
  );
}
