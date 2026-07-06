"use client";

// Panel szczegółów klienta: pełne dane kontaktowe, adres, notatki i akcje
// (Edytuj / Usuń). Otwierany klikiem w wiersz tabeli — widok główny pokazuje
// tylko podstawowe kolumny.

import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { StatusBadge } from "@/components/status-badge";
import {
  BILLING_MODEL_LABELS,
  CLIENT_STATUS_LABELS,
  type BillingModel,
  type ClientStatus,
} from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";
import { ClientFormDialog } from "./client-form";
import type { ClientRow } from "./clients-table";

function parseTags(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
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
        <div className="flex justify-end gap-2">
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
          <DetailRow label="Model rozliczeń">
            {BILLING_MODEL_LABELS[client.billingModel as BillingModel] ??
              client.billingModel}
          </DetailRow>
          <DetailRow label="Abonament (MRR)">
            {client.monthlyRetainerGr != null
              ? formatMoney(client.monthlyRetainerGr)
              : "—"}
          </DetailRow>
          <DetailRow label="Start współpracy">
            {client.startDate
              ? formatDate(new Date(client.startDate))
              : "—"}
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
          <DetailRow label="Osoba kontaktowa">
            {client.contactPerson ?? "—"}
          </DetailRow>
          <DetailRow label="E-mail">
            {client.email ? (
              <a
                href={`mailto:${client.email}`}
                className="text-primary hover:underline"
              >
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
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {client.notes}
            </p>
          </section>
        )}
      </div>
    </DetailSheet>
  );
}
