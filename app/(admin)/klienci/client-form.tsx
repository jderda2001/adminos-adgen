"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import {
  BILLING_MODEL_LABELS,
  BILLING_MODELS,
  CLIENT_STATUS_LABELS,
  CLIENT_STATUSES,
  DEFAULT_OFFER_TAGS,
} from "@/lib/types";
import { dateToInput, formatAmount } from "@/lib/format";
import { createClientAction, updateClientAction } from "./actions";
import type { ClientRow } from "./clients-table";

function parseTags(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function ClientFormDialog({
  client,
  trigger,
}: {
  client?: ClientRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [tags, setTags] = useState<string[]>(() => parseTags(client?.offerTags));
  const [tagInput, setTagInput] = useState("");

  function handleOpenChange(next: boolean) {
    // przy każdym otwarciu przywróć tagi z klienta (spójnie z defaultValue innych pól)
    if (next) {
      setTags(parseTags(client?.offerTags));
      setTagInput("");
    }
    setOpen(next);
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
    setTags((prev) => prev.filter((t) => t !== tag));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = client
        ? await updateClientAction(client.id, formData)
        : await createClientAction(formData);
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
            {client ? "Edytuj klienta" : "Nowy klient"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nazwa *</Label>
            <Input
              id="name"
              name="name"
              defaultValue={client?.name}
              required
              placeholder="np. Kowalski i Wspólnicy sp. z o.o."
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="nip">NIP</Label>
              <Input
                id="nip"
                name="nip"
                defaultValue={client?.nip ?? ""}
                placeholder="1234567890"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPerson">Osoba kontaktowa</Label>
              <Input
                id="contactPerson"
                name="contactPerson"
                defaultValue={client?.contactPerson ?? ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={client?.email ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={client?.phone ?? ""}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Adres</Label>
            <Input
              id="address"
              name="address"
              defaultValue={client?.address ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="billingModel">Model rozliczeń *</Label>
              <Select
                name="billingModel"
                defaultValue={client?.billingModel ?? "ABONAMENT"}
              >
                <SelectTrigger id="billingModel" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BILLING_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {BILLING_MODEL_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthlyRetainer">Abonament mies. netto (zł)</Label>
              <Input
                id="monthlyRetainer"
                name="monthlyRetainer"
                inputMode="decimal"
                placeholder="12 000,00"
                defaultValue={
                  client?.monthlyRetainerGr != null
                    ? formatAmount(client.monthlyRetainerGr)
                    : ""
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="status">Status *</Label>
              <Select name="status" defaultValue={client?.status ?? "ACTIVE"}>
                <SelectTrigger id="status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLIENT_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {CLIENT_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Start współpracy</Label>
              <DatePicker
                id="startDate"
                name="startDate"
                clearable
                defaultValue={
                  client?.startDate ? dateToInput(new Date(client.startDate)) : ""
                }
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="endDate">Data zakończenia</Label>
              <DatePicker
                id="endDate"
                name="endDate"
                clearable
                defaultValue={
                  client?.endDate ? dateToInput(new Date(client.endDate)) : ""
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="noticeMonths">Okres wypowiedzenia (mies.)</Label>
              <Input
                id="noticeMonths"
                name="noticeMonths"
                type="number"
                min={0}
                max={24}
                placeholder="np. 1"
                defaultValue={client?.noticeMonths ?? ""}
              />
            </div>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            Data zakończenia i okres wypowiedzenia zasilają moduł Estymacje
            (przychód „umowny" vs „zakładany").
          </p>
          <div className="space-y-2">
            <Label htmlFor="offerTagInput">Oferta / tagi</Label>
            {/* wartość przesyłana do akcji: tagi złączone przecinkiem */}
            <input type="hidden" name="offerTags" value={tags.join(",")} />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
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
              list="offer-tag-suggestions"
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
            <datalist id="offer-tag-suggestions">
              {DEFAULT_OFFER_TAGS.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_OFFER_TAGS.filter(
                (t) =>
                  !tags.some((sel) => sel.toLowerCase() === t.toLowerCase())
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notatki</Label>
            <Textarea
              id="notes"
              name="notes"
              rows={3}
              defaultValue={client?.notes ?? ""}
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
