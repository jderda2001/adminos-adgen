"use client";

// Donut "Struktura kosztów per kategoria" — koszty netto z wybranego okresu.
// Legenda własna (HTML): nazwa kategorii + kwota + udział procentowy.

import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { ChartFrame } from "@/components/chart-frame";
import { EmptyState } from "@/components/empty-state";
import { formatMoney, formatPercent } from "@/lib/format";
import { PIE_COLORS } from "./chart-shared";

export interface CostSlice {
  categoryId: string;
  categoryName: string;
  netGr: number;
}

export function CostStructureChart({ slices }: { slices: CostSlice[] }) {
  if (slices.length === 0) {
    return (
      <EmptyState
        title="Brak kosztów w okresie"
        description="Dodaj koszty w module Finanse → Koszty, aby zobaczyć ich strukturę per kategoria."
        className="py-10"
      />
    );
  }

  const totalGr = slices.reduce((sum, s) => sum + s.netGr, 0);
  const data = slices.map((s, i) => ({
    categoryId: s.categoryId,
    name: s.categoryName,
    value: s.netGr / 100,
    netGr: s.netGr,
    share: totalGr > 0 ? s.netGr / totalGr : 0,
    color: PIE_COLORS[i % PIE_COLORS.length],
  }));

  return (
    <div className="flex flex-col gap-3">
      <ChartFrame height={210}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((entry) => (
              <Cell key={entry.categoryId} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;
              const row = payload[0].payload as {
                name: string;
                netGr: number;
                share: number;
              };
              return (
                <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <p className="mb-1 font-medium">{row.name}</p>
                  <p className="tabular-nums">
                    {formatMoney(row.netGr)} · {formatPercent(row.share)}
                  </p>
                </div>
              );
            }}
          />
        </PieChart>
      </ChartFrame>

      <ul className="space-y-1 text-xs">
        {data.map((s) => (
          <li key={s.categoryId} className="flex items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-sm"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{s.name}</span>
            <span className="font-medium tabular-nums">
              {formatMoney(s.netGr)}
            </span>
            <span className="w-12 text-right tabular-nums text-muted-foreground">
              {formatPercent(s.share)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
