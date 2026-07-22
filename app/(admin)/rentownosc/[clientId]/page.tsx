import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  getClientLeadCosts,
  getClientMonthlyProfit,
  getClientProfitability,
} from "@/lib/reports";
import { resolvePeriod, type PeriodSearchParams } from "@/lib/periods";
import { getAdBudgetCategoryIds, getSalaryCategoryIds } from "@/lib/settings";
import {
  formatDate,
  formatMoney,
  formatMonth,
  formatPercent,
} from "@/lib/format";
import {
  INVOICE_STATUS_LABELS,
  BILLING_MODEL_LABELS,
  type BillingModel,
  type InvoiceStatus,
} from "@/lib/types";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { KpiCard } from "@/components/kpi-card";
import { StatusBadge, invoiceTone } from "@/components/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClientMonthlyChart } from "./client-monthly-chart";

export const metadata: Metadata = { title: "Rentowność klienta" };

export default async function ClientProfitabilityPage({
  params,
  searchParams,
}: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<PeriodSearchParams>;
}) {
  await requireAdmin();
  const { clientId } = await params;
  const period = resolvePeriod(await searchParams);

  const client = await db.client.findUnique({ where: { id: clientId } });
  if (!client) notFound();

  // Kategorie wynagrodzeń są w rentowności rozliczane kosztem pracy z godzin,
  // a budżetu reklamowego — kosztem leadów (moduł Leady), więc wyłączamy obie
  // z tabeli kosztów bezpośrednich — aby suma zgadzała się z KPI.
  const [salaryCategoryIds, adBudgetCategoryIds] = await Promise.all([
    getSalaryCategoryIds(),
    getAdBudgetCategoryIds(),
  ]);

  const [prof, monthly, leadCosts, invoices, costs] = await Promise.all([
    getClientProfitability(period),
    getClientMonthlyProfit(client.id, 12),
    getClientLeadCosts(client.id, period),
    db.invoice.findMany({
      where: {
        clientId: client.id,
        status: { not: "DRAFT" },
        saleDate: { gte: period.from, lt: period.to },
      },
      orderBy: { saleDate: "desc" },
      select: { id: true, number: true, saleDate: true, netGr: true, status: true },
    }),
    db.cost.findMany({
      where: {
        clientId: client.id,
        needsConfirmation: false,
        category: { isDeferred: false },
        categoryId: { notIn: [...salaryCategoryIds, ...adBudgetCategoryIds] },
        docDate: { gte: period.from, lt: period.to },
      },
      orderBy: { docDate: "desc" },
      select: {
        id: true,
        docDate: true,
        supplierName: true,
        netGr: true,
        category: { select: { name: true } },
      },
    }),
  ]);

  const row = prof.rows.find((r) => r.clientId === client.id);
  const kpi = {
    revenueGr: row?.revenueGr ?? 0,
    profitGr: row?.profitGr ?? 0,
    marginFraction: row?.marginFraction ?? null,
  };

  const invoicesNetSumGr = invoices.reduce((a, i) => a + i.netGr, 0);
  const costsNetSumGr = costs.reduce((a, c) => a + c.netGr, 0);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/rentownosc"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Rentowność
        </Link>
      </div>

      <PageHeader
        title={client.name}
        description={`Rentowność klienta (${
          BILLING_MODEL_LABELS[client.billingModel as BillingModel] ??
          client.billingModel
        })`}
      >
        <span className="text-sm font-medium text-muted-foreground">
          {period.label}
        </span>
        <PeriodFilter />
      </PageHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Przychody" value={formatMoney(kpi.revenueGr)} />
          <KpiCard
            label="Zysk"
            value={formatMoney(kpi.profitGr)}
            tone={
              kpi.profitGr < 0
                ? "negative"
                : kpi.profitGr > 0
                  ? "positive"
                  : "default"
            }
          />
          <KpiCard label="Marża" value={formatPercent(kpi.marginFraction)} />
        </div>

        <div className="min-w-0 rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="font-heading text-base font-semibold">
            Rentowność miesięczna
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Ostatnie 12 miesięcy
          </p>
          <ClientMonthlyChart data={monthly} />
          <p className="mt-2 text-xs text-muted-foreground">
            Koszty obejmują koszty bezpośrednie i koszt leadów (bez kategorii
            „wynagrodzenia” i bez alokacji kosztów ogólnych).
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="min-w-0 rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
            <h2 className="font-heading text-base font-semibold">
              Faktury w okresie{" "}
              <span className="text-sm font-normal text-muted-foreground">
                (bez szkiców)
              </span>
            </h2>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Numer</TableHead>
                    <TableHead>Data sprzedaży</TableHead>
                    <TableHead className="text-right">Netto</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Brak faktur w wybranym okresie.
                      </TableCell>
                    </TableRow>
                  ) : (
                    invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          {inv.number ?? (
                            <span className="text-muted-foreground">
                              (bez numeru)
                            </span>
                          )}
                        </TableCell>
                        <TableCell>{formatDate(inv.saleDate)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(inv.netGr)}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={invoiceTone(inv.status)}>
                            {INVOICE_STATUS_LABELS[
                              inv.status as InvoiceStatus
                            ] ?? inv.status}
                          </StatusBadge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {invoices.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={2} className="font-medium">
                        Suma
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(invoicesNetSumGr)}
                      </TableCell>
                      <TableCell />
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          </section>

          <section className="min-w-0 rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
            <h2 className="font-heading text-base font-semibold">
              Koszty przypisane w okresie
            </h2>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Dostawca</TableHead>
                    <TableHead>Kategoria</TableHead>
                    <TableHead className="text-right">Netto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {costs.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Brak kosztów przypisanych do klienta w wybranym
                        okresie.
                      </TableCell>
                    </TableRow>
                  ) : (
                    costs.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>{formatDate(c.docDate)}</TableCell>
                        <TableCell className="font-medium">
                          {c.supplierName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.category.name}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(c.netGr)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {costs.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Suma
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(costsNetSumGr)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Bez kategorii wynagrodzeń (rozliczane kosztem pracy) i budżetu
              reklamowego (rozliczany kosztem leadów).
            </p>
          </section>
        </div>

        {(leadCosts.rows.length > 0 || client.billingModel === "PAKIETY_LEADOW") && (
          <section className="min-w-0 rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
            <h2 className="font-heading text-base font-semibold">
              Leady w okresie
            </h2>
            <div className="mt-3 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Miesiąc</TableHead>
                    <TableHead>Marka</TableHead>
                    <TableHead>Wertykal</TableHead>
                    <TableHead className="text-right">Leady</TableHead>
                    <TableHead className="text-right">CPL</TableHead>
                    <TableHead className="text-right">Koszt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leadCosts.rows.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-sm text-muted-foreground"
                      >
                        Brak dostaw leadów w okresie — dodaj je w module Leady.
                      </TableCell>
                    </TableRow>
                  ) : (
                    leadCosts.rows.map((r) => (
                      <TableRow key={r.deliveryId}>
                        <TableCell className="capitalize">
                          {formatMonth(r.period)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.brandName ?? "mix"}
                        </TableCell>
                        <TableCell>{r.vertical}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.leadsCount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.cplGr !== null ? formatMoney(r.cplGr) : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatMoney(r.costGr)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
                {leadCosts.rows.length > 0 && (
                  <TableFooter>
                    <TableRow>
                      <TableCell colSpan={3} className="font-medium">
                        Suma
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {leadCosts.totalLeads}
                      </TableCell>
                      <TableCell />
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(leadCosts.totalGr)}
                      </TableCell>
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Koszt leadów = leady × CPL kampanii (moduł Leady) — pomniejsza
              zysk klienta.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
