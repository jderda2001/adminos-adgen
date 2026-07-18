"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  BadgeCheck,
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

// Etykiety statusów w słowniku arkusza adGen (rejestr przychodów):
// DRAFT=„Bez FV", ISSUED=„Wysłana", PAID=„Opłacona", OVERDUE=„Przeterminowana".
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

/** Dni od wystawienia do zapłaty (ile czekaliśmy na płatność) */
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

  const [detail, setDetail] = useState<InvoiceRow | null>(null);
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
      setDetail(null);
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
        setDetail(null);
      } else {
        toast.error(result.error);
      }
    });
  }

  function openMarkPaid(invoice: InvoiceRow) {
    setPaidDate(dateToInput(todayUTC()));
    setToMarkPaid(invoice);
  }

  const columns: ColumnDef<InvoiceRow>[] = useMemo(
    () => [
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
        accessorKey: "clientName",
        header: ({ column }) => (
          <SortableHeader column={column}>Klient</SortableHeader>
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="font-medium">{row.original.clientName}</div>
            {row.original.label && (
              <div className="truncate text-xs text-muted-foreground">
                {row.original.label}
              </div>
            )}
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
        accessorKey: "dueDate",
        header: ({ column }) => (
          <SortableHeader column={column}>Termin</SortableHeader>
        ),
        cell: ({ row }) => formatDate(new Date(row.original.dueDate)),
      },
      {
        accessorKey: "offerTags",
        header: "Oferta",
        enableSorting: false,
        cell: ({ row }) => <OfferTags raw={row.original.offerTags} />,
      },
      {
        id: "waited",
        header: "Ile czekaliśmy",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tabular-nums text-muted-foreground">
            {waitedLabel(row.original)}
          </span>
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
        data={invoices}
        initialSorting={[{ id: "dueDate", desc: true }]}
        onRowClick={(row) => setDetail(row)}
        footer={
          <>
            <TableCell colSpan={2} className="font-medium">
              Suma ({invoices.length}{" "}
              {pluralPl(invoices.length, "pozycja", "pozycje", "pozycji")})
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(totals.netGr)}
            </TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatMoney(totals.grossGr)}
            </TableCell>
            <TableCell colSpan={3} />
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

      {/* ── DetailSheet: szczegóły pozycji ─────────────────────── */}
      <DetailSheet
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.clientName ?? "Szczegóły przychodu"}
        description={detail?.number ? `Nr faktury: ${detail.number}` : "Bez FV"}
        footer={
          detail && (
            <div className="flex flex-wrap items-center gap-2">
              <InvoiceFormDialog
                invoice={detail}
                clients={clients}
                leadVerticals={leadVerticals}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil className="size-4" /> Edytuj
                  </Button>
                }
              />
              {detail.status === "DRAFT" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    runAction(() => markInvoiceIssuedAction(detail.id))
                  }
                >
                  <Send className="size-4" /> Oznacz wysłaną
                </Button>
              )}
              {detail.status !== "PAID" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openMarkPaid(detail)}
                >
                  <BadgeCheck className="size-4" /> Oznacz opłaconą
                </Button>
              )}
              {detail.status === "PAID" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    runAction(() => undoInvoicePaymentAction(detail.id))
                  }
                >
                  <RotateCcw className="size-4" /> Cofnij zapłatę
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => setToDelete(detail)}
              >
                <Trash2 className="size-4" /> Usuń
              </Button>
            </div>
          )
        }
      >
        {detail && (
          <div>
            <DetailRow label="Status">
              <StatusBadge tone={invoiceTone(detail.status)}>
                {statusLabel(detail.status)}
              </StatusBadge>
            </DetailRow>
            <DetailRow label="Klient">{detail.clientName}</DetailRow>
            <DetailRow label="Opis pozycji">
              {detail.label || "—"}
            </DetailRow>
            <DetailRow label="Netto">{formatMoney(detail.netGr)}</DetailRow>
            <DetailRow label="VAT">
              {formatMoney(detail.vatGr)}
              {isVatRate(detail.vatRate)
                ? ` (${VAT_RATE_LABELS[detail.vatRate]})`
                : ""}
            </DetailRow>
            <DetailRow label="Brutto">{formatMoney(detail.grossGr)}</DetailRow>
            <DetailRow label="Data przychodu">
              {formatDate(new Date(detail.saleDate))}
            </DetailRow>
            <DetailRow label="Termin płatności">
              {formatDate(new Date(detail.dueDate))}
            </DetailRow>
            <DetailRow label="Data zapłaty">
              {detail.paidDate ? formatDate(new Date(detail.paidDate)) : "—"}
            </DetailRow>
            <DetailRow label="Ile czekaliśmy">
              {waitedLabel(detail)}
            </DetailRow>
            <DetailRow label="Oferta">
              <OfferTags raw={detail.offerTags} />
            </DetailRow>
            <DetailRow label="Uwagi">
              <span className="whitespace-pre-wrap font-normal text-left">
                {detail.notes || "—"}
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
              <DatePicker
                id="paidDate"
                value={paidDate}
                onChange={setPaidDate}
              />
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
