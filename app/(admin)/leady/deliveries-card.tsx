"use client";

// Karta „Dostawy leadów do klientów" — kto ile leadów dostał i po jakim CPL.
// Koszt = leady × CPL (marki lub średniej wertykalu) — wchodzi do rentowności.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
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
import { formatMoney, pluralPl } from "@/lib/format";
import { LEAD_COST_SOURCE_LABELS, type LeadCostSource } from "@/lib/types";
import { DeliveryDialog, type ClientOption } from "./delivery-dialog";
import type { BrandOption } from "./campaign-dialog";
import { deleteDeliveryAction } from "./actions";

export interface DeliveryRow {
  id: string;
  clientId: string;
  clientName: string;
  vertical: string;
  brandId: string | null;
  brandName: string | null;
  leadsCount: number;
  costGr: number;
  cplGr: number | null;
  source: LeadCostSource;
  estimated: boolean;
  note: string | null;
}

const SOURCE_TONE: Record<LeadCostSource, "neutral" | "blue" | "red"> = {
  MARKA: "neutral",
  SREDNIA_WERTYKALU: "blue",
  BRAK_KAMPANII: "red",
};

export function DeliveriesCard({
  month,
  deliveries,
  brands,
  clients,
  verticals,
  verticalsWithCampaign,
}: {
  month: string;
  deliveries: DeliveryRow[];
  brands: BrandOption[];
  clients: ClientOption[];
  verticals: string[];
  /** wertykale z kampanią (leady>0) w tym miesiącu — do ostrzeżenia „brak kampanii" */
  verticalsWithCampaign: string[];
}) {
  const [toDelete, setToDelete] = useState<DeliveryRow | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const res = await deleteDeliveryAction(toDelete.id);
      if (res.ok) toast.success(res.message ?? "Usunięto");
      else toast.error(res.error);
      setToDelete(null);
    });
  }

  const totalLeads = deliveries.reduce((s, d) => s + d.leadsCount, 0);
  const totalCost = deliveries.reduce((s, d) => s + d.costGr, 0);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Dostawy leadów do klientów</h2>
          <p className="text-xs text-muted-foreground">
            Koszt leadów klienta = leady × CPL — pomniejsza jego zysk w Rentowności
          </p>
        </div>
        <DeliveryDialog
          month={month}
          brands={brands}
          clients={clients}
          verticals={verticals}
          verticalsWithCampaign={verticalsWithCampaign}
          trigger={
            <Button size="sm">
              <Plus className="size-4" /> Dodaj dostawę
            </Button>
          }
        />
      </div>

      {deliveries.length === 0 ? (
        <EmptyState
          title="Brak dostaw w tym miesiącu"
          description="Dodaj dostawę: klient + wertykal + liczba leadów (opcjonalnie konkretna marka). Koszt policzy się z CPL kampanii."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Klient</TableHead>
              <TableHead>Wertykal</TableHead>
              <TableHead>Marka</TableHead>
              <TableHead className="text-right">Leady</TableHead>
              <TableHead className="text-right">CPL</TableHead>
              <TableHead className="text-right">Koszt</TableHead>
              <TableHead>Źródło CPL</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deliveries.map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-1.5">
                    {d.clientName}
                    {d.estimated && (
                      <StatusBadge tone="amber">estymacja</StatusBadge>
                    )}
                  </span>
                </TableCell>
                <TableCell>{d.vertical}</TableCell>
                <TableCell className="text-muted-foreground">
                  {d.brandName ?? "mix"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{d.leadsCount}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {d.cplGr !== null ? formatMoney(d.cplGr) : "—"}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatMoney(d.costGr)}
                </TableCell>
                <TableCell>
                  <StatusBadge tone={SOURCE_TONE[d.source]}>
                    {LEAD_COST_SOURCE_LABELS[d.source]}
                  </StatusBadge>
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5">
                    <DeliveryDialog
                      month={month}
                      brands={brands}
                      clients={clients}
                      verticals={verticals}
                      verticalsWithCampaign={verticalsWithCampaign}
                      delivery={{
                        id: d.id,
                        clientId: d.clientId,
                        vertical: d.vertical,
                        brandId: d.brandId,
                        leadsCount: d.leadsCount,
                        note: d.note,
                      }}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label="Edytuj dostawę">
                          <Pencil className="size-3.5" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Usuń dostawę"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => setToDelete(d)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={3} className="font-medium">
                Suma ({deliveries.length}{" "}
                {pluralPl(deliveries.length, "dostawa", "dostawy", "dostaw")})
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{totalLeads}</TableCell>
              <TableCell />
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(totalCost)}
              </TableCell>
              <TableCell colSpan={2} />
            </TableRow>
          </TableFooter>
        </Table>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć dostawę?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `${toDelete.clientName} — ${toDelete.leadsCount} leadów (${toDelete.vertical}). Koszt leadów zniknie z rentowności klienta.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Anuluj</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete} disabled={pending}>
              {pending ? "Usuwanie…" : "Usuń"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
