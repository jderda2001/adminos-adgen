"use client";

// Karty marek wewnętrznych: leady, wydatki, CPL, przychód z dostaw, marża oraz
// budżet miesiąca (plan vs wydane, pasek postępu, edycja kwoty w dialogu).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney } from "@/lib/format";
import type { BrandEconRow } from "@/lib/brand-econ";
import { cn } from "@/lib/utils";
import { saveBrandBudgetAction } from "./actions";

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export function BrandCards({
  month,
  rows,
  daysLeft,
}: {
  month: string;
  rows: BrandEconRow[];
  daysLeft: number;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<BrandEconRow | null>(null);
  const [amount, setAmount] = useState("");
  const [pending, startTransition] = useTransition();

  function openEdit(row: BrandEconRow) {
    setEditing(row);
    setAmount(row.budgetGr !== null ? String(row.budgetGr / 100).replace(".", ",") : "");
  }

  function saveBudget(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    startTransition(async () => {
      const r = await saveBrandBudgetAction({ period: month, brandId: editing.brandId, budget: amount.trim() });
      if (r.ok) {
        toast.success(r.message);
        setEditing(null);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {rows.map((r) => {
          const overBudget = r.remainingGr !== null && r.remainingGr < 0;
          const barPct = r.usedPct === null ? 0 : Math.min(100, r.usedPct);
          return (
            <div
              key={r.brandId}
              className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]"
            >
              <div className="mb-0.5 flex items-start justify-between gap-2">
                <span className="text-sm font-semibold">{r.brandName}</span>
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Ustaw budżet marki ${r.brandName}`}
                >
                  <Pencil className="size-3.5" />
                </button>
              </div>
              <div className="mb-2 truncate text-xs text-muted-foreground">
                {r.accountNames.length > 0
                  ? `konta: ${r.accountNames.join(", ")}`
                  : r.leadsCount > 0 || r.spendGr > 0
                    ? "kampanie z kont wspólnych (mieszanych)"
                    : "brak przypisanego konta reklamowego"}
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
                  {r.verticals.map((v) => (
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
                </div>
              )}

              <div className="mt-2 text-xs tabular-nums">
                przychód {formatMoney(r.revenueGr)}
                {r.marginGr !== null && (
                  <>
                    {" · "}
                    <span className={r.marginGr >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                      marża {r.marginGr >= 0 ? "+" : ""}
                      {pct(r.marginPct)}
                    </span>
                  </>
                )}
                {r.unpricedLeads > 0 && (
                  <span className="text-muted-foreground"> · {r.unpricedLeads} bez ceny</span>
                )}
              </div>

              <div className="mt-3">
                {r.budgetGr !== null ? (
                  <>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all",
                          overBudget ? "bg-red-500" : barPct >= 90 ? "bg-amber-500" : "bg-primary"
                        )}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 text-[11px] text-muted-foreground tabular-nums">
                      budżet {formatMoney(r.spendGr)} / {formatMoney(r.budgetGr)}
                      {" · "}
                      {overBudget ? (
                        <span className="font-medium text-red-600 dark:text-red-400">
                          przepał {formatMoney(-r.remainingGr!)}
                        </span>
                      ) : (
                        <>zostało {formatMoney(r.remainingGr!)}</>
                      )}
                      {daysLeft > 0 && !overBudget && r.remainingGr! > 0 && (
                        <> · ≈{formatMoney(Math.round(r.remainingGr! / daysLeft))}/dz.</>
                      )}
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => openEdit(r)}
                    className="text-xs text-primary underline-offset-2 hover:underline"
                  >
                    ustaw budżet miesiąca →
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Budżet — {editing?.brandName}</DialogTitle>
            <DialogDescription>
              Planowane wydatki reklamowe tej marki w tym miesiącu (netto). Puste pole
              usuwa plan.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveBudget} className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="brandBudget">Kwota (zł)</Label>
              <Input
                id="brandBudget"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="np. 7000"
                inputMode="decimal"
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="submit" size="sm" disabled={pending}>
                {pending ? "Zapisywanie…" : "Zapisz"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
