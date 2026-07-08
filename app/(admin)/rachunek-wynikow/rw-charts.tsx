"use client";

// Wykresy Rachunku Wyników — 4 karty (przychody per kategoria, koszty per
// grupa, zysk vs estymacja, marże vs cel). Dane WYŁĄCZNIE z report.months
// (silnik lib/rw.ts) — tu tylko prezentacja: gr→zł (/100) do osi, tooltipy
// formatowane z dokładnych wartości w groszach (formatZl).

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartFrame } from "@/components/chart-frame";
import type { RwReport } from "@/lib/rw";
import { RW_MONTH_LABELS, rwCategoriesInBucket } from "@/lib/rw-types";
import { formatRwPct, formatZl, RW_MONTH_SHORT } from "./rw-format";

// ── stałe prezentacji ────────────────────────────────────────────────

const REVENUE_CATS = rwCategoriesInBucket("PRZYCHODY").map((c) => c.name);
const REVENUE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
] as const;

const COST_GROUPS = [
  { key: "delivery", bucket: "DELIVERY", label: "Produkcyjne (delivery)", color: "var(--chart-1)" },
  { key: "growth", bucket: "GROWTH", label: "Marketing i sprzedaż (growth)", color: "var(--chart-3)" },
  { key: "overhead", bucket: "OVERHEAD", label: "Overhead", color: "var(--chart-5)" },
] as const;

const axisNumber = new Intl.NumberFormat("pl-PL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Wartość osi w złotych → kompaktowy zapis PL, np. 12500 → "12,5 tys." */
function formatAxisZl(value: number): string {
  return axisNumber.format(value);
}

// ── drobne komponenty prezentacyjne ──────────────────────────────────

/** Karta-sekcja wykresu w stylu design systemu (jak na Dashboardzie). */
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

/** Wspólna ramka tooltipa — wiersze nazwa/wartość + opcjonalna suma. */
function TipBox({
  title,
  rows,
  footer,
}: {
  title: string;
  rows: { name: string; color?: string; text: string }[];
  footer?: { name: string; text: string };
}) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 font-medium">{title}</p>
      {rows.map((r) => (
        <p key={r.name} className="flex items-center justify-between gap-4">
          <span style={r.color ? { color: r.color } : undefined}>{r.name}</span>
          <span className="font-medium tabular-nums">{r.text}</span>
        </p>
      ))}
      {footer && (
        <p className="mt-1 flex items-center justify-between gap-4 border-t pt-1 font-medium">
          <span>{footer.name}</span>
          <span className="tabular-nums">{footer.text}</span>
        </p>
      )}
    </div>
  );
}

const AXIS_TICK = { fontSize: 11 } as const;
const CHART_MARGIN = { top: 4, right: 8, left: 0, bottom: 0 } as const;
const CURSOR_FILL = { fill: "var(--muted)", opacity: 0.4 } as const;

// ── główny komponent ─────────────────────────────────────────────────

