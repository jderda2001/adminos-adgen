"use client";

// Budżet: plan vs wykonanie per miesiąc. Plan edytowalny (dialog per wiersz),
// wykonanie liczone z faktur/kosztów/dostaw. Wariancja jako StatusBadge:
// przychód/marża/leady — więcej = lepiej (zielone gdy ≥ plan); koszt —
// mniej = lepiej (zielone gdy ≤ plan).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { RW_MONTH_LABELS } from "@/lib/rw-types";
import { formatMoney, formatAmount } from "@/lib/format";
import { saveMonthlyBudgetAction } from "./actions";

export interface BudgetRow {
  period: string;
  month: number;
  revenuePlanGr: number;
  revenueActualGr: number;
  costPlanGr: number;
  costActualGr: number;
  leadsPlan: number | null;
  leadsActual: number;
  note: string | null;
}

function moneyDelta(plan: number, actual: number, higherBetter: boolean) {
  if (plan === 0 && actual === 0) return <span className="text-muted-foreground">—</span>;
  const delta = actual - plan;
  const good = higherBetter ? delta >= 0 : delta <= 0;
  const tone = plan === 0 ? "neutral" : good ? "green" : "red";
  const sign = delta > 0 ? "+" : "";
  return <StatusBadge tone={tone}>{sign}{formatMoney(delta)}</StatusBadge>;
}

function BudgetDialog({ row }: { row: BudgetRow }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [revenue, setRevenue] = useState("");
  const [cost, setCost] = useState("");
  const [leads, setLeads] = useState("");
  const [note, setNote] = useState("");

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setRevenue(row.revenuePlanGr ? formatAmount(row.revenuePlanGr) : "");
      setCost(row.costPlanGr ? formatAmount(row.costPlanGr) : "");
      setLeads(row.leadsPlan != null ? String(row.leadsPlan) : "");
      setNote(row.note ?? "");
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await saveMonthlyBudgetAction({ period: row.period, revenue, cost, leads, note });
      if (res.ok) {
        toast.success(res.message);
        setOpen(false);
      } else toast.error(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Edytuj plan ${RW_MONTH_LABELS[row.month - 1]}`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="capitalize">Plan — {RW_MONTH_LABELS[row.month - 1]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="b-rev">Przychód (netto, zł)</Label>
              <Input id="b-rev" inputMode="decimal" value={revenue} onChange={(e) => setRevenue(e.target.value)} placeholder="0,00" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-cost">Koszt (netto, zł)</Label>
              <Input id="b-cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="b-leads">Leady (szt.)</Label>
              <Input id="b-leads" inputMode="numeric" value={leads} onChange={(e) => setLeads(e.target.value)} placeholder="opcjonalnie" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-note">Notatka</Label>
              <Input id="b-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="opcjonalnie" />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Anuluj</Button>
          <Button onClick={submit} disabled={pending}>{pending ? "Zapisywanie…" : "Zapisz plan"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BudgetTable({ rows }: { rows: BudgetRow[] }) {
  const t = rows.reduce(
    (a, r) => ({
      revenuePlanGr: a.revenuePlanGr + r.revenuePlanGr,
      revenueActualGr: a.revenueActualGr + r.revenueActualGr,
      costPlanGr: a.costPlanGr + r.costPlanGr,
      costActualGr: a.costActualGr + r.costActualGr,
      leadsPlan: a.leadsPlan + (r.leadsPlan ?? 0),
      leadsActual: a.leadsActual + r.leadsActual,
    }),
    { revenuePlanGr: 0, revenueActualGr: 0, costPlanGr: 0, costActualGr: 0, leadsPlan: 0, leadsActual: 0 }
  );

  return (
    <div className="overflow-x-auto rounded-xl border bg-card shadow-[var(--shadow-card)]">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Miesiąc</TableHead>
            <TableHead className="text-right">Przychód plan</TableHead>
            <TableHead className="text-right">Wyk.</TableHead>
            <TableHead className="text-right">Δ</TableHead>
            <TableHead className="text-right">Koszt plan</TableHead>
            <TableHead className="text-right">Wyk.</TableHead>
            <TableHead className="text-right">Δ</TableHead>
            <TableHead className="text-right">Marża plan</TableHead>
            <TableHead className="text-right">Wyk.</TableHead>
            <TableHead className="text-right">Leady p/w</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const marginPlan = r.revenuePlanGr - r.costPlanGr;
            const marginActual = r.revenueActualGr - r.costActualGr;
            const empty = !r.revenuePlanGr && !r.revenueActualGr && !r.costPlanGr && !r.costActualGr && !r.leadsActual && !r.leadsPlan;
            return (
              <TableRow key={r.period} className={empty ? "text-muted-foreground/60" : undefined}>
                <TableCell className="capitalize">{RW_MONTH_LABELS[r.month - 1]}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.revenuePlanGr)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.revenueActualGr)}</TableCell>
                <TableCell className="text-right tabular-nums">{moneyDelta(r.revenuePlanGr, r.revenueActualGr, true)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.costPlanGr)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.costActualGr)}</TableCell>
                <TableCell className="text-right tabular-nums">{moneyDelta(r.costPlanGr, r.costActualGr, false)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(marginPlan)}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatMoney(marginActual)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.leadsPlan != null ? r.leadsPlan : "—"} / {r.leadsActual}
                </TableCell>
                <TableCell><BudgetDialog row={r} /></TableCell>
              </TableRow>
            );
          })}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell className="font-medium">Rok</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.revenuePlanGr)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.revenueActualGr)}</TableCell>
            <TableCell className="text-right tabular-nums">{moneyDelta(t.revenuePlanGr, t.revenueActualGr, true)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.costPlanGr)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.costActualGr)}</TableCell>
            <TableCell className="text-right tabular-nums">{moneyDelta(t.costPlanGr, t.costActualGr, false)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.revenuePlanGr - t.costPlanGr)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{formatMoney(t.revenueActualGr - t.costActualGr)}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">{t.leadsPlan} / {t.leadsActual}</TableCell>
            <TableCell />
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  );
}
