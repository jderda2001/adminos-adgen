// Dashboard — rentowność firmy (tylko do odczytu).
// Wszystkie agregaty pochodzą z lib/reports (wspólne źródło prawdy z modułem Rentowność).

import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import {
  getClientProfitability,
  getCostStructure,
  getDashboardData,
  getMonthlySeries,
  refreshInvoiceStatuses,
} from "@/lib/reports";
import { resolvePeriod, type PeriodSearchParams } from "@/lib/periods";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { KpiCards } from "./kpi-cards";
import { RevenueCostsChart } from "./revenue-costs-chart";
import { ProfitMarginChart } from "./profit-margin-chart";
import { CostStructureChart } from "./cost-structure-chart";
import { RankingCards, type RankingRow } from "./rankings";

export const metadata: Metadata = { title: "Dashboard" };

/** Karta-sekcja wykresu: rounded-xl border bg-card + tytuł i podpis. */
function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3">
        <h2 className="font-heading text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<PeriodSearchParams>;
}) {
  await requireAdmin();
  await refreshInvoiceStatuses();

  const period = resolvePeriod(await searchParams);

  const [dashboard, monthly, costStructure, profitability] = await Promise.all(
    [
      getDashboardData(period),
      getMonthlySeries(12),
      getCostStructure(period),
      getClientProfitability(period),
    ]
  );

  const rankingRows: RankingRow[] = profitability.rows.map((r) => ({
    clientId: r.clientId,
    name: profitability.clientNames.get(r.clientId) ?? "(nieznany klient)",
    revenueGr: r.revenueGr,
    profitGr: r.profitGr,
    marginFraction: r.marginFraction,
  }));

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Rentowność firmy — przychody, koszty, VAT i należności"
      >
        <span className="text-sm font-medium text-muted-foreground">
          {period.label}
        </span>
        <PeriodFilter />
      </PageHeader>

      <div className="space-y-4">
        <KpiCards
          pnl={dashboard.pnl}
          vat={dashboard.vat}
          overdue={dashboard.overdue}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Przychody vs koszty"
            description="Netto, ostatnie 12 miesięcy"
          >
            <RevenueCostsChart points={monthly} />
          </ChartCard>

          <ChartCard
            title="Zysk i marża"
            description="Zysk netto (zł) i marża (%), ostatnie 12 miesięcy"
          >
            <ProfitMarginChart points={monthly} />
          </ChartCard>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <RankingCards rows={rankingRows} />

          <ChartCard
            title="Struktura kosztów per kategoria"
            description={`Koszty netto — ${period.label}`}
          >
            <CostStructureChart slices={costStructure} />
          </ChartCard>
        </div>
      </div>
    </>
  );
}
