"use client";

// LIVE BOA — widoczna karta „na ile % przychodu idzie każda kategoria" vs plan.
// Odwzorowuje arkuszowy podział: Oszczędności / Wynagrodzenie właścicieli /
// Wydatki operacyjne / Podatki (CIT) + zaliczki (cele sumują się do 100%).

import { useState } from "react";
import type { RwReport } from "@/lib/rw";
import type { BoaTargets } from "@/lib/settings";
import { RW_MONTH_LABELS } from "@/lib/rw-types";
import { formatRwPct } from "./rw-format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type BoaKey = "oszczednosci" | "wlasciciele" | "operacyjne" | "podatkiIZaliczki";

const BOA_ROWS: { key: BoaKey; label: string }[] = [
  { key: "oszczednosci", label: "Oszczędności" },
  { key: "wlasciciele", label: "Wynagrodzenie właścicieli" },
  { key: "operacyjne", label: "Wydatki operacyjne" },
  { key: "podatkiIZaliczki", label: "Podatki (CIT) + zaliczki" },
];

export function RwBoaCard({
  report,
  targets,
}: {
  report: RwReport;
  targets: BoaTargets;
}) {
  const withData = report.monthsWithData;
  const [month, setMonth] = useState<number>(
    withData.length ? withData[withData.length - 1] : 1
  );
  const m = report.months[month - 1];

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-semibold">Live BOA</h2>
          <p className="text-sm text-muted-foreground">
            Podział przychodu na kategorie — realizacja vs plan
          </p>
        </div>
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="w-40" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {report.months.map((mm) => (
              <SelectItem
                key={mm.month}
                value={String(mm.month)}
                disabled={!mm.hasData}
              >
                {RW_MONTH_LABELS[mm.month - 1]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* nagłówek kolumn */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 border-b pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Kategoria</span>
        <span className="text-right">Live BOA</span>
        <span className="text-right">Plan</span>
      </div>

      <div className="divide-y divide-border/60">
        {BOA_ROWS.map(({ key, label }) => {
          const live = m.liveBoa[key];
          const target = targets[key];
          const liveFrac = live ?? 0;
          const barPct = Math.min(100, Math.max(0, liveFrac * 100));
          const markerPct = Math.min(100, Math.max(0, target * 100));
          return (
            <div key={key} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {/* pasek: wypełnienie = Live %, znacznik = cel */}
                <div className="relative mt-1.5 h-1.5 w-full max-w-56 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary/70"
                    style={{ width: `${barPct}%` }}
                  />
                  <div
                    className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded bg-foreground/50"
                    style={{ left: `calc(${markerPct}% - 1px)` }}
                    title={`Cel: ${formatRwPct(target)}`}
                  />
                </div>
              </div>
              <div
                className={cn(
                  "text-right text-sm font-semibold tabular-nums",
                  live === null && "text-muted-foreground"
                )}
              >
                {formatRwPct(live)}
              </div>
              <div className="text-right text-sm tabular-nums text-muted-foreground">
                {formatRwPct(target)}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
