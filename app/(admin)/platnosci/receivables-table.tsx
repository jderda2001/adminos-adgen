"use client";

// Zakładka "Do ściągnięcia" — faktury sprzedażowe ISSUED/OVERDUE z zaznaczaniem
// i oznaczaniem jako zapłacone (pojedynczo i masowo). Widok główny pokazuje
// podstawowe kolumny; pełne dane faktury (rozliczenie, daty, notatka) → DetailSheet.

import { useEffect, useMemo, useState, useTransition } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { DataTable, SortableHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { StatusBadge, invoiceTone } from "@/components/status-badge";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableCell } from "@/components/ui/table";
import { formatDate, formatMoney, pluralPl } from "@/lib/format";
import { INVOICE_STATUS_LABELS, type InvoiceStatus } from "@/lib/types";
import { markInvoicesPaidAction } from "./actions";

export interface ReceivableRow {
  id: string;
  number: string | null; // String? — null gdy faktura jeszcze bez numeru („bez fv")
  label: string | null;
  clientName: string;
  issueDate: string; // ISO
  saleDate: string; // ISO
  dueDate: string; // ISO — serializowane z serwera
  overdueDays: number; // > 0 = po terminie
  netGr: number;
  vatGr: number;
  grossGr: number;
  status: string; // ISSUED | OVERDUE
  notes: string | null;
}

/** "1 dzień" / "5 dni" */
function dniLabel(n: number): string {
  return `${n} ${pluralPl(n, "dzień", "dni", "dni")}`;
}

function statusLabel(status: string): string {
  return INVOICE_STATUS_LABELS[status as InvoiceStatus] ?? status;
}

