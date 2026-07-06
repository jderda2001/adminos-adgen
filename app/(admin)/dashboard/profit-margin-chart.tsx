"use client";

// Wykres liniowy "Zysk i marża" — dwie osie Y: zysk w zł (lewa), marża w % (prawa).
// Miesiące bez przychodów mają marginFraction = null — linia marży jest przerywana
// (connectNulls={false}), zysk rysowany zawsze.

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "@/components/chart-frame";
import { EmptyState } from "@/components/empty-state";
import {
  formatMoney,
  formatMonth,
  formatMonthShort,
  formatPercent,
} from "@/lib/format";
import {
  CHART_COLORS,
  formatAxisZl,
  type MonthlyChartPoint,
} from "./chart-shared";

export function ProfitMarginChart({ points }: { points: MonthlyChartPoint[] }) {
  const hasData = points.some((p) => p.revenueGr !== 0 || p.costsGr !== 0);
  if (!hasData) {
    return (
      <EmptyState
        title="Brak danych do wykresu"
        description="Dodaj faktury sprzedażowe i koszty, aby zobaczyć zysk i marżę w ujęciu miesięcznym."
        className="py-10"
      />
    );
  }

  const data = points.map((p) => ({
    month: p.month,
    profit: p.profitGr / 100,
    margin: p.marginFraction !== null ? p.marginFraction * 100 : null,
    profitGr: p.profitGr,
    marginFraction: p.marginFraction,
  }));

  return (
    <ChartFrame height={280}>
      <ComposedChart
        data={data}
        margin={{ top: 4, right: 0, left: 0, bottom: 0 }}
      >
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
          yAxisId="profit"
          tickFormatter={formatAxisZl}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={56}
        />
        <YAxis
          yAxisId="margin"
          orientation="right"
          tickFormatter={(v: number) => `${v}%`}
          tick={{ fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={44}
        />
        <ReferenceLine yAxisId="profit" y={0} stroke="var(--border)" />
        <Tooltip
          content={({ active, payload, label }) => {
            if (!active || !payload || payload.length === 0) return null;
            const row = payload[0].payload as {
              profitGr: number;
              marginFraction: number | null;
            };
            return (
              <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                <p className="mb-1 font-medium">{formatMonth(String(label))}</p>
                <p className="flex items-center justify-between gap-4">
                  <span style={{ color: CHART_COLORS.profit }}>Zysk</span>
                  <span className="font-medium tabular-nums">
                    {formatMoney(row.profitGr)}
                  </span>
                </p>
                <p className="flex items-center justify-between gap-4">
                  <span style={{ color: CHART_COLORS.margin }}>Marża</span>
                  <span className="font-medium tabular-nums">
                    {formatPercent(row.marginFraction)}
                  </span>
                </p>
              </div>
            );
          }}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          yAxisId="profit"
          type="monotone"
          dataKey="profit"
          name="Zysk (zł)"
          stroke={CHART_COLORS.profit}
          strokeWidth={2}
          dot={false}
        />
        <Line
          yAxisId="margin"
          type="monotone"
          dataKey="margin"
          name="Marża (%)"
          stroke={CHART_COLORS.margin}
          strokeWidth={2}
          strokeDasharray="4 3"
          dot={false}
          connectNulls={false}
        />
      </ComposedChart>
    </ChartFrame>
  );
}
