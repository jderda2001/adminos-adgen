"use client";

// Panel szczegółów klienta: dane współpracy (typ umowy, rozliczenie, wypowiedzenie),
// oferta, kontakt, notatki i akcje (Edytuj / Usuń / Złożył wypowiedzenie).

import { useState, useTransition } from "react";
import { Pencil, Trash2, CalendarX2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { StatusBadge } from "@/components/status-badge";
import { DatePicker } from "@/components/date-picker";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  BILLING_MODEL_LABELS,
  BILLING_TIMING_LABELS,
  CLIENT_STATUS_LABELS,
  CONTRACT_TYPE_LABELS,
  type BillingModel,
  type BillingTiming,
  type ClientStatus,
  type ContractType,
} from "@/lib/types";
import { dateToInput, formatDate, formatMoney, todayUTC } from "@/lib/format";
import { ClientFormDialog } from "./client-form";
import { setNoticeGivenAction } from "./actions";
import type { ClientRow } from "./clients-table";

function parseTags(raw: string | null): string[] {
  return (raw ?? "").split(",").map((t) => t.trim()).filter(Boolean);
}

/** Przycisk „Złożył wypowiedzenie" — dialog z datą; ustawia endDate wg okresu wypowiedzenia. */
function NoticeGivenButton({ client }: { client: ClientRow }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");
  const [pending, startTransition] = useTransition();
  const hasNotice = Boolean(client.noticeGivenDate);

  function confirm(clear = false) {
    startTransition(async () => {
      const res = await setNoticeGivenAction(client.id, clear ? "" : date);
      if (res.ok) {
        toast.success(res.message ?? "Zapisano");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDate(dateToInput(todayUTC()));
      }}
    >
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <CalendarX2 className="size-4" /> {hasNotice ? "Zmień wypowiedzenie" : "Złożył wypowiedzenie"}
      </Button>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Złożył wypowiedzenie</DialogTitle>
          <DialogDescription>
            Ustawimy datę zakończenia wg okresu wypowiedzenia z typu umowy. Rozliczamy
            z góry, więc ostatnia faktura wypadnie 1. dnia ostatniego miesiąca świadczenia.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="noticeDate">Data złożenia wypowiedzenia *</Label>
          <DatePicker id="noticeDate" value={date} onChange={setDate} />
        </div>
        <DialogFooter className="gap-2">
          {hasNotice && (
            <Button variant="outline" onClick={() => confirm(true)} disabled={pending}>
              Cofnij wypowiedzenie
            </Button>
          )}
          <Button onClick={() => confirm(false)} disabled={pending || !date}>
            {pending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ClientDetailSheet({
  client,
  open,
  onOpenChange,
  onDelete,
}: {
  client: ClientRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (client: ClientRow) => void;
}) {
  if (!client) return null;

  const tags = parseTags(client.offerTags);
  const statusLabel =
    CLIENT_STATUS_LABELS[client.status as ClientStatus] ?? client.status;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={client.name}
      description={client.nip ? `NIP ${client.nip}` : undefined}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <NoticeGivenButton client={client} />
          <ClientFormDialog
            client={client}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="size-4" /> Edytuj
              </Button>
            }
          />
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => onDelete(client)}
          >
            <Trash2 className="size-4" /> Usuń
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Współpraca
          </h3>
          <DetailRow label="Status">
            <StatusBadge tone={client.status === "ACTIVE" ? "green" : "neutral"}>
              {statusLabel}
            </StatusBadge>
          </DetailRow>
          <DetailRow label="Typ umowy">
            {CONTRACT_TYPE_LABELS[client.contractType as ContractType] ?? client.contractType}
          </DetailRow>
          <DetailRow label="Rozliczenie">
            {BILLING_TIMING_LABELS[client.billingTiming as BillingTiming] ?? client.billingTiming}
          </DetailRow>
          <DetailRow label="Model rozliczeń">
            {BILLING_MODEL_LABELS[client.billingModel as BillingModel] ?? client.billingModel}
          </DetailRow>
          <DetailRow label="Abonament (MRR)">
            {client.monthlyRetainerGr != null ? formatMoney(client.monthlyRetainerGr) : "—"}
          </DetailRow>
          <DetailRow label="Start współpracy">
            {client.startDate ? formatDate(new Date(client.startDate)) : "—"}
          </DetailRow>
          <DetailRow label="Wypowiedzenie">
            {client.noticeGivenDate ? formatDate(new Date(client.noticeGivenDate)) : "—"}
          </DetailRow>
          <DetailRow label="Koniec współpracy">
            {client.endDate ? formatDate(new Date(client.endDate)) : "—"}
          </DetailRow>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Oferta
          </h3>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <StatusBadge key={tag} tone="indigo">
                  {tag}
                </StatusBadge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Brak tagów oferty</p>
          )}
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Kontakt
          </h3>
          <DetailRow label="Osoba kontaktowa">{client.contactPerson ?? "—"}</DetailRow>
          <DetailRow label="E-mail">
            {client.email ? (
              <a href={`mailto:${client.email}`} className="text-primary hover:underline">
                {client.email}
              </a>
            ) : (
              "—"
            )}
          </DetailRow>
          <DetailRow label="Telefon">{client.phone ?? "—"}</DetailRow>
          <DetailRow label="Adres">{client.address ?? "—"}</DetailRow>
        </section>

        {client.notes && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Notatki
            </h3>
            <p className="whitespace-pre-wrap text-sm text-foreground">{client.notes}</p>
          </section>
        )}
      </div>
    </DetailSheet>
  );
}
