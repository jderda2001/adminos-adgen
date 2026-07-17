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
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ProfitabilityRow {
  clientId: string;
  clientName: string;
  revenueGr: number;
  directCostsGr: number;
  allocationGr: number;
  leadCostGr: number;
  profitGr: number;
  marginFraction: number | null;
}

export function ProfitabilityTable({
  rows,
  allocationEnabled,
  showLeadCosts,
  marginThreshold,
}: {
  rows: ProfitabilityRow[];
  allocationEnabled: boolean;
  /** pokazuj kolumnę „Koszt leadów" (są dostawy albo księgowania budżetu reklamowego) */
  showLeadCosts: boolean;
  marginThreshold: number;
}) {
  const router = useRouter();

  const isBelowThreshold = (row: ProfitabilityRow) =>
    row.marginFraction !== null && row.marginFraction < marginThreshold;

  const totals = useMemo(() => {
    const revenueGr = rows.reduce((a, r) => a + r.revenueGr, 0);
    const directCostsGr = rows.reduce((a, r) => a + r.directCostsGr, 0);
    const allocationGr = rows.reduce((a, r) => a + r.allocationGr, 0);
    const leadCostGr = rows.reduce((a, r) => a + r.leadCostGr, 0);
    const profitGr = rows.reduce((a, r) => a + r.profitGr, 0);
    return {
      revenueGr,
      directCostsGr,
      allocationGr,
      leadCostGr,
      profitGr,
      marginFraction: revenueGr > 0 ? profitGr / revenueGr : null,
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
      ...(showLeadCosts
        ? ([
            {
              accessorKey: "leadCostGr",
              header: ({ column }) => (
                <SortableHeader column={column} align="right">
                  Koszt leadów
                </SortableHeader>
              ),
              meta: { align: "right" },
              cell: ({ row }) => formatMoney(row.original.leadCostGr),
            },
          ] as ColumnDef<ProfitabilityRow>[])
        : []),
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
      }
    );

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocationEnabled, showLeadCosts, marginThreshold]);

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
          description="Wystaw faktury lub dodaj koszty przypisane do klientów, aby zobaczyć rentowność. Możesz też zmienić okres w filtrze powyżej."
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
          {showLeadCosts && (
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(totals.leadCostGr)}
            </TableCell>
          )}
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
        </>
      }
    />
  );
}
