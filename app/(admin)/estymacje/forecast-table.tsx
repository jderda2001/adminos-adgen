"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney, formatMonth, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { PnlMonth, CashMonth } from "@/lib/forecast";

const NEG = "text-red-600 dark:text-red-400";
const POS = "text-emerald-600 dark:text-emerald-400";

function Money({ gr, color }: { gr: number; color?: boolean }) {
  return (
    <span className={cn("tabular-nums", color && (gr < 0 ? NEG : gr > 0 ? POS : undefined))}>
      {formatMoney(gr)}
    </span>
  );
}

export function ForecastTable({
  pnl,
  cash,
}: {
  pnl: PnlMonth[];
  cash: CashMonth[] | null;
}) {
  const [openPeriod, setOpenPeriod] = useState<string | null>(null);
  const cashByPeriod = new Map((cash ?? []).map((c) => [c.period, c]));
  const detail = openPeriod ? pnl.find((p) => p.period === openPeriod) : null;
  const detailCash = openPeriod ? cashByPeriod.get(openPeriod) ?? null : null;

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Miesiąc
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                Przychody
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                Koszty
              </TableHead>
              <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                Wynik
              </TableHead>
              {cash && (
                <>
                  <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                    Wpływy
                  </TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                    Wydatki
                  </TableHead>
                  <TableHead className="text-right text-[11px] uppercase tracking-wide text-muted-foreground">
                    Saldo koniec
                  </TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pnl.map((p) => {
              const c = cashByPeriod.get(p.period);
              return (
                <TableRow
                  key={p.period}
                  className="group cursor-pointer"
                  onClick={() => setOpenPeriod(p.period)}
                >
                  <TableCell className="font-medium capitalize">
                    {formatMonth(p.period)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money gr={p.revenueNetGr} />
                    {p.assumedNetGr > 0 && p.contractedNetGr > 0 && (
                      <div className="text-[10px] text-muted-foreground">
                        umowne {formatMoney(p.contractedNetGr)}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Money gr={-p.costsNetGr} color />
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Money gr={p.profitGr} color />
                  </TableCell>
                  {cash && c && (
                    <>
                      <TableCell className="text-right">
                        <Money gr={c.inflowsGr} />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money gr={-c.outflowsGr} color />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        <Money gr={c.closingGr} color />
                      </TableCell>
                    </>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <DetailSheet
        open={openPeriod !== null}
        onOpenChange={(o) => !o && setOpenPeriod(null)}
        title={detail ? <span className="capitalize">{formatMonth(detail.period)}</span> : ""}
        description="Składniki prognozy dla tego miesiąca"
      >
        {detail && (
          <div className="space-y-5">
            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Przychody (netto)
              </h4>
              {detail.revenueLines.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Brak</p>
              ) : (
                detail.revenueLines.map((l, i) => (
                  <DetailRow
                    key={i}
                    label={`${l.label}${l.contracted ? "" : " (zakł.)"}`}
                  >
                    {formatMoney(l.netGr)}
                  </DetailRow>
                ))
              )}
              <DetailRow label="Razem przychody" className="font-semibold">
                {formatMoney(detail.revenueNetGr)}
              </DetailRow>
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Koszty (netto)
              </h4>
              {detail.costLines.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Brak</p>
              ) : (
                detail.costLines.map((l, i) => (
                  <DetailRow key={i} label={l.label}>
                    {formatMoney(l.netGr)}
                  </DetailRow>
                ))
              )}
              <DetailRow label="Wynik" className="font-semibold">
                <span className={detail.profitGr < 0 ? NEG : POS}>
                  {formatMoney(detail.profitGr)}
                </span>
              </DetailRow>
            </section>

            {detailCash && (
              <section>
                <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Przepływy gotówkowe (brutto)
                </h4>
                <DetailRow label="Saldo początek">{formatMoney(detailCash.openingGr)}</DetailRow>
                {detailCash.events.map((e, i) => (
                  <DetailRow
                    key={i}
                    label={`${formatDate(new Date(e.dateIso))} · ${e.label}`}
                  >
                    <span className={e.amountGr < 0 ? NEG : POS}>{formatMoney(e.amountGr)}</span>
                  </DetailRow>
                ))}
                <DetailRow label="Saldo koniec" className="font-semibold">
                  <span className={detailCash.closingGr < 0 ? NEG : undefined}>
                    {formatMoney(detailCash.closingGr)}
                  </span>
                </DetailRow>
                <DetailRow label="Minimum w miesiącu">
                  <span className={detailCash.minBalanceGr < 0 ? NEG : undefined}>
                    {formatMoney(detailCash.minBalanceGr)} ({formatDate(new Date(detailCash.minBalanceDateIso))})
                  </span>
                </DetailRow>
              </section>
            )}

            {detail.invoicedToDateNetGr !== null && (
              <p className="text-xs text-muted-foreground">
                Bieżący miesiąc — zafakturowano już {formatMoney(detail.invoicedToDateNetGr)} netto.{" "}
                <StatusBadge tone="blue">m0</StatusBadge>
              </p>
            )}
          </div>
        )}
      </DetailSheet>
    </div>
  );
}
