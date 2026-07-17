"use client";

// Tabela rentowności nisz (wertykali leadowych) — wydatki kampanii vs przychód
// z tagów faktur „Leady: X". Wiersz klikalny → historia miesięczna niszy.

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, SortableHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { TableCell } from "@/components/ui/table";
import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface VerticalRow {
  vertical: string;
  leadsCount: number;
  spendGr: number;
  revenueGr: number;
  profitGr: number;
  marginFraction: number | null;
}

export function VerticalProfitabilityTable({ rows }: { rows: VerticalRow[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const totals = useMemo(() => {
    const leadsCount = rows.reduce((a, r) => a + r.leadsCount, 0);
    const spendGr = rows.reduce((a, r) => a + r.spendGr, 0);
    const revenueGr = rows.reduce((a, r) => a + r.revenueGr, 0);
    const profitGr = rows.reduce((a, r) => a + r.profitGr, 0);
    return {
      leadsCount,
      spendGr,
      revenueGr,
      profitGr,
      marginFraction: revenueGr > 0 ? profitGr / revenueGr : null,
    };
  }, [rows]);

  const columns: ColumnDef<VerticalRow>[] = useMemo(
    () => [
      {
        accessorKey: "vertical",
        header: ({ column }) => <SortableHeader column={column}>Nisza</SortableHeader>,
        cell: ({ row }) => <span className="font-medium">{row.original.vertical}</span>,
      },
      {
        accessorKey: "leadsCount",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Leady
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.leadsCount}</span>
        ),
      },
      {
        accessorKey: "spendGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Wydatki (kampanie)
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.spendGr),
      },
      {
        accessorKey: "revenueGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Przychód
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.revenueGr),
      },
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
        cell: ({ row }) => formatPercent(row.original.marginFraction),
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      initialSorting={[{ id: "revenueGr", desc: true }]}
      onRowClick={(row) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("w", row.vertical);
        router.push(`/rentownosc/nisza?${params.toString()}`);
      }}
      emptyState={
        <EmptyState
          title="Brak danych o niszach w okresie"
          description={'Dodaj kampanie w module Leady i oznacz faktury tagiem „Leady: …”, aby zobaczyć rentowność nisz.'}
        />
      }
      footer={
        <>
          <TableCell className="font-medium">Suma</TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {totals.leadsCount}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatMoney(totals.spendGr)}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatMoney(totals.revenueGr)}
          </TableCell>
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
