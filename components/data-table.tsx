"use client";

// Wspólna tabela danych: sortowanie, paginacja, opcjonalny wiersz sum.
// Filtry są specyficzne dla modułów — renderuj je nad tabelą.

import * as React from "react";
import {
  ColumnDef,
  SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { pluralPl } from "@/lib/format";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** komórki wiersza sum (TableFooter); wyrenderowane w <TableRow> */
  footer?: React.ReactNode;
  pageSize?: number;
  emptyState?: React.ReactNode;
  initialSorting?: SortingState;
  onRowClick?: (row: TData) => void;
  rowClassName?: (row: TData) => string | undefined;
  /** wszystkie wiersze na jednej stronie, przewijane; nagłówek/stopka przyklejone */
  scrollable?: boolean;
  /** gęstszy układ (mniejsze wiersze i czcionka) — więcej mieści się na ekranie */
  dense?: boolean;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  footer,
  pageSize = 20,
  emptyState,
  initialSorting = [],
  onRowClick,
  rowClassName,
  scrollable = false,
  dense = false,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);

  // tryb przewijalny: bez paginacji (wszystkie wiersze), scroll w kontenerze
  const effectivePageSize = scrollable ? Math.max(data.length, 1) : pageSize;

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: effectivePageSize } },
  });

  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className="space-y-3">
      <div
        className={cn(
          "rounded-xl border bg-card shadow-[var(--shadow-card)]",
          scrollable
            ? "max-h-[calc(100vh-19rem)] overflow-auto"
            : "overflow-hidden",
          dense && "text-[13px] [&_td]:py-1.5"
        )}
      >
        <Table>
          <TableHeader
            className={cn(
              "[&_tr]:border-b [&_tr]:bg-muted/40 [&_tr]:hover:bg-muted/40",
              scrollable && "sticky top-0 z-20 [&_tr]:!bg-muted"
            )}
          >
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "h-10 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                      (header.column.columnDef.meta as { align?: string })
                        ?.align === "right" && "text-right"
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={cn(
                  "border-border/60",
                  onRowClick && "cursor-pointer hover:bg-accent/40",
                  rowClassName?.(row.original)
                )}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    key={cell.id}
                    className={cn(
                      (cell.column.columnDef.meta as { align?: string })
                        ?.align === "right" && "text-right tabular-nums"
                    )}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
          {footer && (
            <TableFooter
              className={cn(scrollable && "sticky bottom-0 z-20")}
            >
              <TableRow>{footer}</TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
      {pageCount > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Strona {pageIndex + 1} z {pageCount} ({data.length}{" "}
            {pluralPl(data.length, "pozycja", "pozycje", "pozycji")})
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Poprzednia
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Następna
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Nagłówek kolumny z sortowaniem */
export function SortableHeader<TData>({
  column,
  children,
  align,
}: {
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
  children: React.ReactNode;
  align?: "right";
}) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("-ml-2 h-8 gap-1 px-2", align === "right" && "-mr-2 ml-auto flex")}
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {children}
      {sorted === "asc" ? (
        <ArrowUp className="size-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="size-3.5" />
      ) : (
        <ArrowUpDown className="size-3.5 opacity-50" />
      )}
    </Button>
  );
}
