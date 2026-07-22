import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { refreshInvoiceStatuses, getActiveVerticalNames } from "@/lib/reports";
import { resolvePeriod, monthKey } from "@/lib/periods";
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

function splitTags(raw: string | null): string[] {
  return (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean);
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

  // ── Estymacja przyszłego miesiąca ────────────────────────────────────
  // Umowy w toku (typ INDEFINITE_NOTICE, aktywne) kopiują kwotę z OSTATNIEGO
  // zafakturowanego miesiąca 1:1 na kolejne miesiące — dopóki nie ma
  // wypowiedzenia (endDate). Pozycje „Estymacja" są syntetyczne (read-only) i
  // znikają, gdy klient dostanie realny przychód w tym miesiącu.
  const currentMonth = monthKey(todayUTC());
  const selectedMonth = monthKey(period.from);
  const lastDayOfPeriod = new Date(period.to.getTime() - 86_400_000);
  const singleMonth = monthKey(lastDayOfPeriod) === selectedMonth;
  const doEstimate = singleMonth && selectedMonth > currentMonth && !statusFilter;
  let estimatedMonth = false;

  if (doEstimate) {
    const invoicedClientIds = new Set(invoices.map((i) => i.clientId));
    const ongoing = await db.client.findMany({
      where: {
        status: "ACTIVE",
        contractType: "INDEFINITE_NOTICE",
        ...(clientFilter ? { id: clientFilter } : {}),
      },
      select: { id: true, name: true, email: true, phone: true, startDate: true, endDate: true },
    });
    const eligible = ongoing.filter((c) => {
      if (invoicedClientIds.has(c.id)) return false; // realny przychód już jest
      const startOk = !c.startDate || monthKey(c.startDate) <= selectedMonth;
      const endOk = !c.endDate || selectedMonth <= monthKey(c.endDate); // po wypowiedzeniu → stop
      return startOk && endOk;
    });
    if (eligible.length > 0) {
      // ostatni zafakturowany miesiąc (przed wybranym) per klient — kwota do kopii
      const prior = await db.invoice.findMany({
        where: {
          clientId: { in: eligible.map((c) => c.id) },
          status: { not: "DRAFT" },
          saleDate: { lt: period.from },
        },
        select: { clientId: true, saleDate: true, netGr: true, vatGr: true, grossGr: true, offerTags: true },
        orderBy: { saleDate: "desc" },
      });
      const carry = new Map<
        string,
        { month: string; netGr: number; vatGr: number; grossGr: number; tags: Set<string> }
      >();
      for (const inv of prior) {
        const m = monthKey(inv.saleDate);
        const cur = carry.get(inv.clientId);
        if (!cur) {
          carry.set(inv.clientId, {
            month: m,
            netGr: inv.netGr,
            vatGr: inv.vatGr,
            grossGr: inv.grossGr,
            tags: new Set(splitTags(inv.offerTags)),
          });
        } else if (m === cur.month) {
          cur.netGr += inv.netGr;
          cur.vatGr += inv.vatGr;
          cur.grossGr += inv.grossGr;
          for (const t of splitTags(inv.offerTags)) cur.tags.add(t);
        }
      }
      const iso = period.from.toISOString();
      for (const c of eligible) {
        const cc = carry.get(c.id);
        if (!cc || cc.netGr <= 0) continue;
        rows.push({
          id: `est-${c.id}`,
          number: "",
          label: "Estymacja — kopia z poprzedniego miesiąca",
          clientId: c.id,
          clientName: c.name,
          issueDate: iso,
          saleDate: iso,
          dueDate: iso,
          paidDate: null,
          status: "ESTYMACJA",
          netGr: cc.netGr,
          vatGr: cc.vatGr,
          grossGr: cc.grossGr,
          vatRate: inferVatRate(cc.netGr, cc.vatGr),
          offerTags: [...cc.tags].join(",") || null,
          notes: null,
          leadsQty: null,
          leadUnitPriceGr: null,
          leadActivationFeeGr: null,
          leadGuaranteePct: null,
          remindersEnabled: false,
          reminders: [],
          clientHasEmail: Boolean(c.email),
          clientHasPhone: Boolean(c.phone),
          attachmentName: null,
        });
        estimatedMonth = true;
      }
    }
  }

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
      estimatedMonth={estimatedMonth}
    />
  );
}
