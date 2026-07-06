import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { generateRecurringCosts, refreshInvoiceStatuses } from "@/lib/reports";
import { daysOverdue, todayUTC } from "@/lib/format";
import { isValidNrb } from "@/lib/elixir";
import { PageHeader } from "@/components/page-header";
import { PaymentsTabs, type PaymentsTab } from "./payments-tabs";
import type { PayableRow } from "./payables-table";
import type { ReceivableRow } from "./receivables-table";

export const metadata: Metadata = { title: "Płatności" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ zakladka?: string }>;
}) {
  await requireAdmin();
  await generateRecurringCosts();
  await refreshInvoiceStatuses();

  const params = await searchParams;
  const defaultTab: PaymentsTab =
    params.zakladka === "do-sciagniecia" ? "do-sciagniecia" : "do-zaplaty";

  const today = todayUTC();

  const [costs, invoices] = await Promise.all([
    db.cost.findMany({
      where: { paid: false, needsConfirmation: false },
      include: { category: true },
      orderBy: { dueDate: "asc" },
    }),
    db.invoice.findMany({
      where: { status: { in: ["ISSUED", "OVERDUE"] } },
      include: { client: true },
      orderBy: { dueDate: "asc" },
    }),
  ]);

  const payables: PayableRow[] = costs.map((c) => ({
    id: c.id,
    dueDate: c.dueDate?.toISOString() ?? null,
    docDate: c.docDate.toISOString(),
    overdueDays: c.dueDate ? daysOverdue(c.dueDate, today) : null,
    supplierName: c.supplierName,
    docNumber: c.docNumber,
    categoryName: c.category.name,
    netGr: c.netGr,
    vatGr: c.vatGr,
    grossGr: c.grossGr,
    account: c.supplierAccount,
    accountValid: c.supplierAccount !== null && isValidNrb(c.supplierAccount),
    approvedForPayment: c.approvedForPayment,
    note: c.note,
  }));

  const receivables: ReceivableRow[] = invoices.map((i) => ({
    id: i.id,
    number: i.number, // String? — może być null („bez fv")
    label: i.label,
    clientName: i.client.name,
    issueDate: i.issueDate.toISOString(),
    saleDate: i.saleDate.toISOString(),
    dueDate: i.dueDate.toISOString(),
    overdueDays: daysOverdue(i.dueDate, today),
    netGr: i.netGr,
    vatGr: i.vatGr,
    grossGr: i.grossGr,
    status: i.status,
    notes: i.notes,
  }));

  return (
    <>
      <PageHeader
        title="Płatności"
        description="Niezapłacone koszty do przelewu i faktury sprzedażowe oczekujące na płatność"
      />
      <PaymentsTabs
        defaultTab={defaultTab}
        payables={payables}
        receivables={receivables}
      />
    </>
  );
}
