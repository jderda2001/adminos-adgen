// Rząd kafli KPI Dashboardu — server component, dane w groszach z lib/reports.
// Używa wspólnego KpiCard (components/kpi-card.tsx) — bez lokalnych kafli.

import { KpiCard } from "@/components/kpi-card";
import { formatMoney, formatPercent, pluralPl } from "@/lib/format";

export interface KpiCardsProps {
  pnl: {
    revenueNetGr: number;
    costsNetGr: number;
    profitGr: number;
    marginFraction: number | null;
  };
  vat: { dueGr: number };
  overdue: { totalGr: number; count: number };
  overdueCosts: { totalGr: number; count: number };
}

export function KpiCards({ pnl, vat, overdue, overdueCosts }: KpiCardsProps) {
  const profitTone =
    pnl.profitGr < 0 ? "negative" : pnl.profitGr > 0 ? "positive" : "default";

  // Marża: dodatnia → pozytywnie; zero/ujemna → ostrzeżenie/negatyw.
  const marginTone =
    pnl.marginFraction === null
      ? "default"
      : pnl.marginFraction > 0
        ? "positive"
        : pnl.marginFraction < 0
          ? "negative"
          : "warning";

  const overdueTone = overdue.totalGr > 0 ? "negative" : "default";
  const overdueSub = `${overdue.count} ${pluralPl(
    overdue.count,
    "faktura",
    "faktury",
    "faktur"
  )} · brutto`;

  const overdueCostsTone = overdueCosts.totalGr > 0 ? "negative" : "default";
  const overdueCostsSub = `${overdueCosts.count} ${pluralPl(
    overdueCosts.count,
    "koszt",
    "koszty",
    "kosztów"
  )} · brutto`;

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
      <KpiCard label="Przychody netto" value={formatMoney(pnl.revenueNetGr)} />
      <KpiCard label="Koszty netto" value={formatMoney(pnl.costsNetGr)} />
      <KpiCard
        label="Zysk netto"
        value={formatMoney(pnl.profitGr)}
        sub="przychody − koszty"
        tone={profitTone}
      />
      <KpiCard
        label="Marża %"
        value={formatPercent(pnl.marginFraction)}
        sub="zysk / przychody"
        tone={marginTone}
      />
      <KpiCard
        label="VAT do zapłaty"
        value={formatMoney(vat.dueGr)}
        sub={vat.dueGr < 0 ? "nadwyżka naliczonego" : "należny − naliczony"}
      />
      <KpiCard
        label="Należności przeterminowane"
        value={formatMoney(overdue.totalGr)}
        sub={overdueSub}
        tone={overdueTone}
        href="/platnosci"
      />
      <KpiCard
        label="Zobowiązania przeterminowane"
        value={formatMoney(overdueCosts.totalGr)}
        sub={overdueCostsSub}
        tone={overdueCostsTone}
        href="/platnosci"
      />
    </div>
  );
}
