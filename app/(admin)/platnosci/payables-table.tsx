"use client";

// Zakładka "Do zapłaty" — niezapłacone koszty z zaznaczaniem, masowym
// oznaczaniem jako zapłacone i eksportem paczki przelewów Elixir-0.
// Widok główny pokazuje podstawowe kolumny; pełne dane pozycji (rozliczenie,
// pełny nr rachunku, notatka) i akcje jednostkowe → DetailSheet po kliknięciu wiersza.

import { useEffect, useMemo, useState, useTransition } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Check, Download, TriangleAlert, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { DataTable, SortableHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { StatusBadge, costTone } from "@/components/status-badge";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableCell } from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatDate, formatMoney, pluralPl } from "@/lib/format";
import { COST_APPROVAL_LABELS } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  approveCostsAction,
  markCostsPaidAction,
  unapproveCostsAction,
} from "./actions";

export interface PayableRow {
  id: string;
  dueDate: string | null; // ISO — serializowane z serwera
  docDate: string; // ISO — data dokumentu
  overdueDays: number | null; // > 0 = po terminie, null = brak terminu
  supplierName: string;
  docNumber: string;
  categoryName: string;
  netGr: number;
  vatGr: number;
  grossGr: number;
  account: string | null;
  accountValid: boolean;
  approvedForPayment: boolean; // true = „Można płacić", false = „Brak działań"
  note: string | null;
}

/** Segment filtra akceptacji nad tabelą */
type ApprovalFilter = "all" | "approved" | "none";

/** "1 dzień" / "5 dni" */
function dniLabel(n: number): string {
  return `${n} ${pluralPl(n, "dzień", "dni", "dni")}`;
}

/** Opis odległości od terminu: "za 3 dni" / "5 dni po terminie" / "dzisiaj" / "—" */
function termLabel(overdueDays: number | null): string {
  if (overdueDays === null) return "—";
  if (overdueDays > 0) return `${dniLabel(overdueDays)} po terminie`;
  if (overdueDays === 0) return "dzisiaj";
  return `za ${dniLabel(-overdueDays)}`;
}

/** Kolor terminu: czerwony po terminie, bursztynowy gdy termin w ciągu 7 dni */
function termClass(overdueDays: number | null): string | undefined {
  if (overdueDays === null) return undefined;
  if (overdueDays > 0) return "text-red-600 font-medium dark:text-red-400";
  if (overdueDays >= -7) return "text-amber-600 font-medium dark:text-amber-500";
  return undefined;
}

/** Skrócony numer rachunku: "12 … 6789" */
function shortAccount(account: string): string {
  const digits = account.replace(/[^0-9]/g, "");
  if (digits.length < 8) return account;
  return `${digits.slice(0, 2)} … ${digits.slice(-4)}`;
}

/** Pełny NRB w grupach: "12 3456 7890 …" */
function formatNrb(account: string): string {
  const digits = account.replace(/[^0-9]/g, "");
  if (digits.length !== 26) return account;
  return [
    digits.slice(0, 2),
    digits.slice(2, 6),
    digits.slice(6, 10),
    digits.slice(10, 14),
    digits.slice(14, 18),
    digits.slice(18, 22),
    digits.slice(22, 26),
  ].join(" ");
}

