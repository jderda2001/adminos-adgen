import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { refreshInvoiceStatuses, getActiveVerticalNames } from "@/lib/reports";
import { resolvePeriod } from "@/lib/periods";
import { INVOICE_STATUSES, VAT_RATES, VAT_RATE_FRACTIONS } from "@/lib/types";
import { todayUTC } from "@/lib/format";
import type { ExistingReminder } from "@/lib/payment-reminders";
import {
  InvoicesTable,
  type InvoiceRow,
  type RevenueKpis,
} from "./invoices-table";

export const metadata: Metadata = { title: "Przychody" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Rejestr trzyma jedną kwotę zbiorczą (bez pozycji) — stawkę VAT do wyświetlenia
 * odczytujemy z proporcji vatGr/netGr, dopasowując do znanej stawki.
 */
function inferVatRate(netGr: number, vatGr: number): string {
  if (netGr <= 0) return vatGr === 0 ? "ZW" : "23";
  const fraction = vatGr / netGr;
  let best = "23";
  let bestDiff = Infinity;
  for (const rate of VAT_RATES) {
    const diff = Math.abs(VAT_RATE_FRACTIONS[rate] - fraction);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = rate;
    }
  }
  return best;
}

export default async function RevenuesPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireAdmin();
  // Auto-przeterminowanie: ISSUED po terminie → OVERDUE (i odwrotnie po edycji terminu)
  await refreshInvoiceStatuses();

  const params = await searchParams;
  // Okres filtrowany po DACIE PRZYCHODU — do tego miesiąca liczony jest przychód
  const period = resolvePeriod({
    okres: first(params.okres),
    od: first(params.od),
    do: first(params.do),
  });
  const clientFilter = first(params.klient) ?? "";
  const statusRaw = first(params.status) ?? "";
  const statusFilter = (INVOICE_STATUSES as readonly string[]).includes(
    statusRaw
  )
    ? statusRaw
    : "";

  const [invoices, clients, leadVerticals] = await Promise.all([
    db.invoice.findMany({
      where: {
        saleDate: { gte: period.from, lt: period.to },
        ...(clientFilter ? { clientId: clientFilter } : {}),
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      include: {
        client: { select: { name: true, email: true, phone: true } },
        reminders: {
          select: {
            stepKey: true,
            channel: true,
            status: true,
            sentAt: true,
            note: true,
            actedByName: true,
          },
        },
      },
      orderBy: { saleDate: "desc" },
    }),
    db.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getActiveVerticalNames(),
  ]);

  const rows: InvoiceRow[] = invoices.map((inv) => ({
    id: inv.id,
    number: inv.number ?? "",
    label: inv.label,
    clientId: inv.clientId,
    clientName: inv.client.name,
    issueDate: inv.issueDate.toISOString(),
    saleDate: inv.saleDate.toISOString(),
    dueDate: inv.dueDate.toISOString(),
    paidDate: inv.paidDate?.toISOString() ?? null,
    status: inv.status,
    netGr: inv.netGr,
    vatGr: inv.vatGr,
    grossGr: inv.grossGr,
    vatRate: inferVatRate(inv.netGr, inv.vatGr),
    offerTags: inv.offerTags,
    notes: inv.notes,
    leadsQty: inv.leadsQty,
    leadUnitPriceGr: inv.leadUnitPriceGr,
    leadActivationFeeGr: inv.leadActivationFeeGr,
    leadGuaranteePct: inv.leadGuaranteePct,
    remindersEnabled: inv.remindersEnabled,
    reminders: inv.reminders.map((r) => ({
      stepKey: r.stepKey,
      channel: r.channel as "SMS" | "EMAIL" | "PHONE",
      status: r.status as ExistingReminder["status"],
      sentAt: r.sentAt?.toISOString() ?? null,
      note: r.note,
      actedByName: r.actedByName,
    })),
    clientHasEmail: Boolean(inv.client.email),
    clientHasPhone: Boolean(inv.client.phone),
    attachmentName: inv.attachmentName,
  }));

  // KPI miesiąca — na kwotach netto (agregat finansowy liczony netto).
  // „Zafakturowane niezapłacone" = wysłane + przeterminowane; „Zapłacone" = PAID.
  const kpis: RevenueKpis = rows.reduce<RevenueKpis>(
    (acc, r) => {
      // Szkice (DRAFT) nie są przychodem — spójnie z Dashboardem/Rentownością
      // (REVENUE_WHERE wyklucza DRAFT). W tabeli poniżej pozostają widoczne.
      if (r.status === "DRAFT") return acc;
      acc.netGr += r.netGr;
      acc.grossGr += r.grossGr;
      if (r.status === "PAID") acc.paidNetGr += r.netGr;
      else if (r.status === "ISSUED" || r.status === "OVERDUE")
        acc.issuedNetGr += r.netGr;
      acc.count += 1;
      return acc;
    },
    { netGr: 0, grossGr: 0, issuedNetGr: 0, paidNetGr: 0, count: 0 }
  );

  return (
    <InvoicesTable
      invoices={rows}
      clients={clients}
      kpis={kpis}
      leadVerticals={leadVerticals}
      todayIso={todayUTC().toISOString()}
    />
  );
}
