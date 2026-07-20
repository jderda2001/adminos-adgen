"use client";

// „Dostawy vs kontrakt" — kontrakt (liczba leadów z faktur PAKIETY LEADÓW)
// zaciąga się z Przychodów; Ty wpisujesz tylko ile faktycznie dowieziono.
// Dług/nadwyżka przenosi się na kolejne miesiące (kolumna „Bilans").

import { Plus } from "lucide-react";
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
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { formatMoney } from "@/lib/format";
import { DeliveryDialog, type ClientOption } from "./delivery-dialog";
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

function BalanceBadge({ balance }: { balance: number }) {
  if (balance === 0) return <StatusBadge tone="green" dot>rozliczone</StatusBadge>;
  if (balance > 0) return <StatusBadge tone="amber">−{balance} do dowiezienia</StatusBadge>;
  return <StatusBadge tone="blue">+{-balance} nadwyżka</StatusBadge>;
}

export function FulfillmentCard({
  month,
  rows,
  brands,
  clients,
  verticals,
  verticalsWithCampaign,
}: {
  month: string;
  rows: FulfillmentRow[];
  brands: BrandOption[];
  clients: ClientOption[];
  verticals: string[];
  verticalsWithCampaign: string[];
}) {
  const totals = rows.reduce(
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
            Kontrakt zaciągany z Przychodów (paczki leadów); wpisujesz tylko ile dowieziono.
            Dług/nadwyżka przechodzi na kolejny miesiąc.
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

      {rows.length === 0 ? (
        <div className="px-4 pb-4">
          <EmptyState
            title="Brak kontraktów w tym miesiącu"
            description={'Dodaj klientom leadowym fakturę „PAKIETY LEADÓW” w Przychodach — kontrakt pojawi się tu automatycznie.'}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Klient</TableHead>
              <TableHead>Wertykal</TableHead>
              <TableHead className="text-right">Kontrakt</TableHead>
              <TableHead className="text-right">Dowiezione</TableHead>
              <TableHead>Bilans</TableHead>
              <TableHead className="text-right">Koszt leadów</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.clientId}|${r.vertical}`}>
                <TableCell className="font-medium">{r.clientName}</TableCell>
                <TableCell>{r.vertical}</TableCell>
                <TableCell className="text-right tabular-nums">{r.owed}</TableCell>
                <TableCell className="text-right tabular-nums">{r.delivered}</TableCell>
                <TableCell>
                  <BalanceBadge balance={r.balance} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(r.costGr)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2}>Razem ({rows.length})</TableCell>
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