export function PayablesTable({ payables }: { payables: PayableRow[] }) {
  const [search, setSearch] = useState("");
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [detailId, setDetailId] = useState<string | null>(null);

  // Po odświeżeniu danych (np. oznaczeniu zapłaconych) usuń nieistniejące id z zaznaczenia
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(payables.map((p) => p.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [payables]);

  // Zamknij panel szczegółów, gdy pozycja zniknęła z danych
  useEffect(() => {
    if (detailId && !payables.some((p) => p.id === detailId)) {
      setDetailId(null);
    }
  }, [payables, detailId]);

  // Liczniki segmentu akceptacji (na całym zbiorze, przed filtrem tekstowym)
  const approvedCount = useMemo(
    () => payables.filter((p) => p.approvedForPayment).length,
    [payables]
  );
  const noneCount = payables.length - approvedCount;

  // KPI — na całym zbiorze niezapłaconych (nie zależą od filtra)
  const totalAllGr = useMemo(
    () => payables.reduce((sum, p) => sum + p.grossGr, 0),
    [payables]
  );
  const overdueRows = useMemo(
    () => payables.filter((p) => p.overdueDays !== null && p.overdueDays > 0),
    [payables]
  );
  const overdueGr = useMemo(
    () => overdueRows.reduce((sum, p) => sum + p.grossGr, 0),
    [overdueRows]
  );
  const approvedGr = useMemo(
    () =>
      payables
        .filter((p) => p.approvedForPayment)
        .reduce((sum, p) => sum + p.grossGr, 0),
    [payables]
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return payables.filter((p) => {
      if (approvalFilter === "approved" && !p.approvedForPayment) return false;
      if (approvalFilter === "none" && p.approvedForPayment) return false;
      if (!q) return true;
      return (
        p.supplierName.toLowerCase().includes(q) ||
        p.docNumber.toLowerCase().includes(q) ||
        p.categoryName.toLowerCase().includes(q)
      );
    });
  }, [payables, search, approvalFilter]);

  const totalGr = useMemo(
    () => filtered.reduce((sum, p) => sum + p.grossGr, 0),
    [filtered]
  );

  const selectedRows = useMemo(
    () => payables.filter((p) => selected.has(p.id)),
    [payables, selected]
  );
  const selectedInvalidCount = selectedRows.filter(
    (p) => !p.accountValid
  ).length;
  const selectedUnapprovedCount = selectedRows.filter(
    (p) => !p.approvedForPayment
  ).length;
  // Eksport Elixir tylko gdy WSZYSTKIE zaznaczone są „Można płacić" i mają poprawny NRB
  const canExport =
    selectedRows.length > 0 &&
    selectedUnapprovedCount === 0 &&
    selectedInvalidCount === 0;
  const exportBlockReason =
    selectedUnapprovedCount > 0
      ? `Eksport obejmuje tylko pozycje „${COST_APPROVAL_LABELS.APPROVED}". Zatwierdź lub odznacz ${pluralPl(selectedUnapprovedCount, "pozycję", "pozycje", "pozycji")} bez akceptacji.`
      : selectedInvalidCount > 0
        ? `Popraw numer rachunku w ${pluralPl(selectedInvalidCount, "zaznaczonej pozycji", "zaznaczonych pozycjach", "zaznaczonych pozycjach")} — bez poprawnego NRB przelew nie wejdzie do paczki.`
        : null;

  const detailRow = useMemo(
    () => payables.find((p) => p.id === detailId) ?? null,
    [payables, detailId]
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
    setSelected(checked ? new Set(filtered.map((p) => p.id)) : new Set());
  }

  function markPaid(ids: string[]) {
    startTransition(async () => {
      const result = await markCostsPaidAction(ids);
      if (result.ok) {
        toast.success(result.message);
        setSelected(new Set());
      } else {
        toast.error(result.error);
      }
    });
  }

  function approve(ids: string[]) {
    startTransition(async () => {
      const result = await approveCostsAction(ids);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function unapprove(ids: string[]) {
    startTransition(async () => {
      const result = await unapproveCostsAction(ids);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  async function exportElixir() {
    const ids = [...selected];
    if (ids.length === 0 || !canExport) return;
    setExporting(true);
    try {
      const response = await fetch("/api/eksport/elixir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (response.ok) {
        const blob = await response.blob();
        const disposition = response.headers.get("Content-Disposition") ?? "";
        const match = disposition.match(/filename="?([^";]+)"?/);
        const filename = match?.[1] ?? "przelewy.txt";
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        toast.success(
          ids.length === 1
            ? "Wygenerowano paczkę z 1 przelewem"
            : `Wygenerowano paczkę z ${ids.length} przelewami`
        );
      } else {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(data?.error ?? "Nie udało się wygenerować paczki przelewów");
      }
    } catch {
      toast.error("Nie udało się wygenerować paczki przelewów");
    } finally {
      setExporting(false);
    }
  }

  const allSelected =
    filtered.length > 0 && filtered.every((p) => selected.has(p.id));
  const someSelected = filtered.some((p) => selected.has(p.id));

  const columns: ColumnDef<PayableRow>[] = useMemo(
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
          // stopPropagation — klik w checkbox nie otwiera panelu szczegółów
          <span onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={selected.has(row.original.id)}
              onCheckedChange={(v) => toggleOne(row.original.id, v === true)}
              aria-label="Zaznacz pozycję"
            />
          </span>
        ),
        enableSorting: false,
      },
      {
        id: "approval",
        accessorFn: (row) => (row.approvedForPayment ? 1 : 0),
        header: ({ column }) => (
          <SortableHeader column={column}>Akceptacja</SortableHeader>
        ),
        cell: ({ row }) => (
          <StatusBadge tone={costTone(false, row.original.approvedForPayment)}>
            {row.original.approvedForPayment
              ? COST_APPROVAL_LABELS.APPROVED
              : COST_APPROVAL_LABELS.NONE}
          </StatusBadge>
        ),
      },
      {
        id: "dueDate",
        // null (brak terminu) na końcu przy sortowaniu rosnącym
        accessorFn: (row) =>
          row.dueDate ? new Date(row.dueDate).getTime() : Number.MAX_SAFE_INTEGER,
        header: ({ column }) => (
          <SortableHeader column={column}>Termin</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className={cn("tabular-nums", termClass(row.original.overdueDays))}>
            {row.original.dueDate
              ? formatDate(new Date(row.original.dueDate))
              : "—"}
          </span>
        ),
      },
      {
        id: "term",
        header: "Do terminu",
        enableSorting: false,
        cell: ({ row }) => (
          <span className={cn("text-sm", termClass(row.original.overdueDays))}>
            {termLabel(row.original.overdueDays)}
          </span>
        ),
      },
      {
        accessorKey: "supplierName",
        header: ({ column }) => (
          <SortableHeader column={column}>Dostawca</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.supplierName}</span>
        ),
      },
      {
        accessorKey: "categoryName",
        header: ({ column }) => (
          <SortableHeader column={column}>Kategoria</SortableHeader>
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
      {
        id: "account",
        header: "Nr rachunku",
        enableSorting: false,
        cell: ({ row }) => {
          const { account, accountValid } = row.original;
          if (!account) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <TriangleAlert className="size-4 text-amber-600 dark:text-amber-500" />
                    brak
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Brak numeru rachunku — pozycja nie wejdzie do paczki przelewów
                </TooltipContent>
              </Tooltip>
            );
          }
          if (!accountValid) {
            return (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center gap-1 tabular-nums">
                    <TriangleAlert className="size-4 text-amber-600 dark:text-amber-500" />
                    {shortAccount(account)}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Niepoprawny numer rachunku (wymagane 26 cyfr NRB) — pozycja nie
                  wejdzie do paczki przelewów
                </TooltipContent>
              </Tooltip>
            );
          }
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="tabular-nums">{shortAccount(account)}</span>
              </TooltipTrigger>
              <TooltipContent>{formatNrb(account)}</TooltipContent>
            </Tooltip>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, allSelected, someSelected, filtered]
  );

  const filterButtons: { value: ApprovalFilter; label: string; count: number }[] =
    [
      { value: "all", label: "Wszystkie", count: payables.length },
      {
        value: "approved",
        label: COST_APPROVAL_LABELS.APPROVED,
        count: approvedCount,
      },
      { value: "none", label: COST_APPROVAL_LABELS.NONE, count: noneCount },
    ];

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KpiCard label="Suma do zapłaty" value={formatMoney(totalAllGr)} sub="brutto" />
          <KpiCard
            label="Po terminie"
            value={formatMoney(overdueGr)}
            sub={`${overdueRows.length} ${pluralPl(overdueRows.length, "pozycja", "pozycje", "pozycji")}`}
            tone={overdueGr > 0 ? "negative" : "default"}
          />
          <KpiCard
            label={`Zatwierdzone (${COST_APPROVAL_LABELS.APPROVED})`}
            value={formatMoney(approvedGr)}
            sub={`${approvedCount} ${pluralPl(approvedCount, "pozycja", "pozycje", "pozycji")}`}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border p-0.5">
            {filterButtons.map((f) => (
              <Button
                key={f.value}
                variant={approvalFilter === f.value ? "secondary" : "ghost"}
                size="sm"
                className="h-7"
                onClick={() => setApprovalFilter(f.value)}
              >
                {f.label}
                <span className="text-muted-foreground tabular-nums">
                  {f.count}
                </span>
              </Button>
            ))}
          </div>
          <Input
            placeholder="Szukaj po dostawcy, nr dokumentu, kategorii…"
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
            {selectedUnapprovedCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending || exporting}
                onClick={() =>
                  approve(
                    selectedRows
                      .filter((p) => !p.approvedForPayment)
                      .map((p) => p.id)
                  )
                }
              >
                <Check className="size-4" />
                {`Oznacz: można płacić (${selectedUnapprovedCount})`}
              </Button>
            )}
            {selectedUnapprovedCount < selectedRows.length && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending || exporting}
                onClick={() =>
                  unapprove(
                    selectedRows
                      .filter((p) => p.approvedForPayment)
                      .map((p) => p.id)
                  )
                }
              >
                <Undo2 className="size-4" />
                {`Cofnij akceptację (${selectedRows.length - selectedUnapprovedCount})`}
              </Button>
            )}
            <Button
              size="sm"
              disabled={pending || exporting}
              onClick={() => markPaid([...selected])}
            >
              <Check className="size-4" />
              {pending ? "Zapisywanie…" : `Oznacz zapłacone (${selected.size})`}
            </Button>
            {canExport ? (
              <Button
                size="sm"
                variant="outline"
                disabled={pending || exporting}
                onClick={exportElixir}
              >
                <Download className="size-4" />
                {exporting
                  ? "Generowanie…"
                  : `Eksport przelewów Elixir (${selected.size})`}
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* span, bo disabled Button nie emituje zdarzeń hover dla tooltipa */}
                  <span tabIndex={0}>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled
                      className="pointer-events-none"
                    >
                      <Download className="size-4" />
                      {`Eksport przelewów Elixir (${selected.size})`}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>{exportBlockReason}</TooltipContent>
              </Tooltip>
            )}
            {exportBlockReason && (
              <span className="text-xs text-muted-foreground">
                {exportBlockReason}
              </span>
            )}
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
          initialSorting={[{ id: "dueDate", desc: false }]}
          onRowClick={(row) => setDetailId(row.id)}
          rowClassName={(row) =>
            // Priorytet: po terminie (czerwony) > gotowe do przelewu (zielony)
            row.overdueDays !== null && row.overdueDays > 0
              ? "bg-red-500/5 hover:bg-red-500/10"
              : row.approvedForPayment
                ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                : undefined
          }
          footer={
            <>
              <TableCell colSpan={6}>
                Suma ({filtered.length}{" "}
                {pluralPl(filtered.length, "pozycja", "pozycje", "pozycji")})
              </TableCell>
              <TableCell className="text-right font-medium tabular-nums">
                {formatMoney(totalGr)}
              </TableCell>
              <TableCell />
            </>
          }
          emptyState={
            <EmptyState
              title="Brak kosztów do zapłaty"
              description="Wszystkie koszty są opłacone. Nowe koszty dodasz w module Finanse → Koszty."
            />
          }
        />
      </div>

      <DetailSheet
        open={detailRow !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
        title={detailRow?.supplierName ?? "Szczegóły kosztu"}
        description={detailRow ? `Dokument ${detailRow.docNumber}` : undefined}
        footer={
          detailRow && (
            <div className="flex flex-wrap justify-end gap-2">
              {detailRow.approvedForPayment ? (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => unapprove([detailRow.id])}
                >
                  <Undo2 className="size-4" /> Cofnij akceptację
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => approve([detailRow.id])}
                >
                  <Check className="size-4" /> Można płacić
                </Button>
              )}
              <Button
                size="sm"
                disabled={pending}
                onClick={() => {
                  markPaid([detailRow.id]);
                  setDetailId(null);
                }}
              >
                <Check className="size-4" /> Oznacz zapłacone
              </Button>
            </div>
          )
        }
      >
        {detailRow && (
          <div className="space-y-4">
            <div>
              <StatusBadge tone={costTone(false, detailRow.approvedForPayment)}>
                {detailRow.approvedForPayment
                  ? COST_APPROVAL_LABELS.APPROVED
                  : COST_APPROVAL_LABELS.NONE}
              </StatusBadge>
            </div>
            <div>
              <DetailRow label="Dostawca">{detailRow.supplierName}</DetailRow>
              <DetailRow label="Nr dokumentu">{detailRow.docNumber}</DetailRow>
              <DetailRow label="Kategoria">{detailRow.categoryName}</DetailRow>
              <DetailRow label="Data dokumentu">
                {formatDate(new Date(detailRow.docDate))}
              </DetailRow>
              <DetailRow label="Termin płatności">
                <span className={termClass(detailRow.overdueDays)}>
                  {detailRow.dueDate
                    ? formatDate(new Date(detailRow.dueDate))
                    : "—"}
                </span>
              </DetailRow>
              <DetailRow label="Do terminu">
                <span className={termClass(detailRow.overdueDays)}>
                  {termLabel(detailRow.overdueDays)}
                </span>
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
            <div>
              <DetailRow label="Nr rachunku">
                {detailRow.account ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      !detailRow.accountValid &&
                        "text-amber-600 dark:text-amber-500"
                    )}
                  >
                    {!detailRow.accountValid && (
                      <TriangleAlert className="size-4" />
                    )}
                    {formatNrb(detailRow.account)}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
                    <TriangleAlert className="size-4" /> brak
                  </span>
                )}
              </DetailRow>
            </div>
            {detailRow.note && (
              <div>
                <div className="mb-1 text-sm text-muted-foreground">Notatka</div>
                <p className="text-sm whitespace-pre-wrap">{detailRow.note}</p>
              </div>
            )}
          </div>
        )}
      </DetailSheet>
    </TooltipProvider>
  );
}
