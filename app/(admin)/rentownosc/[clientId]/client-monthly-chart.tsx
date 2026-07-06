"use client";

// Wykres rentowności klienta per miesiąc (ostatnie 12 miesięcy):
// słupki przychodów i kosztów (bezpośrednie + praca, bez wynagrodzeń
// i alokacji — tak zwraca getClientMonthlyProfit), linia zysku.

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "@/components/chart-frame";
import { formatMoney, formatMonth, formatMonthShort } from "@/lib/format";

export interface MonthlyChartPoint {
  month: string; // "RRRR-MM"
  revenueGr: number;
  costsGr: number;
  profitGr: number;
}

const plCompact = new Intl.NumberFormat("pl-PL", {
  maximumFractionDigits: 1,
});
const plWhole = new Intl.NumberFormat("pl-PL", {
  maximumFractionDigits: 0,
});

/** Skrócona kwota na oś Y: 1 234 500 gr → "12 tys.", 250 000 000 gr → "2,5 mln" */
function shortPln(grosze: number): string {
  const zl = grosze / 100;
  const abs = Math.abs(zl);
  if (abs >= 1_000_000) return `${plCompact.format(zl / 1_000_000)} mln`;
  if (abs >= 1_000) return `${plWhole.format(zl / 1_000)} tys.`;
  return plWhole.format(zl);
}

export function ClientMonthlyChart({ data }: { data: MonthlyChartPoint[] }) {
  return (
    <ChartFrame height={288}>
      <ComposedChart
        data={data}
        margin={{ top: 8, right: 8, bottom: 0, left: 4 }}
      >
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="month"
            tickFormatter={(value) => formatMonthShort(String(value))}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
          />
          <YAxis
            tickFormatter={(value) => shortPln(Number(value))}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            formatter={(value: unknown, name: unknown) => [
              formatMoney(Number(value)),
              String(name),
            ]}
            labelFormatter={(label: unknown) => formatMonth(String(label))}
            contentStyle={{
              backgroundColor: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
              color: "var(--popover-foreground)",
            }}
            labelStyle={{
              color: "var(--popover-foreground)",
              fontWeight: 600,
            }}
            itemStyle={{ color: "var(--popover-foreground)" }}
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="revenueGr"
            name="Przychody"
            fill="var(--chart-2)"
            radius={[3, 3, 0, 0]}
            maxBarSize={28}
          />
          <Bar
            dataKey="costsGr"
            name="Koszty"
            fill="var(--chart-1)"
            radius={[3, 3, 0, 0]}
            maxBarSize={28}
          />
          <Line
            dataKey="profitGr"
            name="Zysk"
            type="monotone"
            stroke="var(--foreground)"
            strokeWidth={2}
            dot={{ r: 3, fill: "var(--foreground)" }}
            activeDot={{ r: 4 }}
          />
      </ComposedChart>
    </ChartFrame>
  );
}
