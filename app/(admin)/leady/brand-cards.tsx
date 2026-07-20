"use client";

// Karty marek wewnętrznych (wertykały w środku). Klik karty → sidebar ze
// szczegółami: leady/spend/CPL per wertykal + zakres CPL (min–max) z ostatniego
// okresu, przychód i marża. Budżet nie jest tu ustawiany ręcznie — plan liczy
// się automatycznie z estymacji dowiezienia (patrz karta „Do końca miesiąca").

import { useState } from "react";
import { formatMoney } from "@/lib/format";
import type { BrandEconRow } from "@/lib/brand-econ";
import { DetailSheet } from "@/components/detail-sheet";

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}
function marginClass(gr: number | null): string {
  if (gr === null) return "";
  return gr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

export function BrandCards({ rows }: { rows: BrandEconRow[] }) {
  const [open, setOpen] = useState<BrandEconRow | null>(null);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((r) => (
          <button
            key={r.brandId}
            type="button"
            onClick={() => setOpen(r)}
            className="rounded-xl border bg-card p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <div className="text-sm font-semibold">{r.brandName}</div>
            <div className="mb-2 truncate text-xs text-muted-foreground">
              {r.accountNames.length > 0
                ? `konta: ${r.accountNames.join(", ")}`
                : r.leadsCount > 0 || r.spendGr > 0
                  ? "kampanie z kont wspólnych"
                  : "brak przypisanego konta"}
            </div>

            <div className="text-2xl font-semibold tabular-nums">
              {r.leadsCount}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">leadów</span>
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {formatMoney(r.spendGr)}
              {r.verticals.length <= 1 && r.cplGr !== null && <> · CPL {formatMoney(r.cplGr)}</>}
            </div>

            {r.verticals.length > 1 && (
              <div className="mt-2 space-y-0.5 border-t pt-2">
                {r.verticals.slice(0, 4).map((v) => (
                  <div
                    key={v.vertical}
                    className="flex items-baseline justify-between gap-2 text-xs tabular-nums"
                  >
                    <span className="truncate text-muted-foreground">{v.vertical}</span>
                    <span className="shrink-0">
                      {v.leadsCount}
                      <span className="text-muted-foreground">
                        {" · "}
                        {v.cplGr !== null ? `CPL ${formatMoney(v.cplGr)}` : "—"}
                      </span>
                    </span>
                  </div>
                ))}
                {r.verticals.length > 4 && (
                  <div className="text-[11px] text-muted-foreground">
                    +{r.verticals.length - 4} więcej — kliknij
                  </div>
                )}
              </div>
            )}

            <div className="mt-2 text-xs tabular-nums">
              przychód {formatMoney(r.revenueGr)}
              {r.marginGr !== null && (
                <>
                  {" · "}
                  <span className={marginClass(r.marginGr)}>
                    marża {r.marginGr >= 0 ? "+" : ""}
                    {pct(r.marginPct)}
                  </span>
                </>
              )}
              {r.unpricedLeads > 0 && (
                <span className="text-muted-foreground"> · {r.unpricedLeads} bez ceny</span>
              )}
            </div>
          </button>
        ))}
      </div>

      <DetailSheet
        open={open !== null}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open?.brandName ?? "Marka"}
        description={
          open
            ? open.accountNames.length > 0
              ? `Konta: ${open.accountNames.join(", ")}`
              : "Kampanie z kont wspólnych (mieszanych)"
            : undefined
        }
      >
        {open && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">Leady · wydatki</div>
                <div className="text-lg font-semibold tabular-nums">{open.leadsCount}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {formatMoney(open.spendGr)}
                  {open.cplGr !== null && <> · CPL {formatMoney(open.cplGr)}</>}
                </div>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">Przychód · marża</div>
                <div className="text-lg font-semibold tabular-nums">{formatMoney(open.revenueGr)}</div>
                <div className={`text-xs tabular-nums ${marginClass(open.marginGr)}`}>
                  {open.marginGr !== null ? (
                    <>
                      marża {open.marginGr >= 0 ? "+" : ""}
                      {pct(open.marginPct)}
                    </>
                  ) : (
                    "—"
                  )}
                </div>
              </div>
            </div>

            {open.unpricedLeads > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {open.unpricedLeads} dostarczonych leadów bez ceny jednostkowej — przychód i
                marża są zaniżone. Uzupełnij cenę za leada na fakturze klienta.
              </div>
            )}

            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Wertykały
              </div>
              {open.verticals.length === 0 ? (
                <p className="text-sm text-muted-foreground">Brak kampanii w tym miesiącu.</p>
              ) : (
                <div className="space-y-2">
                  {open.verticals.map((v) => (
                    <div key={v.vertical} className="rounded-lg border px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{v.vertical}</span>
                        <span className="text-sm tabular-nums">
                          {v.leadsCount} <span className="text-muted-foreground">leadów</span>
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                        <span>{formatMoney(v.spendGr)}</span>
                        <span>
                          CPL {v.cplGr !== null ? formatMoney(v.cplGr) : "—"}
                          {v.minCplGr != null && v.maxCplGr != null && v.minCplGr !== v.maxCplGr && (
                            <span className="ml-1 text-[11px]">
                              (zakres {formatMoney(v.minCplGr)}–{formatMoney(v.maxCplGr)})
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                Zakres CPL = najniższy i najwyższy miesięczny CPL z ostatnich 6 miesięcy —
                pokazuje, jak bardzo waha się koszt leada na tej niszy.
              </p>
            </div>
          </div>
        )}
      </DetailSheet>
    </>
  );
}
