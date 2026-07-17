"use client";

// Karta „Kampanie" — miesięczne wyniki marka × wertykal (spend, leady, CPL)
// z Meta Ads Manager. Edycja/usuwanie per wiersz, dodawanie dialogiem.

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
import { CampaignDialog, type BrandOption } from "./campaign-dialog";
import { deleteCampaignAction } from "./actions";

export interface CampaignRow {
  id: string;
  brandId: string;
  brandName: string;
  vertical: string;
  spendGr: number;
  leadsCount: number;
  cplGr: number | null;
  note: string | null;
}

export function CampaignsCard({
  month,
  campaigns,
  brands,
}: {
  month: string;
  campaigns: CampaignRow[];
  brands: BrandOption[];
}) {
  const [toDelete, setToDelete] = useState<CampaignRow | null>(null);
  const [pending, startTransition] = useTransition();

  function confirmDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const res = await deleteCampaignAction(toDelete.id);
      if (res.ok) toast.success(res.message ?? "Usunięto");
      else toast.error(res.error);
      setToDelete(null);
    });
  }

  const totalSpend = campaigns.reduce((s, c) => s + c.spendGr, 0);
  const totalLeads = campaigns.reduce((s, c) => s + c.leadsCount, 0);
  const avgCpl = totalLeads > 0 ? Math.round(totalSpend / totalLeads) : null;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Kampanie (Meta Ads Manager)</h2>
          <p className="text-xs text-muted-foreground">
            Wydatki netto i leady per marka × wertykal — stąd liczy się CPL
          </p>
        </div>
        <CampaignDialog
          month={month}
          brands={brands}
          trigger={
            <Button size="sm">
              <Plus className="size-4" /> Dodaj kampanię
            </Button>
          }
        />
      </div>

      {campaigns.length === 0 ? (
        <EmptyState
          title="Brak kampanii w tym miesiącu"
          description="Przepisz z Meta Ads Manager wydatki i liczbę leadów per marka i wertykal — CPL policzy się automatycznie."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Marka</TableHead>
              <TableHead>Wertykal</TableHead>
              <TableHead className="text-right">Wydatki netto</TableHead>
              <TableHead className="text-right">Leady</TableHead>
              <TableHead className="text-right">CPL</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {campaigns.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">{c.brandName}</TableCell>
                <TableCell>{c.vertical}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatMoney(c.spendGr)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.leadsCount}
                  {c.leadsCount === 0 && c.spendGr > 0 && (
                    <StatusBadge tone="red" className="ml-2">
                      bez leadów
                    </StatusBadge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.cplGr !== null ? formatMoney(c.cplGr) : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-0.5">
                    <CampaignDialog
                      month={month}
                      brands={brands}
                      campaign={{
                        id: c.id,
                        brandId: c.brandId,
                        vertical: c.vertical,
                        spendGr: c.spendGr,
                        leadsCount: c.leadsCount,
                        note: c.note,
                      }}
                      trigger={
                        <Button variant="ghost" size="icon-sm" aria-label="Edytuj kampanię">
                          <Pencil className="size-3.5" />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Usuń kampanię"
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => setToDelete(c)}
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
              <TableCell colSpan={2} className="font-medium">
                Suma ({campaigns.length}{" "}
                {pluralPl(campaigns.length, "kampania", "kampanie", "kampanii")})
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(totalSpend)}
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">{totalLeads}</TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {avgCpl !== null ? formatMoney(avgCpl) : "—"}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      )}

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć kampanię?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete
                ? `${toDelete.brandName} × ${toDelete.vertical} — dostawy rozliczane tą kampanią przejdą na średnią wertykalu (lub koszt 0).`
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