export function RwCharts({ report }: { report: RwReport }) {
  // 1) Przychody per kategoria (stacked) — wartości zł do osi + gr do tooltipa
  const revenueData = report.months.map((m) => {
    const point: Record<string, string | number | Record<string, number>> = {
      name: RW_MONTH_SHORT[m.month - 1],
      full: RW_MONTH_LABELS[m.month - 1],
      gr: m.revenueByCategory,
    };
    for (const cat of REVENUE_CATS) {
      point[cat] = (m.revenueByCategory[cat] ?? 0) / 100;
    }
    return point;
  });

  // 2) Koszty per grupa (stacked) — negacja zamiast Math.abs: koszty ujemne
  // dają dodatnie słupki, a miesiąc z korektą netto dodatnią (zwroty > wydatki)
  // pokaże segment poniżej zera zamiast fałszywie zawyżać koszty
  const costData = report.months.map((m) => {
    const gr: Record<string, number> = {};
    const point: Record<string, string | number | Record<string, number>> = {
      name: RW_MONTH_SHORT[m.month - 1],
      full: RW_MONTH_LABELS[m.month - 1],
    };
    for (const g of COST_GROUPS) {
      const negGr = -m.bucketTotalsGr[g.bucket];
      gr[g.key] = negGr;
      point[g.key] = negGr / 100;
    }
    point.gr = gr;
    return point;
  });

  // 3) Zysk miesięcznie + estymacja (linia przerywana, tylko gdy podana)
  const profitData = report.months.map((m) => ({
    name: RW_MONTH_SHORT[m.month - 1],
    full: RW_MONTH_LABELS[m.month - 1],
    zysk: m.zyskGr / 100,
    estymacja: m.estymacjaGr !== null ? m.estymacjaGr / 100 : null,
    zyskGr: m.zyskGr,
    estymacjaGr: m.estymacjaGr,
  }));

  // 4) Marże (w %) vs cel 10%
  const marginData = report.months.map((m) => ({
    name: RW_MONTH_SHORT[m.month - 1],
    full: RW_MONTH_LABELS[m.month - 1],
    marza1: m.marza1 !== null ? m.marza1 * 100 : null,
    marza2: m.marza2 !== null ? m.marza2 * 100 : null,
    m1: m.marza1,
    m2: m.marza2,
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title="Przychody per kategoria"
        description="Miesięcznie, wg typu przychodu z arkusza RW"
      >
        <ChartFrame height={260}>
          <BarChart data={revenueData} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={formatAxisZl}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={CURSOR_FILL}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as {
                  full: string;
                  gr: Record<string, number>;
                };
                const rows = payload.map((p) => ({
                  name: String(p.name),
                  color: p.color,
                  text: formatZl(row.gr[String(p.dataKey)] ?? 0),
                }));
                const totalGr = payload.reduce(
                  (acc, p) => acc + (row.gr[String(p.dataKey)] ?? 0),
                  0
                );
                return (
                  <TipBox
                    title={row.full}
                    rows={rows}
                    footer={{ name: "Razem", text: formatZl(totalGr) }}
                  />
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {REVENUE_CATS.map((cat, i) => (
              <Bar
                key={cat}
                dataKey={cat}
                name={cat}
                stackId="przychody"
                fill={REVENUE_COLORS[i]}
                maxBarSize={22}
              />
            ))}
          </BarChart>
        </ChartFrame>
      </ChartCard>

      <ChartCard
        title="Koszty per grupa"
        description="Wartości bezwzględne kosztów delivery / growth / overhead"
      >
        <ChartFrame height={260}>
          <BarChart data={costData} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={formatAxisZl}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={CURSOR_FILL}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as {
                  full: string;
                  gr: Record<string, number>;
                };
                const rows = payload.map((p) => ({
                  name: String(p.name),
                  color: p.color,
                  text: formatZl(row.gr[String(p.dataKey)] ?? 0),
                }));
                const totalGr = payload.reduce(
                  (acc, p) => acc + (row.gr[String(p.dataKey)] ?? 0),
                  0
                );
                return (
                  <TipBox
                    title={row.full}
                    rows={rows}
                    footer={{ name: "Razem", text: formatZl(totalGr) }}
                  />
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {COST_GROUPS.map((g) => (
              <Bar
                key={g.key}
                dataKey={g.key}
                name={g.label}
                stackId="koszty"
                fill={g.color}
                maxBarSize={22}
              />
            ))}
          </BarChart>
        </ChartFrame>
      </ChartCard>

      <ChartCard
        title="Zysk miesięcznie"
        description="Zysk (bez odłożonych środków i CIT) oraz estymacja z metryk ręcznych"
      >
        <ChartFrame height={260}>
          <ComposedChart data={profitData} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={formatAxisZl}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Tooltip
              cursor={CURSOR_FILL}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as {
                  full: string;
                  zyskGr: number;
                  estymacjaGr: number | null;
                };
                const rows = [
                  {
                    name: "Zysk",
                    color: row.zyskGr >= 0 ? "var(--chart-2)" : "var(--chart-4)",
                    text: formatZl(row.zyskGr),
                  },
                ];
                if (row.estymacjaGr !== null) {
                  rows.push({
                    name: "Estymacja",
                    color: "var(--chart-1)",
                    text: formatZl(row.estymacjaGr),
                  });
                }
                return <TipBox title={row.full} rows={rows} />;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="zysk" name="Zysk" fill="var(--chart-2)" maxBarSize={22}>
              {profitData.map((p) => (
                <Cell
                  key={p.name}
                  fill={p.zyskGr >= 0 ? "var(--chart-2)" : "var(--chart-4)"}
                />
              ))}
            </Bar>
            <Line
              type="monotone"
              dataKey="estymacja"
              name="Estymacja zysku"
              stroke="var(--chart-1)"
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={{ r: 2.5 }}
              connectNulls={false}
            />
          </ComposedChart>
        </ChartFrame>
      </ChartCard>

      <ChartCard
        title="Marże vs cel"
        description="Marża I (po kosztach produkcyjnych) i Marża II (zysk / przychody), cel 10%"
      >
        <ChartFrame height={260}>
          <LineChart data={marginData} margin={CHART_MARGIN}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis
              tickFormatter={(v: number) => `${axisNumber.format(v)}%`}
              tick={AXIS_TICK}
              tickLine={false}
              axisLine={false}
              width={56}
            />
            <Tooltip
              cursor={{ stroke: "var(--border)" }}
              content={({ active, payload }) => {
                if (!active || !payload || payload.length === 0) return null;
                const row = payload[0].payload as {
                  full: string;
                  m1: number | null;
                  m2: number | null;
                };
                const rows: { name: string; color?: string; text: string }[] = [];
                if (row.m1 !== null) {
                  rows.push({
                    name: "Marża I",
                    color: "var(--chart-1)",
                    text: formatRwPct(row.m1),
                  });
                }
                if (row.m2 !== null) {
                  rows.push({
                    name: "Marża II",
                    color: "var(--chart-5)",
                    text: formatRwPct(row.m2),
                  });
                }
                if (rows.length === 0) return null;
                return <TipBox title={row.full} rows={rows} />;
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine
              y={10}
              stroke="var(--chart-3)"
              strokeDasharray="6 4"
              ifOverflow="extendDomain"
              label={{
                value: "cel 10%",
                position: "insideTopRight",
                fontSize: 11,
                fill: "var(--muted-foreground)",
              }}
            />
            <Line
              type="monotone"
              dataKey="marza1"
              name="Marża I"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              connectNulls={false}
            />
            <Line
              type="monotone"
              dataKey="marza2"
              name="Marża II"
              stroke="var(--chart-5)"
              strokeWidth={2}
              dot={{ r: 2.5 }}
              connectNulls={false}
            />
          </LineChart>
        </ChartFrame>
      </ChartCard>
    </div>
  );
}
