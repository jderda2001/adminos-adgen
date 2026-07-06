"use client";

// Tabela rentowności klientów — wiersze klikalne (przejście do widoku
// szczegółowego), podświetlenie klientów z marżą poniżej progu z Ustawień,
// wiersz sum z łączną marżą w stopce.

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, SortableHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { TableCell } from "@/components/ui/table";
import { formatHours, formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ProfitabilityRow {
  clientId: string;
  clientName: string;
  revenueGr: number;
  directCostsGr: number;
  laborGr: number;
  minutes: number;
  allocationGr: number;
  profitGr: number;
  marginFraction: number | null;
  effectiveRateGr: number | null;
}

export function ProfitabilityTable({
  rows,
  allocationEnabled,
  marginThreshold,
}: {
  rows: ProfitabilityRow[];
  allocationEnabled: boolean;
  marginThreshold: number;
}) {
  const router = useRouter();

  const isBelowThreshold = (row: ProfitabilityRow) =>
    row.marginFraction !== null && row.marginFraction < marginThreshold;

  const totals = useMemo(() => {
    const revenueGr = rows.reduce((a, r) => a + r.revenueGr, 0);
    const directCostsGr = rows.reduce((a, r) => a + r.directCostsGr, 0);
    const laborGr = rows.reduce((a, r) => a + r.laborGr, 0);
    const minutes = rows.reduce((a, r) => a + r.minutes, 0);
    const allocationGr = rows.reduce((a, r) => a + r.allocationGr, 0);
    const profitGr = rows.reduce((a, r) => a + r.profitGr, 0);
    return {
      revenueGr,
      directCostsGr,
      laborGr,
      minutes,
      allocationGr,
      profitGr,
      marginFraction: revenueGr > 0 ? profitGr / revenueGr : null,
      effectiveRateGr:
        minutes > 0 ? Math.round(revenueGr / (minutes / 60)) : null,
    };
  }, [rows]);

  const columns: ColumnDef<ProfitabilityRow>[] = useMemo(() => {
    const cols: ColumnDef<ProfitabilityRow>[] = [
      {
        accessorKey: "clientName",
        header: ({ column }) => (
          <SortableHeader column={column}>Klient</SortableHeader>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.clientName}</span>
            {isBelowThreshold(row.original) && (
              <StatusBadge tone="red">poniżej progu</StatusBadge>
            )}
          </div>
        ),
      },
      {
        accessorKey: "revenueGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Przychody
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.revenueGr),
      },
      {
        accessorKey: "directCostsGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Koszty bezpośrednie
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.directCostsGr),
      },
      {
        accessorKey: "laborGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Koszt pracy
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => (
          <div>
            <div>{formatMoney(row.original.laborGr)}</div>
            <div className="text-xs text-muted-foreground">
              {formatHours(row.original.minutes)}
            </div>
          </div>
        ),
      },
    ];

    if (allocationEnabled) {
      cols.push({
        accessorKey: "allocationGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Alokacja
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.allocationGr),
      });
    }

    cols.push(
      {
        accessorKey: "profitGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Zysk
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => (
          <span
            className={cn(
              "font-medium",
              row.original.profitGr < 0 && "text-red-600 dark:text-red-400"
            )}
          >
            {formatMoney(row.original.profitGr)}
          </span>
        ),
      },
      {
        accessorKey: "marginFraction",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Marża %
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => {
          const value = formatPercent(row.original.marginFraction);
          if (isBelowThreshold(row.original)) {
            const tone =
              row.original.marginFraction !== null &&
              row.original.marginFraction < 0
                ? "red"
                : "amber";
            return <StatusBadge tone={tone}>{value}</StatusBadge>;
          }
          return value;
        },
      },
      {
        accessorKey: "effectiveRateGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Efektywna stawka
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.effectiveRateGr !== null
            ? `${formatMoney(row.original.effectiveRateGr)}/h`
            : "—",
      }
    );

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocationEnabled, marginThreshold]);

  return (
    <DataTable
      columns={columns}
      data={rows}
      initialSorting={[{ id: "profitGr", desc: true }]}
      onRowClick={(row) => router.push(`/rentownosc/${row.clientId}`)}
      rowClassName={(row) =>
        isBelowThreshold(row) ? "bg-red-50 dark:bg-red-950/30" : undefined
      }
      emptyState={
        <EmptyState
          title="Brak danych w wybranym okresie"
          description="Wystaw faktury, dodaj koszty przypisane do klientów lub zarejestruj czas pracy, aby zobaczyć rentowność. Możesz też zmienić okres w filtrze powyżej."
        />
      }
      footer={
        <>
          <TableCell className="font-medium">Suma</TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatMoney(totals.revenueGr)}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatMoney(totals.directCostsGr)}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            <div>{formatMoney(totals.laborGr)}</div>
            <div className="text-xs font-normal text-muted-foreground">
              {formatHours(totals.minutes)}
            </div>
          </TableCell>
          {allocationEnabled && (
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(totals.allocationGr)}
            </TableCell>
          )}
          <TableCell
            className={cn(
              "text-right font-medium tabular-nums",
              totals.profitGr < 0 && "text-red-600 dark:text-red-400"
            )}
          >
            {formatMoney(totals.profitGr)}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatPercent(totals.marginFraction)}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {totals.effectiveRateGr !== null
              ? `${formatMoney(totals.effectiveRateGr)}/h`
              : "—"}
          </TableCell>
        </>
      }
    />
  );
}
