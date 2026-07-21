"use client";

// Rejestr przychodów pogrupowany PO KLIENCIE: jeden wiersz = klient + pomarańczowe
// kółko z liczbą pozycji. Klik → sidebar z listą pozycji (kafelki) + „dodaj kolejną
// pozycję" + suma. Klik w pozycję → jej pełne szczegóły (z akcjami). Dzięki temu
// klient z kilkoma usługami (np. leady + obdzwanianie w call center) jest jednym
// wpisem, a pozycje rozróżnialne w środku.

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  Download,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DataTable, SortableHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { KpiCard } from "@/components/kpi-card";
import { StatusBadge, invoiceTone } from "@/components/status-badge";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/date-picker";
import { Label } from "@/components/ui/label";
import { TableCell } from "@/components/ui/table";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INVOICE_STATUSES,
  INVOICE_STATUS_LABELS,
  VAT_RATE_LABELS,
  isVatRate,
  type InvoiceStatus,
} from "@/lib/types";
import {
  dateToInput,
  formatDate,
  formatMoney,
  pluralPl,
  todayUTC,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";
import { InvoiceFormDialog } from "./invoice-form";
import {
  deleteInvoiceAction,
  markInvoiceIssuedAction,
  markInvoicePaidAction,
  undoInvoicePaymentAction,
} from "./actions";

export interface InvoiceRow {
  id: string;
  number: string;
  label: string | null;
  clientId: string;
  clientName: string;
  issueDate: string; // ISO — serializowane z serwera
  saleDate: string;
  dueDate: string;
  paidDate: string | null;
  status: string;
  netGr: number;
  vatGr: number;
  grossGr: number;
  vatRate: string;
  offerTags: string | null;
  notes: string | null;
  leadsQty: number | null;
  leadUnitPriceGr: number | null;
  leadActivationFeeGr: number | null;
  leadGuaranteePct: number | null;
}

export interface ClientOption {
  id: string;
  name: string;
}

export interface RevenueKpis {
  netGr: number;
  grossGr: number;
  issuedNetGr: number; // wysłane + przeterminowane (wystawione, niezapłacone)
  paidNetGr: number; // opłacone
  count: number;
}

interface ClientGroup {
  clientId: string;
  clientName: string;
  positions: InvoiceRow[];
  netGr: number;
  grossGr: number;
  status: string; // najpilniejszy status w grupie (do plakietki wiersza)
  offerTags: string[]; // suma tagów wszystkich pozycji (bez duplikatów)
}

const REVENUE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Bez FV",
  ISSUED: "Wysłana",
  PAID: "Opłacona",
  OVERDUE: "Przeterminowana",
};

function statusLabel(status: string): string {
  return (
    REVENUE_STATUS_LABELS[status] ??
    INVOICE_STATUS_LABELS[status as InvoiceStatus] ??
    status
  );
}

// Plakietka grupy = najpilniejszy status wśród pozycji. Kolejność od
// najpilniejszego do „domkniętego"; „Opłacona" wygrywa TYLKO gdy wszystkie
// pozycje są opłacone (inaczej same np. „Czekamy" fałszywie pokazałyby PAID).
const GROUP_STATUS_PRIORITY = [
  "OVERDUE", // przeterminowana — pieniądze po terminie
  "ISSUED", // wystawiona — czeka na zapłatę
  "WAITING", // czekamy — po naszej stronie
  "NOT_ISSUED", // do wystawienia
  "DRAFT", // bez FV / szkic
  "NO_INVOICE", // bez faktury
  "PAID", // opłacona — domknięte
] as const;

function groupStatus(positions: InvoiceRow[]): string {
  for (const s of GROUP_STATUS_PRIORITY) {
    if (positions.some((p) => p.status === s)) return s;
  }
  return positions[0]?.status ?? "PAID"; // status spoza listy → pokaż jak jest
}

