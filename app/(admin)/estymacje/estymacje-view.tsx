"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { KpiCard } from "@/components/kpi-card";
import { cn } from "@/lib/utils";
import { formatMoney, formatDate } from "@/lib/format";
import { applyAiAdjustments, type ForecastResult, type ForecastAiReview } from "@/lib/forecast";
import { SnapshotCard, type SnapshotRow } from "./snapshot-card";
import { CashChart } from "./cash-chart";
import { ForecastTable } from "./forecast-table";
import { PaymentStatsTable } from "./payment-stats-table";
import { EventsEditor, type PlanEventRow } from "./events-editor";
import { AiPanel } from "./ai-panel";

const HORIZONS = [3, 6, 12] as const;

export function EstymacjeView({
  result,
  horizon,
  snapshots,
  events,
  clientNames,
  aiEnabled,
}: {
  result: ForecastResult;
  horizon: number;
  snapshots: SnapshotRow[];
  events: PlanEventRow[];
  newBusinessGr: number;
  clientNames: Record<string, string>;
  aiEnabled: boolean;
}) {
  const [review, setReview] = useState<ForecastAiReview | null>(null);
  const [applied, setApplied] = useState(false);
  // scenariusz AI: baseline ↔ z nałożonymi korektami (czysta transformacja)
  const active = useMemo(
    () => (applied && review ? applyAiAdjustments(result, review.adjustments) : result),
    [applied, review, result]
  );
  const { kpis, cash, pnl } = active;
  const hasCash = cash !== null;
  const wynik3m = pnl.slice(0, 3).reduce((a, m) => a + m.profitGr, 0);
  const snapshotStale = result.warnings.some((w) => w.code === "SNAPSHOT_NIEAKTUALNY");
  // ostrzeżenia poza BRAK_SNAPSHOTU (to obsługuje karta stanu kont)
  const shownWarnings = result.warnings.filter((w) => w.code !== "BRAK_SNAPSHOTU");

  const cashPoints = (cash ?? []).map((c) => ({
    period: c.period,
    closingGr: c.closingGr,
    minGr: c.minBalanceGr,
  }));

  return (
    <div className="space-y-5">
      {/* horyzont */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Horyzont:</span>
        <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1 shadow-[var(--shadow-card)]">
          {HORIZONS.map((h) => (
            <Link
              key={h}
              href={`/estymacje?horyzont=${h}`}
              scroll={false}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium transition-colors",
                h === horizon
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {h} mies.
            </Link>
          ))}
        </div>
      </div>

      {/* stan kont + zdarzenia */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SnapshotCard snapshots={snapshots} stale={snapshotStale} />
        <EventsEditor events={events} />
      </div>

      {/* KPI */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label={`Gotówka na koniec (${horizon} mies.)`}
          value={hasCash ? formatMoney(kpis.closingEndGr as number) : "—"}
          tone={hasCash && (kpis.closingEndGr as number) < 0 ? "negative" : "default"}
          sub={hasCash ? undefined : "Wpisz stan kont"}
        />
        <KpiCard
          label="Minimum salda"
          value={hasCash ? formatMoney(kpis.minBalanceGr as number) : "—"}
          tone={hasCash && (kpis.minBalanceGr as number) < 0 ? "negative" : "default"}
          sub={
            hasCash && kpis.minBalanceDateIso
              ? formatDate(new Date(kpis.minBalanceDateIso))
              : undefined
          }
        />
        <KpiCard
          label="Wynik (3 mies.)"
          value={formatMoney(wynik3m)}
          tone={wynik3m < 0 ? "negative" : "positive"}
          sub="przychody − koszty (netto)"
        />
        <KpiCard
          label="Zaległe należności"
          value={formatMoney(kpis.overdueBacklogGr)}
          tone={kpis.overdueBacklogGr > 0 ? "warning" : "default"}
          sub={
            kpis.doubtfulGr > 0
              ? `wątpliwe (>90 dni): ${formatMoney(kpis.doubtfulGr)}`
              : "faktury po terminie (≤90 dni)"
          }
        />
      </div>

      {kpis.firstNegativePeriod && (
        <div className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          <AlertTriangle className="size-4 shrink-0" />
          Uwaga: saldo schodzi poniżej zera już w miesiącu{" "}
          <span className="font-semibold capitalize">{kpis.firstNegativePeriod}</span>.
        </div>
      )}

      {/* analiza AI (doradcza) */}
      {aiEnabled && (
        <AiPanel
          horizon={horizon}
          review={review}
          applied={applied}
          onReview={(r) => {
            setReview(r);
            setApplied(true);
          }}
          onAppliedChange={setApplied}
        />
      )}

      {/* wykres */}
      <CashChart points={cashPoints} />

      {/* tabela prognozy */}
      <ForecastTable pnl={pnl} cash={cash} />

      {/* punktualność płatności */}
      <PaymentStatsTable stats={result.paymentStats} clientNames={clientNames} />

      {/* pozostałe ostrzeżenia */}
      {shownWarnings.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          <div className="mb-1 font-medium">Założenia / uwagi prognozy:</div>
          <ul className="list-inside list-disc space-y-0.5">
            {shownWarnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
