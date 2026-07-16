"use client";

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { ChartFrame } from "@/components/chart-frame";
import { EmptyState } from "@/components/empty-state";
import { CHART_COLORS, formatAxisZl } from "@/app/(admin)/dashboard/chart-shared";
import { formatMoney, formatMonthShort } from "@/lib/format";

export interface CashChartPoint {
  period: string;
  closingGr: number;
  minGr: number;
}

export function CashChart({ points }: { points: CashChartPoint[] }) {
  if (points.length === 0) {
    return (
      <EmptyState
        title="Brak prognozy gotówki"
        description="Wpisz aktualny stan kont powyżej, aby zobaczyć prognozę salda na kolejne miesiące."
      />
    );
  }

  const data = points.map((p) => ({
    period: p.period,
    label: formatMonthShort(p.period),
    closing: p.closingGr / 100,
    min: p.minGr / 100,
    closingGr: p.closingGr,
    minGr: p.minGr,
  }));

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <h3 className="text-sm font-medium">Prognoza salda</h3>
      <p className="mb-3 text-xs text-muted-foreground">
        Saldo na koniec miesiąca oraz najniższy punkt w miesiącu (po wypłatach)
      </p>
      <ChartFrame height={260}>
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickFormatter={formatAxisZl}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={56}
          />
          <ReferenceLine y={0} stroke="var(--chart-4)" strokeDasharray="3 3" />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d = payload[0].payload as (typeof data)[number];
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
                  <div className="mb-1 font-medium">{d.label}</div>
                  <div className="tabular-nums">
                    Saldo koniec:{" "}
                    <span className={d.closingGr < 0 ? "text-red-600 dark:text-red-400" : ""}>
                      {formatMoney(d.closingGr)}
                    </span>
                  </div>
                  <div className="tabular-nums text-muted-foreground">
                    Min w miesiącu: {formatMoney(d.minGr)}
                  </div>
                </div>
              );
            }}
          />
          <Line
            type="monotone"
            dataKey="closing"
            stroke={CHART_COLORS.profit}
            strokeWidth={2}
            dot={{ r: 3 }}
            name="Saldo koniec"
          />
          <Line
            type="monotone"
            dataKey="min"
            stroke={CHART_COLORS.margin}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            name="Min w miesiącu"
          />
        </ComposedChart>
      </ChartFrame>
    </div>
  );
}
