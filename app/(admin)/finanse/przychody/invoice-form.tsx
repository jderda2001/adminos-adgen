"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
  DEFAULT_OFFER_TAGS,
  LEAD_CATEGORIES,
  LEAD_TAG_PREFIX,
  LEADS_OFFER_TAG,
  VAT_RATES,
  VAT_RATE_FRACTIONS,
  VAT_RATE_LABELS,
  isVatRate,
  type VatRate,
} from "@/lib/types";
import {
  dateToInput,
  formatAmount,
  formatMoney,
  parseMoneyToGr,
  todayUTC,
} from "@/lib/format";
import {
  createInvoiceAction,
  updateInvoiceAction,
  type InvoiceFormInput,
} from "./actions";
import type { ClientOption, InvoiceRow } from "./invoices-table";

function parseTags(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function InvoiceFormDialog({
  invoice,
  clients,
  trigger,
}: {
  invoice?: InvoiceRow;
  clients: ClientOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const [net, setNet] = useState("");
  const [vatRate, setVatRate] = useState<VatRate>("23");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const today = todayUTC();
  const defaultSaleDate = invoice
    ? dateToInput(new Date(invoice.saleDate))
    : dateToInput(today);
  const defaultDueDate = invoice
    ? dateToInput(new Date(invoice.dueDate))
    : dateToInput(new Date(today.getTime() + 14 * 86_400_000));

  function resetFromInvoice() {
    setNet(invoice ? formatAmount(invoice.netGr) : "");
    setVatRate(invoice && isVatRate(invoice.vatRate) ? invoice.vatRate : "23");
    setTags(parseTags(invoice?.offerTags));
    setTagInput("");
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) resetFromInvoice();
  }

  function addTag(raw: string) {
    const value = raw.trim();
    if (!value) return;
    setTags((prev) =>
      prev.some((t) => t.toLowerCase() === value.toLowerCase())
        ? prev
        : [...prev, value]
    );
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags((prev) => {
      const next = prev.filter((t) => t !== tag);
      // zdjęcie „PAKIETY LEADÓW" usuwa też przypiętą branżę leadów
      if (tag.toLowerCase() === LEADS_OFFER_TAG.toLowerCase()) {
        return next.filter((t) => !t.startsWith(LEAD_TAG_PREFIX));
      }
      return next;
    });
  }

  // „Pakiety leadów": czy tag wybrany + jaka branża (z tagu „Leady: …")
  const hasLeads = tags.some(
    (t) => t.toLowerCase() === LEADS_OFFER_TAG.toLowerCase()
  );
  const leadCategory =
    tags.find((t) => t.startsWith(LEAD_TAG_PREFIX))?.slice(LEAD_TAG_PREFIX.length) ??
    "";
  function setLeadCategory(category: string) {
    setTags((prev) => [
      ...prev.filter((t) => !t.startsWith(LEAD_TAG_PREFIX)),
      ...(category ? [`${LEAD_TAG_PREFIX}${category}`] : []),
    ]);
  }

  // Podgląd VAT/brutto na żywo (serwer liczy ostatecznie przez computeVatFromNet)
  const netGr = parseMoneyToGr(net);
  const preview =
    netGr !== null && netGr >= 0
      ? (() => {
          const vatGr = Math.round(netGr * VAT_RATE_FRACTIONS[vatRate]);
          return { netGr, vatGr, grossGr: netGr + vatGr };
        })()
      : null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const input: InvoiceFormInput = {
      number: String(formData.get("number") ?? ""),
      clientId: String(formData.get("clientId") ?? ""),
      label: String(formData.get("label") ?? ""),
      net,
      vatRate,
      saleDate: String(formData.get("saleDate") ?? ""),
      dueDate: String(formData.get("dueDate") ?? ""),
      offerTags: tags.join(","),
      notes: String(formData.get("notes") ?? ""),
      status: invoice ? undefined : String(formData.get("status") ?? "ISSUED"),
    };
    startTransition(async () => {
      const result = invoice
        ? await updateInvoiceAction(invoice.id, input)
        : await createInvoiceAction(input);
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {invoice ? "Edytuj przychód" : "Nowy przychód"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="clientId">Klient *</Label>
              <Select name="clientId" defaultValue={invoice?.clientId}>
                <SelectTrigger id="clientId" className="w-full">
                  <SelectValue placeholder="Wybierz klienta" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="label">Opis pozycji</Label>
              <Input
                id="label"
                name="label"
                defaultValue={invoice?.label ?? ""}
                placeholder="np. Klient | SKD"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="net">Kwota netto (zł) *</Label>
              <Input
                id="net"
                inputMode="decimal"
                value={net}
                onChange={(e) => setNet(e.target.value)}
                placeholder="12 000,00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vatRate">Stawka VAT *</Label>
              <Select
                value={vatRate}
                onValueChange={(v) => setVatRate(v as VatRate)}
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

          <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 rounded-md bg-muted/50 px-3 py-2 text-sm tabular-nums">
            <span>
              Netto:{" "}
              <span className="font-medium">
                {preview ? formatMoney(preview.netGr) : "—"}
              </span>
            </span>
            <span>
              VAT:{" "}
              <span className="font-medium">
                {preview ? formatMoney(preview.vatGr) : "—"}
              </span>
            </span>
            <span>
              Brutto:{" "}
              <span className="font-semibold">
                {preview ? formatMoney(preview.grossGr) : "—"}
              </span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="saleDate">Data przychodu *</Label>
              <DatePicker
                id="saleDate"
                name="saleDate"
                defaultValue={defaultSaleDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dueDate">Termin płatności *</Label>
              <DatePicker
                id="dueDate"
                name="dueDate"
                defaultValue={defaultDueDate}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="number">Nr faktury (opcjonalnie)</Label>
              <Input
                id="number"
                name="number"
                defaultValue={invoice?.number ?? ""}
                placeholder="np. FV/2026/07/01 lub puste = bez FV"
              />
            </div>
            {!invoice && (
              <div className="space-y-2">
                <Label htmlFor="status">Status *</Label>
                <Select name="status" defaultValue="ISSUED">
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NOT_ISSUED">Nie wystawiona</SelectItem>
                    <SelectItem value="WAITING">Czekamy</SelectItem>
                    <SelectItem value="ISSUED">Wysłana</SelectItem>
                    <SelectItem value="NO_INVOICE">Bez faktury</SelectItem>
                    <SelectItem value="PAID">Opłacona</SelectItem>
                    <SelectItem value="DRAFT">Szkic (Bez FV)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* ── Oferta / tagi ─────────────────────────────────────── */}
          <div className="space-y-2">
            <Label htmlFor="offerTagInput">Oferta / tagi</Label>
            {tags.some((t) => !t.startsWith(LEAD_TAG_PREFIX)) && (
              <div className="flex flex-wrap gap-1.5">
                {/* tag „Leady: …" jest niewidoczny — zarządza nim dropdown poniżej */}
                {tags
                  .filter((t) => !t.startsWith(LEAD_TAG_PREFIX))
                  .map((tag) => (
                    <Badge
                      key={tag}
                      variant="secondary"
                      className="gap-1 font-normal"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Usuń tag ${tag}`}
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
              </div>
            )}
            <Input
              id="offerTagInput"
              list="revenue-offer-tag-suggestions"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              onBlur={() => addTag(tagInput)}
              placeholder="Wpisz tag i naciśnij Enter, np. META ADS ABO"
            />
            <datalist id="revenue-offer-tag-suggestions">
              {DEFAULT_OFFER_TAGS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_OFFER_TAGS.filter(
                (t) => !tags.some((sel) => sel.toLowerCase() === t.toLowerCase())
              ).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTag(t)}
                  className="rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
                >
                  + {t}
                </button>
              ))}
            </div>

            {/* „Leady na" — widoczne tylko gdy wybrany tag PAKIETY LEADÓW */}
            {hasLeads && (
              <div className="space-y-1.5 rounded-md border bg-muted/30 p-2.5">
                <Label htmlFor="leadCategory">Leady na</Label>
                <Select value={leadCategory} onValueChange={setLeadCategory}>
                  <SelectTrigger id="leadCategory" className="w-full">
                    <SelectValue placeholder="Wybierz kategorię leadów" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Uwagi</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={2}
              defaultValue={invoice?.notes ?? ""}
              placeholder="Dodatkowe usługi, uwagi do rozliczenia…"
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
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
