"use client";

// KPI roczne Rachunku Wyników — wartości WYŁĄCZNIE z report.suma / report.srednia
// (silnik lib/rw.ts liczy wszystko). Jedyne lokalne wyliczenie: % realizacji
// celu przychodów (prezentacja celu 1 mln zł, nie metryka domenowa).

import { KpiCard, type KpiTone } from "@/components/kpi-card";
import { pluralPl } from "@/lib/format";
import type { RwReport } from "@/lib/rw";
import { formatRwPct, formatZl } from "./rw-format";

/** Cel roczny przychodów: 1 000 000 zł = 100 000 000 gr */
const REVENUE_GOAL_GR = 100_000_000;

export function RwKpis({ report }: { report: RwReport }) {
  const { suma, srednia } = report;
  const n = report.monthsWithData.length;

  const zyskTone: KpiTone =
    suma.zyskGr > 0 ? "positive" : suma.zyskGr < 0 ? "negative" : "default";
  const marza2Tone: KpiTone =
    suma.marza2 === null
      ? "default"
      : suma.marza2 >= 0.1
        ? "positive"
        : "negative";

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
      <KpiCard
        label="Przychody (rok)"
        value={formatZl(suma.revenueTotalGr)}
        sub={`cel 1 000 000 zł · ${formatRwPct(
          suma.revenueTotalGr / REVENUE_GOAL_GR
        )} realizacji`}
      />
      <KpiCard
        label="Koszty (rok)"
        value={formatZl(suma.costsTotalGr)}
        tone="negative"
        sub="bez odłożonych środków"
      />
      <KpiCard
        label="Zysk (rok)"
        value={formatZl(suma.zyskGr)}
        tone={zyskTone}
        sub="przed podatkiem CIT"
      />
      <KpiCard
        label="Marża II (rok)"
        value={formatRwPct(suma.marza2)}
        tone={marza2Tone}
        sub="cel 10%"
      />
      <KpiCard
        label="Marża I (rok)"
        value={formatRwPct(suma.marza1)}
        sub="po kosztach produkcyjnych"
      />
      <KpiCard
        label="Śr. mies. przychód"
        value={srednia ? formatZl(srednia.revenueTotalGr) : "—"}
        sub={
          srednia
            ? `z ${n} ${pluralPl(n, "miesiąca", "miesięcy", "miesięcy")} z danymi`
            : "brak miesięcy z danymi"
        }
      />
    </div>
  );
}
