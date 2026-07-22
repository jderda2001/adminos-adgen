"use client";

// Prognoza leadów (agencja leadowa) — sprzęga sprzedaż leadów z kosztem
// reklamowym na bazie run-rate + scenariuszy CPL/wolumen. Liczone po stronie
// klienta (czysty silnik lib/lead-forecast.ts), więc suwaki działają natychmiast.

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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/empty-state";
import { formatMoney } from "@/lib/format";
import { buildLeadForecast, type LeadForecastData } from "@/lib/lead-forecast";

function pctToMul(raw: string): number {
  const n = parseFloat(raw.replace(",", "."));
  return isFinite(n) ? 1 + n / 100 : 1;
}

export function LeadForecastCard({
  data,
  horizon,
}: {
  data: LeadForecastData;
  horizon: number;
}) {
  const [cplPct, setCplPct] = useState("0");
  const [volPct, setVolPct] = useState("0");

  const result = useMemo(
    () =>
      buildLeadForecast({
        ...data,
        scenario: { cplMultiplier: pctToMul(cplPct), volumeMultiplier: pctToMul(volPct) },
      }),
    [data, cplPct, volPct]
  );

  const hasData = data.deliveries.length > 0 || data.campaigns.length > 0;
  const t = result.totals;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3">
        <h2 className="font-heading text-base font-semibold">Prognoza leadów</h2>
        <p className="text-sm text-muted-foreground">
          Run-rate z ostatnich {data.historyMonths.length} mies. × scenariusz.
          Przychód = leady × cena; koszt reklamowy = leady × CPL.
        </p>
      </div>

      {!hasData ? (
        <EmptyState
          title="Brak historii leadów"
          description="Dodaj kampanie i dostawy w module Leady, aby prognozować przychód, koszt reklamowy i marżę na leadach."
        />
      ) : (
        <>
          {/* scenariusz */}
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-sm">
            <div className="space-y-1.5">
              <Label htmlFor="lf-cpl">Zmiana CPL (%)</Label>
              <Input
                id="lf-cpl"
                inputMode="decimal"
                value={cplPct}
                onChange={(e) => setCplPct(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lf-vol">Zmiana wolumenu (%)</Label>
              <Input
                id="lf-vol"
                inputMode="decimal"
                value={volPct}
                onChange={(e) => setVolPct(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Wertykal</TableHead>
                  <TableHead className="text-right">Leady/mies</TableHead>
                  <TableHead className="text-right">CPL</TableHead>
                  <TableHead className="text-right">Cena/lead</TableHead>
                  <TableHead className="text-right">Przychód/mies</TableHead>
                  <TableHead className="text-right">Koszt rekl./mies</TableHead>
                  <TableHead className="text-right">Marża/mies</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.perVertical.map((r) => (
                  <TableRow key={r.vertical}>
                    <TableCell className="font-medium">{r.vertical}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.leadsPerMonth}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.cplGr !== null ? formatMoney(r.cplGr) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.unitPriceGr !== null ? formatMoney(r.unitPriceGr) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.revenueGr !== null ? formatMoney(r.revenueGr) : "— (brak ceny)"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.adCostGr)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {r.marginGr !== null ? formatMoney(r.marginGr) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell className="font-medium">Razem / mies.</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{t.leadsPerMonth}</TableCell>
                  <TableCell colSpan={2} />
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.revenueGr)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.adCostGr)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.marginGr)}</TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 rounded-md bg-muted/50 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              W horyzoncie {horizon} mies. (run-rate):
            </span>
            <span className="tabular-nums">
              przychód <span className="font-medium">{formatMoney(t.revenueGr * horizon)}</span> ·
              koszt reklamowy <span className="font-medium">{formatMoney(t.adCostGr * horizon)}</span> ·
              marża{" "}
              <span className="font-semibold">{formatMoney(t.marginGr * horizon)}</span>
            </span>
          </div>

          {t.hasUnknownPrice && (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              Część wertykali nie ma ceny za lead (brak faktury z ceną jednostkową) —
              ich przychód i marża nie są liczone. Uzupełnij cenę w Przychodach
              (paczka leadów), aby prognoza była pełna.
            </p>
          )}
        </>
      )}
    </div>
  );
}
