import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  getClientMonthlyProfit,
  getClientProfitability,
} from "@/lib/reports";
import { resolvePeriod, type PeriodSearchParams } from "@/lib/periods";
import { getSalaryCategoryIds } from "@/lib/settings";
import { effectiveRateGr, laborCostGr } from "@/lib/calc";
import {
  formatDate,
  formatHours,
  formatMoney,
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
  // więc wyłączamy je z tabeli kosztów bezpośrednich — aby suma zgadzała się z
  // kosztem bezpośrednim uwzględnianym w KPI.
  const salaryCategoryIds = await getSalaryCategoryIds();

  const [prof, monthly, invoices, costs, entries, users] = await Promise.all([
    getClientProfitability(period),
    getClientMonthlyProfit(client.id, 12),
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
        categoryId: { notIn: [...salaryCategoryIds] },
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
    db.timeEntry.findMany({
      where: { clientId: client.id, date: { gte: period.from, lt: period.to } },
      select: { userId: true, minutes: true, date: true },
    }),
    db.user.findMany({ select: { id: true, name: true, rates: true } }),
  ]);

  const row = prof.rows.find((r) => r.clientId === client.id);
  const kpi = {
    revenueGr: row?.revenueGr ?? 0,
    profitGr: row?.profitGr ?? 0,
    marginFraction: row?.marginFraction ?? null,
    minutes: row?.minutes ?? 0,
    effectiveRateGr: row?.effectiveRateGr ?? null,
  };

  // czas pracy zagregowany per osoba — koszt pracy liczony per wpis
  // wg stawki obowiązującej w dniu wpisu (effectiveRateGr / laborCostGr)
  const ratesByUser = new Map(users.map((u) => [u.id, u.rates]));
  const nameByUser = new Map(users.map((u) => [u.id, u.name]));
  const laborByUser = new Map<string, { minutes: number; laborGr: number }>();
  for (const e of entries) {
    const rate = effectiveRateGr(ratesByUser.get(e.userId) ?? [], e.date);
    const prev = laborByUser.get(e.userId) ?? { minutes: 0, laborGr: 0 };
    laborByUser.set(e.userId, {
      minutes: prev.minutes + e.minutes,
      laborGr: prev.laborGr + laborCostGr(e.minutes, rate),
    });
  }
  const laborRows = [...laborByUser.entries()]
    .map(([userId, v]) => ({
      userId,
      name: nameByUser.get(userId) ?? "(nieznana osoba)",
      minutes: v.minutes,
      laborGr: v.laborGr,
    }))
    .sort((a, b) => b.laborGr - a.laborGr);

  const invoicesNetSumGr = invoices.reduce((a, i) => a + i.netGr, 0);
  const costsNetSumGr = costs.reduce((a, c) => a + c.netGr, 0);
  const laborSum = laborRows.reduce(
    (acc, r) => ({
      minutes: acc.minutes + r.minutes,
      laborGr: acc.laborGr + r.laborGr,
    }),
    { minutes: 0, laborGr: 0 }
  );

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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
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
          <KpiCard label="Godziny" value={formatHours(kpi.minutes)} />
          <KpiCard
            label="Efektywna stawka"
            value={
              kpi.effectiveRateGr !== null
                ? `${formatMoney(kpi.effectiveRateGr)}/h`
                : "—"
            }
            sub="przychody / godziny"
          />
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="font-heading text-base font-semibold">
            Rentowność miesięczna
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Ostatnie 12 miesięcy
          </p>
          <ClientMonthlyChart data={monthly} />
          <p className="mt-2 text-xs text-muted-foreground">
            Koszty obejmują koszty bezpośrednie i koszt pracy z godzin (bez
            kategorii „wynagrodzenia” i bez alokacji kosztów ogólnych).
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
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

          <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
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
              Bez kategorii wynagrodzeń (rozliczane kosztem pracy).
            </p>
          </section>
        </div>

        <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="font-heading text-base font-semibold">
            Czas pracy w okresie — per osoba
          </h2>
          <div className="mt-3 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Osoba</TableHead>
                  <TableHead className="text-right">Godziny</TableHead>
                  <TableHead className="text-right">Koszt pracy</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {laborRows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      Brak zarejestrowanego czasu pracy dla tego klienta w
                      wybranym okresie.
                    </TableCell>
                  </TableRow>
                ) : (
                  laborRows.map((r) => (
                    <TableRow key={r.userId}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatHours(r.minutes)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(r.laborGr)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
              {laborRows.length > 0 && (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-medium">Suma</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatHours(laborSum.minutes)}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatMoney(laborSum.laborGr)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </section>
      </div>
    </>
  );
}
