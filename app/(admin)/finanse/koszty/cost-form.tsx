"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
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
import { computeVatFromNet } from "@/lib/calc";
import {
  dateToInput,
  formatAmount,
  formatMoney,
  parseMoneyToGr,
  todayUTC,
} from "@/lib/format";
import { VAT_RATES, VAT_RATE_LABELS, isVatRate, type VatRate } from "@/lib/types";
import { createCostAction, updateCostAction } from "./actions";
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
  const [net, setNet] = useState("");
  const [vatRate, setVatRate] = useState<VatRate>("23");
  const [paid, setPaid] = useState(false);
  const [isRecurring, setIsRecurring] = useState(false);

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      setNet(cost ? formatAmount(cost.netGr) : "");
      setVatRate(cost && isVatRate(cost.vatRate) ? cost.vatRate : "23");
      setPaid(cost?.paid ?? false);
      setIsRecurring(false);
    }
    setOpen(nextOpen);
  }

  const netGr = parseMoneyToGr(net);
  const amounts = netGr !== null ? computeVatFromNet(netGr, vatRate) : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = cost
        ? await updateCostAction(cost.id, formData)
        : await createCostAction(formData);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
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

          <div className="grid grid-cols-2 gap-3">
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="net">Kwota netto (zł) *</Label>
              <Input
                id="net"
                name="net"
                inputMode="decimal"
                required
                placeholder="1 234,56"
                value={net}
                onChange={(e) => setNet(e.target.value)}
              />
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
          <p className="text-sm text-muted-foreground">
            {amounts
              ? `VAT: ${formatMoney(amounts.vatGr)} · Brutto: ${formatMoney(amounts.grossGr)}`
              : "Podaj kwotę netto, aby zobaczyć VAT i brutto"}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="categoryId">Kategoria *</Label>
              <Select name="categoryId" defaultValue={cost?.categoryId ?? categories[0]?.id}>
                <SelectTrigger id="categoryId" className="w-full">
                  <SelectValue placeholder="Wybierz kategorię" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assignment">Przypisanie *</Label>
              <Select
                name="assignment"
                defaultValue={cost?.clientId ?? GENERAL_VALUE}
              >
                <SelectTrigger id="assignment" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GENERAL_VALUE}>Koszt ogólny</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 items-end gap-3">
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

          <div className="space-y-2">
            <Label htmlFor="note">Notatka</Label>
            <Textarea
              id="note"
              name="note"
              rows={2}
              defaultValue={cost?.note ?? ""}
            />
          </div>

          {/* Nr rachunku dostawcy, Nr dokumentu i Załącznik tymczasowo ukryte
              (niepotrzebne teraz przy dodawaniu kosztu — backend nadal je obsługuje) */}

          {!cost && (
            <div className="space-y-3 rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="recurringCheckbox"
                  checked={isRecurring}
                  onCheckedChange={(checked) => setIsRecurring(checked === true)}
                />
                <Label htmlFor="recurringCheckbox">Powtarzaj co miesiąc</Label>
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
                    Co miesiąc powstanie kopia kosztu do potwierdzenia. Jeśli numer
                    dokumentu zawiera miesiąc (np. 07/2026), zostanie automatycznie
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