export function ReceivablesTable({
  receivables,
}: {
  receivables: ReceivableRow[];
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [detailId, setDetailId] = useState<string | null>(null);

  // Po odświeżeniu danych usuń nieistniejące id z zaznaczenia
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(receivables.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [receivables]);

  useEffect(() => {
    if (detailId && !receivables.some((r) => r.id === detailId)) {
      setDetailId(null);
    }
  }, [receivables, detailId]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return receivables;
    return receivables.filter(
      (r) =>
        (r.number?.toLowerCase().includes(q) ?? false) ||
        r.clientName.toLowerCase().includes(q)
    );
  }, [receivables, search]);

  const totalGr = useMemo(
    () => filtered.reduce((sum, r) => sum + r.grossGr, 0),
    [filtered]
  );

  // KPI — na całym zbiorze należności
  const totalAllGr = useMemo(
    () => receivables.reduce((sum, r) => sum + r.grossGr, 0),
    [receivables]
  );
  const overdueRows = useMemo(
    () => receivables.filter((r) => r.overdueDays > 0),
    [receivables]
  );
  const overdueGr = useMemo(
    () => overdueRows.reduce((sum, r) => sum + r.grossGr, 0),
    [overdueRows]
  );

  const detailRow = useMemo(
    () => receivables.find((r) => r.id === detailId) ?? null,
    [receivables, detailId]
  );

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(filtered.map((r) => r.id)) : new Set());
  }

  function markPaid(ids: string[]) {
    startTransition(async () => {
      const result = await markInvoicesPaidAction(ids);
      if (result.ok) {
        toast.success(result.message);
        setSelected(new Set());
      } else {
        toast.error(result.error);
      }
    });
  }

  const allSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));
  const someSelected = filtered.some((r) => selected.has(r.id));

  const columns: ColumnDef<ReceivableRow>[] = useMemo(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={allSelected ? true : someSelected ? "indeterminate" : false}
            onCheckedChange={(v) => toggleAll(v === true)}
            aria-label="Zaznacz wszystkie"
          />
        ),
        cell: ({ row }) => (
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected.has(row.original.id)}
              onCheckedChange={(v) => toggleOne(row.original.id, v === true)}
              aria-label="Zaznacz fakturę"
            />
          </span>
        ),
        enableSorting: false,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge tone={invoiceTone(row.original.status)}>
            {statusLabel(row.original.status)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "number",
        header: ({ column }) => (
          <SortableHeader column={column}>Numer</SortableHeader>
        ),
        cell: ({ row }) =>
          row.original.number ? (
            <span className="font-medium">{row.original.number}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "clientName",
        header: ({ column }) => (
          <SortableHeader column={column}>Klient</SortableHeader>
        ),
      },
      {
        accessorKey: "dueDate",
        header: ({ column }) => (
          <SortableHeader column={column}>Termin</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">
            {formatDate(new Date(row.original.dueDate))}
          </span>
        ),
      },
      {
        accessorKey: "overdueDays",
        header: ({ column }) => (
          <SortableHeader column={column}>Po terminie</SortableHeader>
        ),
        cell: ({ row }) =>
          row.original.overdueDays > 0 ? (
            <span className="font-medium text-red-600 dark:text-red-400">
              {dniLabel(row.original.overdueDays)}
            </span>
          ) : (
            "—"
          ),
      },
      {
        accessorKey: "grossGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Brutto
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.grossGr),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, allSelected, someSelected, filtered]
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <KpiCard label="Do ściągnięcia" value={formatMoney(totalAllGr)} sub="brutto" />
        <KpiCard
          label="Po terminie"
          value={formatMoney(overdueGr)}
          sub={`${overdueRows.length} ${pluralPl(overdueRows.length, "faktura", "faktury", "faktur")}`}
          tone={overdueGr > 0 ? "negative" : "default"}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Szukaj po numerze faktury, kliencie…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-72"
        />
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2 shadow-[var(--shadow-card)]">
          <span className="text-sm font-medium">
            Zaznaczono: {selected.size}
          </span>
          <Button
            size="sm"
            disabled={pending}
            onClick={() => markPaid([...selected])}
          >
            <Check className="size-4" />
            {pending ? "Zapisywanie…" : `Oznacz zapłacone (${selected.size})`}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => setSelected(new Set())}
          >
            <X className="size-4" /> Wyczyść
          </Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={filtered}
        initialSorting={[{ id: "overdueDays", desc: true }]}
        onRowClick={(row) => setDetailId(row.id)}
        rowClassName={(row) =>
          row.overdueDays > 0
            ? "bg-red-500/5 hover:bg-red-500/10"
            : undefined
        }
        footer={
          <>
            <TableCell colSpan={6}>
              Suma ({filtered.length}{" "}
              {pluralPl(filtered.length, "faktura", "faktury", "faktur")})
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(totalGr)}
            </TableCell>
          </>
        }
        emptyState={
          <EmptyState
            title="Wszystkie faktury opłacone"
            description="Żaden klient nie zalega z płatnością — świetna robota. Nowe faktury wystawisz w module Finanse → Przychody."
          />
        }
      />

      <DetailSheet
        open={detailRow !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        title={detailRow?.number ?? "Faktura bez numeru"}
        description={detailRow?.clientName}
        footer={
          detailRow && (
            <div className="flex justify-end">
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  markPaid([detailRow.id]);
                  setDetailId(null);
                }}
              >
                <Check className="size-4" /> Oznacz zapłaconą
              </Button>
            </div>
          )
        }
      >
        {detailRow && (
          <div className="space-y-4">
            <div>
              <StatusBadge tone={invoiceTone(detailRow.status)}>
                {statusLabel(detailRow.status)}
              </StatusBadge>
            </div>
            <div>
              <DetailRow label="Numer">
                {detailRow.number ?? "—"}
              </DetailRow>
              <DetailRow label="Klient">{detailRow.clientName}</DetailRow>
              {detailRow.label && (
                <DetailRow label="Opis">{detailRow.label}</DetailRow>
              )}
            </div>
            <div>
              <DetailRow label="Data wystawienia">
                {formatDate(new Date(detailRow.issueDate))}
              </DetailRow>
              <DetailRow label="Data sprzedaży">
                {formatDate(new Date(detailRow.saleDate))}
              </DetailRow>
              <DetailRow label="Termin płatności">
                {formatDate(new Date(detailRow.dueDate))}
              </DetailRow>
              <DetailRow label="Po terminie">
                {detailRow.overdueDays > 0 ? (
                  <span className="text-red-600 dark:text-red-400">
                    {dniLabel(detailRow.overdueDays)}
                  </span>
                ) : (
                  "—"
                )}
              </DetailRow>
            </div>
            <div>
              <DetailRow label="Netto">{formatMoney(detailRow.netGr)}</DetailRow>
              <DetailRow label="VAT">{formatMoney(detailRow.vatGr)}</DetailRow>
              <DetailRow label="Brutto">
                <span className="font-semibold">
                  {formatMoney(detailRow.grossGr)}
                </span>
              </DetailRow>
            </div>
            {detailRow.notes && (
              <div>
                <div className="mb-1 text-sm text-muted-foreground">Notatka</div>
                <p className="text-sm whitespace-pre-wrap">{detailRow.notes}</p>
              </div>
            )}
          </div>
        )}
      </DetailSheet>
    </div>
  );
}
