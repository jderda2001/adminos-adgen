import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateRecurringCosts } from "@/lib/reports";
import { PageHeader } from "@/components/page-header";
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
  await requireAdmin();

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
  const { where } = buildCostFilters(filters);

  const [costs, pendingCosts, categories, clients, suppliers, templates] =
    await Promise.all([
      db.cost.findMany({
        where,
        include: { category: true, client: true },
        orderBy: { docDate: "desc" },
      }),
      db.cost.findMany({
        where: { needsConfirmation: true },
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
    paidDate: c.paidDate?.toISOString() ?? null,
    note: c.note,
    attachmentName: c.attachmentPath ? (c.attachmentName ?? c.attachmentPath) : null,
    recurringCostId: c.recurringCostId,
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
        {pendingRows.length > 0 && <PendingCosts items={pendingRows} />}
        <CostsTable
          costs={rows}
          categories={categoryOptions}
          clients={clients}
          supplierNames={supplierNames}
          templates={templateRows}
        />
      </div>
    </>
  );
}
