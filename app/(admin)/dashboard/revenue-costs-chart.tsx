"use client";

// Wykres słupkowy "Przychody vs koszty" — ostatnie 12 miesięcy (netto).
// Kwoty przychodzą w groszach; osie w złotych, tooltipy formatowane z groszy.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "@/components/chart-frame";
import { EmptyState } from "@/components/empty-state";
import { formatMoney, formatMonth, formatMonthShort } from "@/lib/format";
import {
  CHART_COLORS,
  formatAxisZl,
  type MonthlyChartPoint,
} from "./chart-shared";

export function RevenueCostsChart({ points }: { points: MonthlyChartPoint[] }) {
  const hasData = points.some((p) => p.revenueGr !== 0 || p.costsGr !== 0);
  if (!hasData) {
    return (
      <EmptyState
        title="Brak danych do wykresu"
        description="Dodaj faktury sprzedażowe i koszty, aby zobaczyć przychody i koszty w ujęciu miesięcznym."
        className="py-10"
      />
    );
  }

  const data = points.map((p) => ({
    month: p.month,
    revenue: p.revenueGr / 100,
    costs: p.costsGr / 100,
    revenueGr: p.revenueGr,
    costsGr: p.costsGr,
  }));

  return (
    <ChartFrame height={280}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid
          strokeDasharray="3 3"
          vertical={false}
          stroke="var(--border)"
        />
        <XAxis
          dataKey="month"
          tickFormatter={formatMonthShort}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tickFormatter={formatAxisZl}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <Tooltip
          cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const row = payload[0].payload as {
              revenueGr: number;
              costsGr: number;
            };
            return (
              <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                <p className="mb-1 font-medium">{formatMonth(String(label))}</p>
                <p className="flex items-center justify-between gap-4">
                  <span style={{ color: CHART_COLORS.revenue }}>
                    Przychody
                  </span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(row.revenueGr)}
                  </span>
                </p>
                <p className="flex items-center justify-between gap-4">
                  <span style={{ color: CHART_COLORS.costs }}>Koszty</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(row.costsGr)}
                  </span>
                </p>
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar
          dataKey="revenue"
          name="Przychody"
          fill={CHART_COLORS.revenue}
          radius={[3, 3, 0, 0]}
          maxBarSize={22}
        />
        <Bar
          dataKey="costs"
          name="Koszty"
          fill={CHART_COLORS.costs}
          radius={[3, 3, 0, 0]}
          maxBarSize={22}
        />
      </BarChart>
    </ChartFrame>
  );
}
