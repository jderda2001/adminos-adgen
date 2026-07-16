"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatPercent, pluralPl } from "@/lib/format";
import type { PaymentStats } from "@/lib/forecast";

function delayTone(days: number): StatusTone {
  if (days <= 0) return "green";
  if (days <= 7) return "amber";
  return "red";
}
function delayLabel(days: number): string {
  if (days <= 0) return "w terminie";
  return `+${days} ${pluralPl(days, "dzień", "dni", "dni")}`;
}

export function PaymentStatsTable({
  stats,
  clientNames,
}: {
  stats: PaymentStats;
  clientNames: Record<string, string>;
}) {
  const rows = Object.values(stats.byClient)
    .filter((c) => c.sampleCount > 0)
    .sort((a, b) => b.medianDelayDays - a.medianDelayDays);

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground shadow-[var(--shadow-card)]">
        Brak historii opłaconych faktur — punktualność płatności pojawi się, gdy
        klienci zaczną regulować faktury.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
      <div className="border-b px-4 py-3">
        <h3 className="text-sm font-medium">Punktualność płatności klientów</h3>
        <p className="text-xs text-muted-foreground">
          Z historii opłaconych faktur — użyta do prognozy terminu wpływów
        </p>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">Klient</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">Faktur</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">Mediana opóźn.</TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">% w terminie</TableHead>
              <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">Zachowanie</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.clientId} className="hover:bg-transparent">
                <TableCell className="font-medium">
                  {clientNames[c.clientId] ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.sampleCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.medianDelayDays > 0 ? `+${c.medianDelayDays}` : c.medianDelayDays} dni
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(c.onTimeFraction)}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={delayTone(c.medianDelayDays)}>
                    {delayLabel(c.medianDelayDays)}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
