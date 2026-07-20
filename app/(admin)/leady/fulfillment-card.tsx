"use client";

// „Dostawy vs kontrakt" — pogrupowane po WERTYKALU (niszy). Każda nisza to sekcja
// z pulą: ile leadów marka wygenerowała (Meta), ile przypisaliśmy klientom i ile
// zostało nieprzypisanych (leżą). Kontrakt (liczba leadów z faktur PAKIETY LEADÓW)
// zaciąga się z Przychodów; „Dowiezione" wpisujesz ręcznie inline (przypisujecie
// leady ręcznie). Przycisk „paczka dostarczona" domyka całe zobowiązanie wiersza.
// Dług/nadwyżka przenosi się na kolejne miesiące (kolumna „Bilans").

import { useState, useTransition } from "react";
import { Check, PackageCheck, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
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
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { formatMoney } from "@/lib/format";
import { DeliveryDialog, type ClientOption } from "./delivery-dialog";
import { setDeliveredAction } from "./actions";
import type { BrandOption } from "./campaign-dialog";

export interface FulfillmentRow {
  clientId: string;
  clientName: string;
  vertical: string;
  owed: number; // zobowiązanie na ten miesiąc (kontrakt + dług z poprzednich)
  delivered: number;
  balance: number; // >0 dług, <0 nadwyżka, 0 rozliczone
  costGr: number; // dowiezione × CPL wertykalu
}

export interface VerticalSection {
  vertical: string;
  cplGr: number | null;
  generated: number; // leady wygenerowane w Mecie w tym miesiącu (Σ kampanii)
  assigned: number; // Σ dowiezionych klientom w tej niszy
  unassigned: number; // generated − assigned (leżące leady)
  rows: FulfillmentRow[];
}

function BalanceBadge({ balance }: { balance: number }) {
  if (balance === 0) return <StatusBadge tone="green" dot>rozliczone</StatusBadge>;
  if (balance > 0) return <StatusBadge tone="amber">−{balance} do dowiezienia</StatusBadge>;
  return <StatusBadge tone="blue">+{-balance} nadwyżka</StatusBadge>;
}

function UnassignedBadge({ value }: { value: number }) {
  if (value > 0) return <StatusBadge tone="blue">nieprzypisane {value}</StatusBadge>;
  if (value < 0) return <StatusBadge tone="neutral">z zapasu {-value}</StatusBadge>;
  return <StatusBadge tone="neutral">rozdane</StatusBadge>;
}

// Wiersz klienta z inline-edytowalnym „Dowiezione" i przyciskiem „paczka dostarczona".
function ClientRow({ month, row }: { month: string; row: FulfillmentRow }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(row.delivered));

  function commit(value: string) {
    startTransition(async () => {
      const res = await setDeliveredAction({
        period: month,
        clientId: row.clientId,
        vertical: row.vertical,
        leads: value,
      });
      if (res.ok) {
        toast.success(res.message ?? "Zapisano");
        setEditing(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function saveEdit() {
    const next = draft.trim();
    if (next === "" || next === String(row.delivered)) {
      setEditing(false);
      setDraft(String(row.delivered));
      return;
    }
    commit(next);
  }

  return (
    <TableRow>
      <TableCell className="font-medium">{row.clientName}</TableCell>
      <TableCell className="text-right tabular-nums">{row.owed}</TableCell>
      <TableCell className="text-right">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <Input
              autoFocus
              inputMode="numeric"
              value={draft}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(String(row.delivered));
                }
              }}
              className="h-7 w-16 text-right tabular-nums"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={saveEdit}
              disabled={pending}
              aria-label="Zapisz dowiezione"
            >
              <Check />
            </Button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(String(row.delivered));
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums transition-colors hover:bg-muted disabled:opacity-50"
          >
            {row.delivered}
            <Pencil className="size-3 text-muted-foreground" />
          </button>
        )}
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <BalanceBadge balance={row.balance} />
          {row.balance > 0 && (
            <Button
              size="xs"
              variant="ghost"
              className="text-primary"
              disabled={pending}
              onClick={() => commit(String(row.owed))}
              title="Ustaw dowiezione = całe zobowiązanie (kontrakt + dług)"
            >
              <PackageCheck data-icon="inline-start" /> paczka dostarczona
            </Button>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatMoney(row.costGr)}</TableCell>
    </TableRow>
  );
}

export function FulfillmentCard({
  month,
  sections,
  brands,
  clients,
  verticals,
  verticalsWithCampaign,
}: {
  month: string;
  sections: VerticalSection[];
  brands: BrandOption[];
  clients: ClientOption[];
  verticals: string[];
  verticalsWithCampaign: string[];
}) {
  const allRows = sections.flatMap((s) => s.rows);
  const totals = allRows.reduce(
    (a, r) => ({
      owed: a.owed + r.owed,
      delivered: a.delivered + r.delivered,
      costGr: a.costGr + r.costGr,
    }),
    { owed: 0, delivered: 0, costGr: 0 }
  );

  return (
    <div className="rounded-xl border bg-card shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Dostawy vs kontrakt</h2>
          <p className="text-xs text-muted-foreground">
            Nisze z pulą leadów: wygenerowane (Meta) → przypisane klientom → nieprzypisane.
            Kontrakt z Przychodów; „Dowiezione" wpisujesz ręcznie.
          </p>
        </div>
        <DeliveryDialog
          month={month}
          brands={brands}
          clients={clients}
          verticals={verticals}
          verticalsWithCampaign={verticalsWithCampaign}
          trigger={
            <Button size="sm" className="shrink-0">
              <Plus data-icon="inline-start" /> Dodaj dostawę
            </Button>
          }
        />
      </div>

      {sections.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState
            title="Brak kontraktów i kampanii w tym miesiącu"
            description={'Dodaj klientom leadowym fakturę „PAKIETY LEADÓW” w Przychodach (kontrakt) albo zaciągnij kampanie z Mety — nisze pojawią się tu automatycznie.'}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Klient</TableHead>
              <TableHead className="text-right">Kontrakt</TableHead>
              <TableHead className="text-right">Dowiezione</TableHead>
              <TableHead>Bilans</TableHead>
              <TableHead className="text-right">Koszt leadów</TableHead>
            </TableRow>
          </TableHeader>
          {sections.map((sec) => (
            <TableBody key={sec.vertical}>
              <TableRow className="border-t-2 bg-muted/50 hover:bg-muted/50">
                <TableCell colSpan={5} className="py-2">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold">{sec.vertical}</span>
                      <span className="text-xs text-muted-foreground">
                        CPL {sec.cplGr !== null ? formatMoney(sec.cplGr) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>
                        wygenerowane{" "}
                        <span className="font-medium tabular-nums text-foreground">{sec.generated}</span>
                      </span>
                      <span>
                        przypisane{" "}
                        <span className="font-medium tabular-nums text-foreground">{sec.assigned}</span>
                      </span>
                      <UnassignedBadge value={sec.unassigned} />
                    </div>
                  </div>
                </TableCell>
              </TableRow>
              {sec.rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-2 text-xs text-muted-foreground">
                    Brak przypisań — {sec.generated > 0
                      ? `wszystkie ${sec.generated} leadów tej niszy leży nieprzypisane`
                      : "brak kontraktów i leadów w tym miesiącu"}
                    .
                  </TableCell>
                </TableRow>
              ) : (
                sec.rows.map((r) => (
                  <ClientRow key={`${r.clientId}|${r.vertical}`} month={month} row={r} />
                ))
              )}
            </TableBody>
          ))}
          <TableFooter>
            <TableRow>
              <TableCell>Razem ({allRows.length})</TableCell>
              <TableCell className="text-right tabular-nums">{totals.owed}</TableCell>
              <TableCell className="text-right tabular-nums">{totals.delivered}</TableCell>
              <TableCell />
              <TableCell className="text-right tabular-nums">{formatMoney(totals.costGr)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      )}
    </div>
  );
}
