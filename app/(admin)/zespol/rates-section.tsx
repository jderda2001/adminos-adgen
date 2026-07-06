"use client";

// Historia stawek kosztowych pracownika (do panelu szczegółów): lista malejąco
// po dacie obowiązywania, dodawanie nowej stawki i usuwanie pozycji z
// potwierdzeniem. Zachowuje logikę z dawnego RatesDialog.

import { useMemo, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { dateToInput, formatDate, formatMoney, todayUTC } from "@/lib/format";
import { addRateAction, deleteRateAction } from "./actions";
import type { MemberRow, RateRow } from "./team-table";

export function RatesSection({ member }: { member: MemberRow }) {
  const [rateToDelete, setRateToDelete] = useState<RateRow | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Malejąco po dacie obowiązywania (ISO porównuje się leksykograficznie)
  const sortedRates = useMemo(
    () =>
      [...member.rates].sort((a, b) => b.validFrom.localeCompare(a.validFrom)),
    [member.rates]
  );

  // Stawka obowiązująca dziś = najnowsza z validFrom <= dziś
  const todayInput = dateToInput(todayUTC());
  const currentRateId =
    sortedRates.find((r) => r.validFrom.slice(0, 10) <= todayInput)?.id ?? null;

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await addRateAction(member.id, formData);
      if (result.ok) {
        toast.success(result.message);
        formRef.current?.reset();
      } else {
        toast.error(result.error);
      }
    });
  }

  function confirmDeleteRate() {
    if (!rateToDelete) return;
    startTransition(async () => {
      const result = await deleteRateAction(rateToDelete.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setRateToDelete(null);
    });
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Zmiana stawki działa od podanej daty. Starsze wpisy czasu pracy są
        wyceniane po stawce obowiązującej w dniu wpisu — historia nie przelicza
        się wstecz.
      </p>

      {sortedRates.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          Brak stawek — czas pracy tego pracownika jest wyceniany na 0 zł do
          momentu dodania pierwszej stawki.
        </p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-lg border">
          {sortedRates.map((rate) => (
            <li
              key={rate.id}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium tabular-nums">
                  {formatMoney(rate.ratePerHourGr)}/h
                </span>
                {rate.id === currentRateId && (
                  <StatusBadge tone="green">obowiązująca</StatusBadge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground tabular-nums">
                  od {formatDate(new Date(rate.validFrom))}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Usuń stawkę"
                  onClick={() => setRateToDelete(rate)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form
        ref={formRef}
        onSubmit={handleAdd}
        className="flex items-end gap-2 border-t pt-3"
      >
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`rate-amount-${member.id}`}>Nowa stawka (zł/h)</Label>
          <Input
            id={`rate-amount-${member.id}`}
            name="rate"
            inputMode="decimal"
            placeholder="120,00"
            required
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor={`rate-from-${member.id}`}>Obowiązuje od</Label>
          <Input
            id={`rate-from-${member.id}`}
            name="validFrom"
            type="date"
            defaultValue={todayInput}
            required
          />
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Dodawanie…" : "Dodaj"}
        </Button>
      </form>

      <AlertDialog
        open={rateToDelete !== null}
        onOpenChange={(isOpen) => !isOpen && setRateToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć stawkę?</AlertDialogTitle>
            <AlertDialogDescription>
              Stawka {rateToDelete ? formatMoney(rateToDelete.ratePerHourGr) : ""}
              /h obowiązująca od{" "}
              {rateToDelete ? formatDate(new Date(rateToDelete.validFrom)) : ""}{" "}
              zostanie usunięta. Wpisy czasu z tego okresu będą wyceniane po
              wcześniejszej stawce (lub 0 zł, jeśli jej nie ma).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteRate} disabled={pending}>
              {pending ? "Usuwanie…" : "Usuń"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