function waitedDays(row: InvoiceRow): number | null {
  if (row.status !== "PAID" || !row.paidDate) return null;
  const from = new Date(row.issueDate).getTime();
  const to = new Date(row.paidDate).getTime();
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

function waitedLabel(row: InvoiceRow): string {
  const days = waitedDays(row);
  if (days === null) return "—";
  return `${days} ${pluralPl(days, "dzień", "dni", "dni")}`;
}

function parseTags(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function OfferTags({ raw }: { raw: string | null }) {
  const tags = parseTags(raw);
  if (tags.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((t) => (
        <StatusBadge key={t} tone="indigo">
          {t}
        </StatusBadge>
      ))}
    </div>
  );
}

export function InvoicesTable({
  invoices,
  clients,
  kpis,
  leadVerticals,
}: {
  invoices: InvoiceRow[];
  clients: ClientOption[];
  kpis: RevenueKpis;
  leadVerticals: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNavTransition] = useTransition();
  const [pending, startTransition] = useTransition();

  // sidebar: poziom 1 = lista pozycji klienta, poziom 2 = szczegóły pozycji.
  // Trzymamy ID (nie snapshot) i wyliczamy z żywych danych — po edycji/dodaniu
  // sidebar odświeża się sam.
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [openPositionId, setOpenPositionId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<InvoiceRow | null>(null);
  const [toMarkPaid, setToMarkPaid] = useState<InvoiceRow | null>(null);
  const [paidDate, setPaidDate] = useState("");

  const clientFilter = searchParams.get("klient") ?? "all";
  const statusFilter = searchParams.get("status") ?? "all";
  const queryString = searchParams.toString();
  const exportHref = `/api/eksport/przychody${queryString ? `?${queryString}` : ""}`;

  function setUrlParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    startNavTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  // grupowanie po kliencie (zachowuje kolejność wejścia = malejąco po dacie z serwera)
  const groups = useMemo(() => {
    const map = new Map<string, ClientGroup>();
    for (const inv of invoices) {
      let g = map.get(inv.clientId);
      if (!g) {
        g = {
          clientId: inv.clientId,
          clientName: inv.clientName,
          positions: [],
          netGr: 0,
          grossGr: 0,
          status: "PAID",
          offerTags: [],
        };
        map.set(inv.clientId, g);
      }
      g.positions.push(inv);
      g.netGr += inv.netGr;
      g.grossGr += inv.grossGr;
    }
    const result = [...map.values()];
    for (const g of result) {
      g.status = groupStatus(g.positions);
      const seen = new Set<string>();
      for (const p of g.positions)
        for (const t of parseTags(p.offerTags))
          if (!seen.has(t)) seen.add(t);
      g.offerTags = [...seen];
    }
    return result;
  }, [invoices]);

  const openClient = groups.find((g) => g.clientId === openClientId) ?? null;
  const openPosition =
    openClient?.positions.find((p) => p.id === openPositionId) ?? null;

  const totals = useMemo(
    () =>
      invoices.reduce(
        (acc, i) => ({
          netGr: acc.netGr + i.netGr,
          grossGr: acc.grossGr + i.grossGr,
        }),
        { netGr: 0, grossGr: 0 }
      ),
    [invoices]
  );

  function runAction(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    const id = toDelete.id;
    startTransition(async () => {
      const result = await deleteInvoiceAction(id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setToDelete(null);
      setOpenPositionId(null); // wróć do listy pozycji (sidebar zamknie się, jeśli to była ostatnia)
    });
  }

  function confirmMarkPaid() {
    if (!toMarkPaid) return;
    const id = toMarkPaid.id;
    startTransition(async () => {
      const result = await markInvoicePaidAction(id, paidDate);
      if (result.ok) {
        toast.success(result.message);
        setToMarkPaid(null);
        setOpenPositionId(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  function openMarkPaid(invoice: InvoiceRow) {
    setPaidDate(dateToInput(todayUTC()));
    setToMarkPaid(invoice);
  }

  const columns: ColumnDef<ClientGroup>[] = useMemo(
    () => [
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge tone={invoiceTone(row.original.status)}>
            {statusLabel(row.original.status)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "clientName",
        header: ({ column }) => (
          <SortableHeader column={column}>Klient</SortableHeader>
        ),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="font-medium">{row.original.clientName}</span>
            <span
              className="grid size-5 shrink-0 place-items-center rounded-full bg-orange-100 text-[11px] font-semibold text-orange-700 dark:bg-orange-950 dark:text-orange-300"
              title={`${row.original.positions.length} ${pluralPl(row.original.positions.length, "pozycja", "pozycje", "pozycji")}`}
            >
              {row.original.positions.length}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "netGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Netto
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) => formatMoney(row.original.netGr),
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
        id: "offerTags",
        header: "Oferta",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.offerTags.length === 0 ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <div className="flex flex-wrap gap-1">
              {row.original.offerTags.map((t) => (
                <StatusBadge key={t} tone="indigo">
                  {t}
                </StatusBadge>
              ))}
            </div>
          ),
      },
      {
        id: "chevron",
        header: "",
        enableSorting: false,
        cell: () => (
          <div className="flex justify-end text-muted-foreground/50">
            <ChevronRight className="size-4" />
          </div>
        ),
      },
    ],
    []
  );

  const newInvoiceTrigger = (
    <Button size="sm">
      <Plus className="size-4" /> Nowy przychód
    </Button>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Przychody"
        description="Rejestr przychodów adGen — po dacie przychodu liczony jest miesiąc."
      >
        <Button variant="outline" size="sm" asChild>
          <a href={exportHref} download>
            <Download className="size-4" /> Eksport CSV
          </a>
        </Button>
        <InvoiceFormDialog clients={clients} leadVerticals={leadVerticals} trigger={newInvoiceTrigger} />
      </PageHeader>

      {/* ── KPI miesiąca ───────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Suma netto" value={formatMoney(kpis.netGr)} />
        <KpiCard label="Suma brutto" value={formatMoney(kpis.grossGr)} />
        <KpiCard
          label="Zafakturowane (niezapłacone)"
          value={formatMoney(kpis.issuedNetGr)}
          sub="netto — wysłane i przeterminowane"
          tone={kpis.issuedNetGr > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Zapłacone"
          value={formatMoney(kpis.paidNetGr)}
          sub="netto — opłacone pozycje"
          tone={kpis.paidNetGr > 0 ? "positive" : "default"}
        />
      </div>

      {/* ── Filtry ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <PeriodFilter />
        <Select
          value={clientFilter}
          onValueChange={(value) =>
            setUrlParam("klient", value === "all" ? null : value)
          }
        >
          <SelectTrigger className="w-52" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszyscy klienci</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={statusFilter}
          onValueChange={(value) =>
            setUrlParam("status", value === "all" ? null : value)
          }
        >
          <SelectTrigger className="w-44" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie statusy</SelectItem>
            {INVOICE_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {statusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={groups}
        initialSorting={[{ id: "grossGr", desc: true }]}
        onRowClick={(g) => {
          setOpenClientId(g.clientId);
          setOpenPositionId(null);
        }}
        rowClassName={() => "cursor-pointer"}
        footer={
          <>
            <TableCell colSpan={2} className="font-medium">
              Razem ({groups.length}{" "}
              {pluralPl(groups.length, "klient", "klienci", "klientów")} ·{" "}
              {invoices.length}{" "}
              {pluralPl(invoices.length, "pozycja", "pozycje", "pozycji")})
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(totals.netGr)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(totals.grossGr)}
            </TableCell>
            <TableCell colSpan={2} />
          </>
        }
        emptyState={
          <EmptyState
            title="Brak przychodów w wybranym okresie"
            description="Zmień filtr okresu, klienta lub statusu, albo dodaj pierwszą pozycję przyciskiem „Nowy przychód”. Miesiąc liczony jest po dacie przychodu."
          >
            <InvoiceFormDialog
              clients={clients}
              leadVerticals={leadVerticals}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Nowy przychód
                </Button>
              }
            />
          </EmptyState>
        }
      />

      {/* ── Sidebar: pozycje klienta → szczegóły pozycji ───────── */}
      <DetailSheet
        open={openClient !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOpenClientId(null);
            setOpenPositionId(null);
          }
        }}
        title={openClient?.clientName ?? "Klient"}
        description={
          openPosition
            ? openPosition.number
              ? `Nr faktury: ${openPosition.number}`
              : "Bez FV"
            : openClient
              ? `${openClient.positions.length} ${pluralPl(openClient.positions.length, "pozycja", "pozycje", "pozycji")}`
              : undefined
        }
        footer={
          openPosition && (
            <div className="flex flex-wrap items-center gap-2">
              <InvoiceFormDialog
                invoice={openPosition}
                clients={clients}
                leadVerticals={leadVerticals}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil className="size-4" /> Edytuj
                  </Button>
                }
              />
              {openPosition.status === "DRAFT" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => runAction(() => markInvoiceIssuedAction(openPosition.id))}
                >
                  <Send className="size-4" /> Oznacz wysłaną
                </Button>
              )}
              {openPosition.status !== "PAID" && (
                <Button variant="outline" size="sm" onClick={() => openMarkPaid(openPosition)}>
                  <BadgeCheck className="size-4" /> Oznacz opłaconą
                </Button>
              )}
              {openPosition.status === "PAID" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => runAction(() => undoInvoicePaymentAction(openPosition.id))}
                >
                  <RotateCcw className="size-4" /> Cofnij zapłatę
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => setToDelete(openPosition)}
              >
                <Trash2 className="size-4" /> Usuń
              </Button>
            </div>
          )
        }
      >
        {/* Poziom 1: lista pozycji klienta */}
        {openClient && !openPosition && (
          <div className="space-y-2">
            {openClient.positions.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenPositionId(p.id)}
                className="flex w-full items-center gap-3 rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {p.label || p.clientName}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={invoiceTone(p.status)}>
                      {statusLabel(p.status)}
                    </StatusBadge>
                    {parseTags(p.offerTags).map((t) => (
                      <StatusBadge key={t} tone="indigo">
                        {t}
                      </StatusBadge>
                    ))}
                  </div>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <div className="text-sm font-semibold">{formatMoney(p.grossGr)}</div>
                  <div className="text-xs text-muted-foreground">{formatMoney(p.netGr)} netto</div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
              </button>
            ))}

            {/* dodaj kolejną pozycję dla tego klienta */}
            <InvoiceFormDialog
              clients={clients}
              leadVerticals={leadVerticals}
              defaultClientId={openClient.clientId}
              trigger={
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/30 px-3.5 py-3 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <Plus className="size-4" /> Dodaj kolejną pozycję
                </button>
              }
            />

            {/* suma wszystkich pozycji klienta */}
            <div className="mt-1 flex items-baseline justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">
                Razem ({openClient.positions.length}{" "}
                {pluralPl(openClient.positions.length, "pozycja", "pozycje", "pozycji")})
              </span>
              <span className="text-right tabular-nums">
                <span className="text-base font-semibold">{formatMoney(openClient.grossGr)}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {formatMoney(openClient.netGr)} netto
                </span>
              </span>
            </div>
          </div>
        )}

        {/* Poziom 2: szczegóły pozycji */}
        {openPosition && (
          <div>
            <button
              type="button"
              onClick={() => setOpenPositionId(null)}
              className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="size-4" /> Pozycje klienta
              {openClient && ` (${openClient.positions.length})`}
            </button>
            <DetailRow label="Status">
              <StatusBadge tone={invoiceTone(openPosition.status)}>
                {statusLabel(openPosition.status)}
              </StatusBadge>
            </DetailRow>
            <DetailRow label="Opis pozycji">{openPosition.label || "—"}</DetailRow>
            <DetailRow label="Netto">{formatMoney(openPosition.netGr)}</DetailRow>
            <DetailRow label="VAT">
              {formatMoney(openPosition.vatGr)}
              {isVatRate(openPosition.vatRate)
                ? ` (${VAT_RATE_LABELS[openPosition.vatRate]})`
                : ""}
            </DetailRow>
            <DetailRow label="Brutto">{formatMoney(openPosition.grossGr)}</DetailRow>
            <DetailRow label="Data przychodu">
              {formatDate(new Date(openPosition.saleDate))}
            </DetailRow>
            <DetailRow label="Termin płatności">
              {formatDate(new Date(openPosition.dueDate))}
            </DetailRow>
            <DetailRow label="Data zapłaty">
              {openPosition.paidDate ? formatDate(new Date(openPosition.paidDate)) : "—"}
            </DetailRow>
            <DetailRow label="Ile czekaliśmy">{waitedLabel(openPosition)}</DetailRow>
            <DetailRow label="Oferta">
              <OfferTags raw={openPosition.offerTags} />
            </DetailRow>
            <DetailRow label="Uwagi">
              <span className="whitespace-pre-wrap text-left font-normal">
                {openPosition.notes || "—"}
              </span>
            </DetailRow>
          </div>
        )}
      </DetailSheet>

      {/* ── Dialog: oznacz jako opłaconą ───────────────────────── */}
      <Dialog
        open={toMarkPaid !== null}
        onOpenChange={(open) => !open && setToMarkPaid(null)}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Oznacz jako opłaconą</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {toMarkPaid?.clientName}
              {toMarkPaid?.label ? ` — ${toMarkPaid.label}` : ""},{" "}
              {toMarkPaid ? formatMoney(toMarkPaid.grossGr) : ""} brutto.
            </p>
            <div className="space-y-2">
              <Label htmlFor="paidDate">Data zapłaty *</Label>
              <DatePicker id="paidDate" value={paidDate} onChange={setPaidDate} />
              <p className="text-xs text-muted-foreground">
                Dzień, w którym przelew został zaksięgowany na naszym koncie.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToMarkPaid(null)}
            >
              Anuluj
            </Button>
            <Button onClick={confirmMarkPaid} disabled={pending}>
              {pending ? "Zapisywanie…" : "Oznacz jako opłaconą"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── AlertDialog: usuwanie ──────────────────────────────── */}
      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć pozycję?</AlertDialogTitle>
            <AlertDialogDescription>
              Przychód {toDelete?.clientName}
              {toDelete?.label ? ` — ${toDelete.label}` : ""}
              {toDelete?.number ? ` (${toDelete.number})` : ""} zostanie trwale
              usunięty. Tej operacji nie można cofnąć.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} disabled={pending}>
              {pending ? "Usuwanie…" : "Usuń"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
