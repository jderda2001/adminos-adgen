"use client";

// Tabela czasu pracy (panel admina): data, osoba, klient, opis, godziny,
// koszt pracy wg stawki historycznej — sumy w stopce.

import { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { DataTable, SortableHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { TableCell } from "@/components/ui/table";
import { formatDate, formatHours, formatMoney } from "@/lib/format";

export interface TimeAdminRow {
  id: string;
  date: string; // ISO — serializowane z serwera
  userName: string;
  clientName: string;
  description: string | null;
  minutes: number;
  costGr: number; // koszt pracy wg stawki obowiązującej w dniu wpisu
}

export function TimeTable({ rows }: { rows: TimeAdminRow[] }) {
  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          minutes: acc.minutes + r.minutes,
          costGr: acc.costGr + r.costGr,
        }),
        { minutes: 0, costGr: 0 }
      ),
    [rows]
  );

  const columns: ColumnDef<TimeAdminRow>[] = useMemo(
    () => [
      {
        accessorKey: "date",
        header: ({ column }) => (
          <SortableHeader column={column}>Data</SortableHeader>
        ),
        cell: ({ row }) => formatDate(new Date(row.original.date)),
      },
      {
        accessorKey: "userName",
        header: ({ column }) => (
          <SortableHeader column={column}>Osoba</SortableHeader>
        ),
      },
      {
        accessorKey: "clientName",
        header: ({ column }) => (
          <SortableHeader column={column}>Klient</SortableHeader>
        ),
      },
      {
        accessorKey: "description",
        header: "Opis",
        cell: ({ row }) => (
          <span className="block max-w-72 truncate text-muted-foreground">
            {row.original.description ?? "—"}
          </span>
        ),
      },
      {
        accessorKey: "minutes",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Godziny
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatHours(row.original.minutes),
      },
      {
        accessorKey: "costGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Koszt pracy
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.costGr),
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      initialSorting={[{ id: "date", desc: true }]}
      emptyState={
        <EmptyState
          title="Brak wpisów czasu w wybranym okresie"
          description="Zmień okres lub filtry osoby i klienta. Pracownicy rejestrują czas w panelu „Mój czas”."
        />
      }
      footer={
        <>
          <TableCell colSpan={4} className="font-medium">
            Razem
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatHours(totals.minutes)}
          </TableCell>
          <TableCell className="text-right font-medium tabular-nums">
            {formatMoney(totals.costGr)}
          </TableCell>
        </>
      }
    />
  );
}
