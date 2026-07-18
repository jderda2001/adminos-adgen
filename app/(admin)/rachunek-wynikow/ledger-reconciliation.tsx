"use client";

// Uzgodnienie dwóch rejestrów za rok: Rachunek wyników (kasowo, z wyciągów)
// vs Przychody/Koszty (moduł operacyjny). Delta lokalizuje miesiąc rozjazdu.
// Przełącznik memoriałowo (data sprzedaży) / kasowo (data zapłaty) — bo RW jest
// kasowy, więc porównanie kasowe zwykle domyka różnicę czasową.

import { useMemo, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/status-badge";
import { RW_MONTH_LABELS } from "@/lib/rw-types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface LedgerReconRow {
  month: number;
  invoiceAccrualGr: number;
  invoiceCashGr: number;
  rwRevenueGr: number;
  costGr: number;
  rwCostGr: number;
}

// próg uznania delty za „istotną" (poniżej — traktujemy jak zgodne): 50 zł
const EPS = 5000;

function deltaBadge(delta: number) {
  const tone = Math.abs(delta) <= EPS ? "green" : Math.abs(delta) <= 50000 ? "amber" : "red";
  return <StatusBadge tone={tone}>{formatMoney(delta)}</StatusBadge>;
}

export function LedgerReconciliation({
  year,
  rows,
}: {
  year: number;
  rows: LedgerReconRow[];
}) {
  const [cash, setCash] = useState(false); // false = memoriałowo (saleDate), true = kasowo (paidDate)

  const view = useMemo(
    () =>
      rows.map((r) => {
        const invoiceGr = cash ? r.invoiceCashGr : r.invoiceAccrualGr;
        return {
          ...r,
          invoiceGr,
          revDelta: invoiceGr - r.rwRevenueGr,
          costDelta: r.costGr - r.rwCostGr,
          hasData:
            invoiceGr !== 0 || r.rwRevenueGr !== 0 || r.costGr !== 0 || r.rwCostGr !== 0,
        };
      }),
    [rows, cash]
  );

  const totals = useMemo(
    () =>
      view.reduce(
        (a, r) => ({
          invoiceGr: a.invoiceGr + r.invoiceGr,
          rwRevenueGr: a.rwRevenueGr + r.rwRevenueGr,
          revDelta: a.revDelta + r.revDelta,
          costGr: a.costGr + r.costGr,
          rwCostGr: a.rwCostGr + r.rwCostGr,
          costDelta: a.costDelta + r.costDelta,
        }),
        { invoiceGr: 0, rwRevenueGr: 0, revDelta: 0, costGr: 0, rwCostGr: 0, costDelta: 0 }
      ),
    [view]
  );

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-heading text-base font-semibold">
            Uzgodnienie z Przychodami/Kosztami ({year})
          </h2>
          <p className="text-sm text-muted-foreground">
            Rachunek wyników (kasowo, z wyciągów) vs moduły Przychody/Koszty.
            Delta wskazuje miesiąc i stronę rozjazdu.
          </p>
        </div>
        <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1">
          <button
            type="button"
            onClick={() => setCash(false)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              !cash ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Memoriałowo
          </button>
          <button
            type="button"
            onClick={() => setCash(true)}
            className={cn(
              "rounded-md px-3 py-1 text-sm font-medium transition-colors",
              cash ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            )}
          >
            Kasowo
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Miesiąc</TableHead>
              <TableHead className="text-right">
                {cash ? "Faktury opłacone" : "Faktury (sprzedaż)"}
              </TableHead>
              <TableHead className="text-right">RW przychód</TableHead>
              <TableHead className="text-right">Δ przychód</TableHead>
              <TableHead className="text-right">Koszty (moduł)</TableHead>
              <TableHead className="text-right">RW koszt oper.</TableHead>
              <TableHead className="text-right">Δ koszt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {view.map((r) => (
              <TableRow key={r.month} className={cn(!r.hasData && "text-muted-foreground/50")}>
                <TableCell className="capitalize">{RW_MONTH_LABELS[r.month - 1]}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.invoiceGr)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.rwRevenueGr)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.hasData ? deltaBadge(r.revDelta) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.costGr)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.rwCostGr)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.hasData ? deltaBadge(r.costDelta) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Rok</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.invoiceGr)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.rwRevenueGr)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{deltaBadge(totals.revDelta)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.costGr)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{formatMoney(totals.rwCostGr)}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">{deltaBadge(totals.costDelta)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        RW pochodzi z importów wyciągów (kasowo, netto liczone ze stawki VAT).
        Przychody/Koszty to wpisy operacyjne (memoriałowo). Różnice są naturalne:
        przesunięcia w czasie (sprzedaż vs zapłata), braki importu/wpisów, koszty
        odłożone i podatki są po stronie RW wyłączone z „kosztu operacyjnego".
        Zielona delta ≤ 50 zł = zgodne.
      </p>
    </section>
  );
}
