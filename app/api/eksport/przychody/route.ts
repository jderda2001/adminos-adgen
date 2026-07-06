// Eksport CSV przychodów — te same filtry co strona /finanse/przychody
// (okres po dacie sprzedaży, klient, status), polskie formaty kwot i dat.

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { refreshInvoiceStatuses } from "@/lib/reports";
import { resolvePeriod } from "@/lib/periods";
import { csvResponse, toCsv } from "@/lib/csv";
import { dateToInput, formatAmount, formatDate } from "@/lib/format";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  type InvoiceStatus,
} from "@/lib/types";

export async function GET(request: Request): Promise<Response> {
  await requireAdmin();
  await refreshInvoiceStatuses();

  const { searchParams } = new URL(request.url);
  const period = resolvePeriod({
    okres: searchParams.get("okres") ?? undefined,
    od: searchParams.get("od") ?? undefined,
    do: searchParams.get("do") ?? undefined,
  });
  const clientFilter = searchParams.get("klient") ?? "";
  const statusRaw = searchParams.get("status") ?? "";
  const statusFilter = (INVOICE_STATUSES as readonly string[]).includes(
    statusRaw
  )
    ? statusRaw
    : "";

  const invoices = await db.invoice.findMany({
    where: {
      saleDate: { gte: period.from, lt: period.to },
      ...(clientFilter ? { clientId: clientFilter } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
    },
    include: { client: { select: { name: true } } },
    orderBy: { saleDate: "desc" },
  });

  // Kolumny rejestru przychodów (odwzorowanie arkusza adGen)
  const headers = [
    "Status",
    "Klient",
    "Opis",
    "Netto",
    "Brutto",
    "Termin",
    "Oferta",
    "Uwagi",
    "Data zapłaty",
  ];

  const rows = invoices.map((inv) => [
    INVOICE_STATUS_LABELS[inv.status as InvoiceStatus] ?? inv.status,
    inv.client.name,
    inv.label ?? "",
    formatAmount(inv.netGr),
    formatAmount(inv.grossGr),
    formatDate(inv.dueDate),
    inv.offerTags ?? "",
    inv.notes ?? "",
    inv.paidDate ? formatDate(inv.paidDate) : "",
  ]);

  // Zakres okresu jest półotwarty [from, to) — w nazwie pliku ostatni dzień włącznie
  const lastDayInclusive = new Date(period.to.getTime() - 86_400_000);
  const filename = `przychody_${dateToInput(period.from)}_${dateToInput(lastDayInclusive)}.csv`;

  return csvResponse(toCsv(headers, rows), filename);
}
