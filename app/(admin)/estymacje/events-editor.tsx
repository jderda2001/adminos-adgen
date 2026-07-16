"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { formatMoney, formatMonth, formatAmount } from "@/lib/format";
import { PLAN_EVENT_LABELS } from "@/lib/forecast";
import {
  createPlanEventAction,
  updatePlanEventAction,
  deletePlanEventAction,
} from "./actions";

export interface PlanEventRow {
  id: string;
  period: string;
  kind: string;
  label: string;
  amountGr: number;
  note: string | null;
}

function EventDialog({
  event,
  trigger,
}: {
  event?: PlanEventRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [period, setPeriod] = useState(event?.period ?? "");
  const [kind, setKind] = useState(event?.kind ?? "OUTFLOW");
  const [label, setLabel] = useState(event?.label ?? "");
  const [amount, setAmount] = useState(event ? formatAmount(event.amountGr) : "");
  const [note, setNote] = useState(event?.note ?? "");

  function submit() {
    startTransition(async () => {
      const payload = { period, kind, label, amount, note };
      const res = event
        ? await updatePlanEventAction({ id: event.id, ...payload })
        : await createPlanEventAction(payload);
      if (res.ok) {
        toast.success(res.message ?? "Zapisano");
        setOpen(false);
      } else toast.error(res.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{event ? "Edytuj zdarzenie" : "Nowe zdarzenie"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ev-period">Miesiąc</Label>
              <Input
                id="ev-period"
                type="month"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ev-kind">Typ</Label>
              <Select value={kind} onValueChange={setKind}>
                <SelectTrigger id="ev-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INFLOW">Wpływ (+)</SelectItem>
                  <SelectItem value="OUTFLOW">Wydatek (−)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-label">Opis</Label>
            <Input
              id="ev-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="np. Zakup sprzętu / premia od klienta"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-amount">Kwota brutto (zł)</Label>
            <Input
              id="ev-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="np. 10 000,00"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-note">Uwagi (opcjonalnie)</Label>
            <Input id="ev-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EventsEditor({ events }: { events: PlanEventRow[] }) {
  const [pending, startTransition] = useTransition();

  function remove(id: string) {
    startTransition(async () => {
      const res = await deletePlanEventAction(id);
      if (res.ok) toast.success(res.message ?? "Usunięto");
      else toast.error(res.error);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Planowane zdarzenia</h3>
          <p className="text-xs text-muted-foreground">
            Jednorazowe wpływy/wydatki (poza rutyną) — wchodzą do prognozy gotówki
          </p>
        </div>
        <EventDialog
          trigger={
            <Button size="sm" variant="outline">
              <Plus data-icon="inline-start" /> Dodaj
            </Button>
          }
        />
      </div>

      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">Brak planowanych zdarzeń.</p>
      ) : (
        <div className="mt-3 space-y-1">
          {events.map((e) => (
            <div
              key={e.id}
              className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"
            >
              {e.kind === "INFLOW" ? (
                <ArrowUpRight className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <ArrowDownRight className="size-4 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <span className="min-w-0 flex-1 truncate">
                {e.label}
                <span className="ml-2 text-xs text-muted-foreground capitalize">
                  {formatMonth(e.period)}
                </span>
              </span>
              <span
                className={
                  "tabular-nums font-medium " +
                  (e.kind === "INFLOW"
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400")
                }
              >
                {e.kind === "INFLOW" ? "+" : "−"}
                {formatMoney(e.amountGr)}
              </span>
              <EventDialog
                event={e}
                trigger={
                  <button
                    type="button"
                    aria-label="Edytuj"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                }
              />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    aria-label="Usuń"
                    disabled={pending}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Usunąć zdarzenie?</AlertDialogTitle>
                    <AlertDialogDescription>
                      „{e.label}" ({formatMonth(e.period)}) zniknie z prognozy.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Anuluj</AlertDialogCancel>
                    <AlertDialogAction variant="destructive" onClick={() => remove(e.id)}>
                      Usuń
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
