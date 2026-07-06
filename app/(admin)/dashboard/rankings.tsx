// Rankingi klientów na Dashboardzie — server component,
// dane z getClientProfitability (rentowność spójna z modułem Rentowność).

import Link from "next/link";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { formatMoney, formatPercent } from "@/lib/format";

export interface RankingRow {
  clientId: string;
  name: string;
  revenueGr: number;
  profitGr: number;
  marginFraction: number | null;
}

/** Karta-sekcja rankingu: rounded-xl border bg-card + tytuł i podpis. */
function RankCard({
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
      <div className="mb-2">
        <h2 className="font-heading text-sm font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** Ton badge marży: <10% czerwony, <20% bursztynowy, wyżej brak badge. */
function marginTone(fraction: number | null): StatusTone | null {
  if (fraction === null) return null;
  if (fraction < 0.1) return "red";
  if (fraction < 0.2) return "amber";
  return null;
}

function RankingItem({
  position,
  row,
  variant,
}: {
  position: number;
  row: RankingRow;
  variant: "profit" | "margin";
}) {
  const tone = marginTone(row.marginFraction);

  return (
    <li>
      <Link
        href={`/rentownosc/${row.clientId}`}
        className="-mx-1.5 flex items-center justify-between gap-3 rounded-md px-1.5 py-2 transition-colors hover:bg-accent/40"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-4 shrink-0 text-xs tabular-nums text-muted-foreground">
            {position}.
          </span>
          <span className="truncate text-sm font-medium">{row.name}</span>
        </span>

        {variant === "margin" ? (
          <span className="flex shrink-0 items-center gap-2">
            <StatusBadge tone={tone ?? "neutral"}>
              {formatPercent(row.marginFraction)}
            </StatusBadge>
            <span className="text-right text-xs text-muted-foreground">
              zysk{" "}
              <span className="font-medium tabular-nums text-foreground">
                {formatMoney(row.profitGr)}
              </span>
            </span>
          </span>
        ) : (
          <span className="flex shrink-0 items-center gap-2 text-right">
            <span className="text-sm font-semibold tabular-nums">
              {formatMoney(row.profitGr)}
            </span>
            {tone ? (
              <StatusBadge tone={tone}>
                {formatPercent(row.marginFraction)}
              </StatusBadge>
            ) : (
              <span className="w-14 text-xs text-muted-foreground">
                marża {formatPercent(row.marginFraction)}
              </span>
            )}
          </span>
        )}
      </Link>
    </li>
  );
}

export function RankingCards({ rows }: { rows: RankingRow[] }) {
  const topByProfit = [...rows]
    .sort((a, b) => b.profitGr - a.profitGr)
    .slice(0, 5);
  const bottomByMargin = rows
    .filter((r) => r.revenueGr > 0)
    .sort((a, b) => (a.marginFraction ?? 0) - (b.marginFraction ?? 0))
    .slice(0, 3);

  return (
    <>
      <RankCard
        title="Top 5 klientów wg zysku"
        description="Zysk netto w wybranym okresie"
      >
        {topByProfit.length === 0 ? (
          <EmptyState
            title="Brak danych o rentowności"
            description="Dodaj faktury sprzedażowe i koszty w wybranym okresie, aby zobaczyć ranking klientów."
            className="py-8"
          />
        ) : (
          <ol className="divide-y divide-border">
            {topByProfit.map((row, i) => (
              <RankingItem
                key={row.clientId}
                position={i + 1}
                row={row}
                variant="profit"
              />
            ))}
          </ol>
        )}
      </RankCard>

      <RankCard
        title="Najniższa marża — dolna 3"
        description="Tylko klienci z przychodami w okresie"
      >
        {bottomByMargin.length === 0 ? (
          <EmptyState
            title="Brak klientów z przychodami"
            description="Wystaw faktury sprzedażowe w wybranym okresie, aby porównać marże klientów."
            className="py-8"
          />
        ) : (
          <ol className="divide-y divide-border">
            {bottomByMargin.map((row, i) => (
              <RankingItem
                key={row.clientId}
                position={i + 1}
                row={row}
                variant="margin"
              />
            ))}
          </ol>
        )}
      </RankCard>
    </>
  );
}
