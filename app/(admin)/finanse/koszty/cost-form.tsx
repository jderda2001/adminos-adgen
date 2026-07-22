"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { categoryPillClass } from "./category-color";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { computeVatFromNet, computeVatFromGross } from "@/lib/calc";
import { cn } from "@/lib/utils";
import { SearchableSelect } from "@/components/searchable-select";
import {
  dateToInput,
  formatAmount,
  formatMoney,
  parseMoneyToGr,
  todayUTC,
} from "@/lib/format";
import { VAT_RATES, VAT_RATE_LABELS, isVatRate, type VatRate } from "@/lib/types";
import {
  createCostAction,
  updateCostAction,
  updateRecurringCopyAmountAction,
} from "./actions";
import type { CostRow } from "./costs-table";

export interface SelectOption {
  id: string;
  name: string;
}

/** Wartość specjalna selecta przypisania = koszt ogólny (clientId null) */
const GENERAL_VALUE = "OGOLNY";

export function CostFormDialog({
  cost,
  categories,
  clients,
  supplierNames,
  trigger,
}: {
  cost?: CostRow;
  categories: SelectOption[];
  clients: SelectOption[];
  supplierNames: string[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // pola sterowane — potrzebne do podglądu VAT/brutto i pól warunkowych
  const [amount, setAmount] = useState(""); // kwota wpisana (netto lub brutto)
  const [amountMode, setAmountMode] = useState<"NET" | "GROSS">("NET");
  const [vatRate, setVatRate] = useState<VatRate>("23");
  const [paid, setPaid] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);
  const [assignment, setAssignment] = useState(GENERAL_VALUE);
  const [applyToFuture, setApplyToFuture] = useState(false); // zmiana kwoty w kolejnych miesiącach

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setAmount(cost ? formatAmount(cost.netGr) : "");
      setAmountMode("NET"); // edycja pokazuje kwotę netto
      setVatRate(cost && isVatRate(cost.vatRate) ? cost.vatRate : "23");
      setPaid(cost?.paid ?? false);
      setIsRecurring(false);
      setAssignment(cost?.clientId ?? GENERAL_VALUE);
      setApplyToFuture(false);
    }
    setOpen(nextOpen);
  }

  const amountGr = parseMoneyToGr(amount);
  const amounts =
    amountGr === null
      ? null
      : amountMode === "GROSS"
        ? computeVatFromGross(amountGr, vatRate)
        : computeVatFromNet(amountGr, vatRate);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = cost
        ? await updateCostAction(cost.id, formData)
        : await createCostAction(formData);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // koszt cykliczny + „zastosuj w kolejnych miesiącach": po zapisie propaguj
      // kwotę na szablon i przyszłe kopie (updateRecurringCopyAmountAction "future")
      if (cost?.recurringCostId && applyToFuture && amounts) {
        const prop = await updateRecurringCopyAmountAction(cost.id, amounts.netGr, "future");
        if (!prop.ok) {
          toast.error(prop.error);
          setOpen(false);
          return;
        }
        toast.success(prop.message);
      } else {
        toast.success(result.message);
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{cost ? "Edytuj koszt" : "Nowy koszt"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="supplierName">Dostawca *</Label>
            <Input
              id="supplierName"
              name="supplierName"
              list="cost-supplier-names"
              defaultValue={cost?.supplierName}
              required
              placeholder="np. Google Ireland Ltd."
            />
            <datalist id="cost-supplier-names">
              {supplierNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="docDate">Data wystawienia *</Label>
              <DatePicker
                id="docDate"
                name="docDate"
                defaultValue={
                  cost ? dateToInput(new Date(cost.docDate)) : dateToInput(todayUTC())
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Termin płatności</Label>
              <DatePicker
                id="dueDate"
                name="dueDate"
                clearable
                defaultValue={
                  cost?.dueDate ? dateToInput(new Date(cost.dueDate)) : ""
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="amount">
                  Kwota {amountMode === "GROSS" ? "brutto" : "netto"} (zł) *
                </Label>
                {/* przełącznik: wpisujemy netto czy brutto (np. z wyciągu) */}
                <div className="inline-flex overflow-hidden rounded-md border text-xs">
                  {(["NET", "GROSS"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setAmountMode(m)}
                      className={cn(
                        "px-2 py-0.5 transition-colors",
                        amountMode === m
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {m === "NET" ? "Netto" : "Brutto"}
                    </button>
                  ))}
                </div>
              </div>
              <Input
                id="amount"
                name="amount"
                inputMode="decimal"
                required
                placeholder="1 234,56"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <input type="hidden" name="amountMode" value={amountMode} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vatRate">Stawka VAT *</Label>
              <Select
                name="vatRate"
                value={vatRate}
                onValueChange={(v) => isVatRate(v) && setVatRate(v)}
              >
                <SelectTrigger id="vatRate" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VAT_RATES.map((rate) => (
                    <SelectItem key={rate} value={rate}>
                      {VAT_RATE_LABELS[rate]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-sm text-muted-foreground tabular-nums">
            {amounts
              ? `Netto: ${formatMoney(amounts.netGr)} · VAT: ${formatMoney(amounts.vatGr)} · Brutto: ${formatMoney(amounts.grossGr)}`
              : "Podaj kwotę, aby zobaczyć rozbicie netto / VAT / brutto"}
          </p>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="categoryId">Kategoria *</Label>
              <Select name="categoryId" defaultValue={cost?.categoryId ?? categories[0]?.id}>
                <SelectTrigger id="categoryId" className="w-full">
                  <SelectValue placeholder="Wybierz kategorię" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className={categoryPillClass(c.name)}>{c.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment">Przypisanie *</Label>
              <SearchableSelect
                id="assignment"
                name="assignment"
                value={assignment}
                onChange={setAssignment}
                options={[
                  { value: GENERAL_VALUE, label: "Koszt ogólny" },
                  ...clients.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
            <div className="flex h-9 items-center gap-2">
              <Checkbox
                id="paidCheckbox"
                checked={paid}
                onCheckedChange={(checked) => setPaid(checked === true)}
              />
              <Label htmlFor="paidCheckbox">Zapłacony</Label>
              <input type="hidden" name="paid" value={paid ? "1" : ""} />
            </div>
            {paid && (
              <div className="space-y-2">
                <Label htmlFor="paidDate">Data zapłaty</Label>
                <DatePicker
                  id="paidDate"
                  name="paidDate"
                  clearable
                  defaultValue={
                    cost?.paidDate
                      ? dateToInput(new Date(cost.paidDate))
                      : dateToInput(todayUTC())
                  }
                />
              </div>
            )}
          </div>

          {/* Komentarz tylko przy tworzeniu = pierwszy wpis w historii (autor =
              bieżący użytkownik). Przy edycji komentarze dodaje się w wątku
              (ikona komentarza w wierszu / panelu szczegółów). */}
          {!cost && (
            <div className="space-y-2">
              <Label htmlFor="note">Komentarz</Label>
              <Textarea
                id="note"
                name="note"
                rows={2}
                placeholder="Opis kosztu, ustalenia, kontekst… (opcjonalnie)"
              />
            </div>
          )}

          {/* Nr rachunku dostawcy, Nr dokumentu i Załącznik tymczasowo ukryte
              (niepotrzebne teraz przy dodawaniu kosztu — backend nadal je obsługuje) */}

          {/* Cykliczność: przy nowym koszcie oraz przy edycji kosztu, który nie
              jest jeszcze cykliczny (żeby dało się go „ucyklicznić" po fakcie).
              Koszt już z szablonu — tylko informacja. */}
          {cost?.recurringCostId ? (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                Ten koszt jest cykliczny (z szablonu). Termin i koniec generowania zmienisz
                w „Koszty cykliczne".
              </p>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  id="applyToFuture"
                  checked={applyToFuture}
                  onCheckedChange={(c) => setApplyToFuture(c === true)}
                  className="mt-0.5"
                />
                <span>
                  Zmień kwotę także we wszystkich kolejnych miesiącach
                  <span className="block text-xs text-muted-foreground">
                    Zaktualizuje szablon i przyszłe (nieopłacone) kopie. Bez zaznaczenia —
                    zmiana tylko w tym miesiącu.
                  </span>
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="recurringCheckbox"
                  checked={isRecurring}
                  onCheckedChange={(checked) => setIsRecurring(checked === true)}
                />
                <Label htmlFor="recurringCheckbox">
                  {cost ? "Ustaw jako koszt cykliczny (co miesiąc)" : "Powtarzaj co miesiąc"}
                </Label>
                <input
                  type="hidden"
                  name="isRecurring"
                  value={isRecurring ? "1" : ""}
                />
              </div>
              {isRecurring && (
                <div className="space-y-2">
                  <Label htmlFor="dueDayOfMonth">
                    Dzień miesiąca jako termin płatności (1–28)
                  </Label>
                  <Input
                    id="dueDayOfMonth"
                    name="dueDayOfMonth"
                    type="number"
                    min={1}
                    max={28}
                    defaultValue={10}
                    className="w-24"
                  />
                  <p className="text-xs text-muted-foreground">
                    Powstanie szablon i co miesiąc kopia kosztu do potwierdzenia. Jeśli
                    numer dokumentu zawiera miesiąc (np. 07/2026), zostanie automatycznie
                    podmieniany.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Zapisywanie…" : "Zapisz"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
