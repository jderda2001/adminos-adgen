"use client";

// Rejestr przychodów pogrupowany PO KLIENCIE: jeden wiersz = klient + pomarańczowe
// kółko z liczbą pozycji. Klik → sidebar z listą pozycji (kafelki) + „dodaj kolejną
// pozycję" + suma. Klik w pozycję → jej pełne szczegóły (z akcjami). Dzięki temu
// klient z kilkoma usługami (np. leady + obdzwanianie w call center) jest jednym
// wpisem, a pozycje rozróżnialne w środku.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowLeft,
  BadgeCheck,
  ChevronRight,
  CircleDot,
  Coins,
  CopyPlus,
  Download,
  Mail,
  MessageSquare,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Tag,
  Trash2,
  X,
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
import { Checkbox } from "@/components/ui/checkbox";
import { DatePicker } from "@/components/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TableCell } from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  VAT_RATES,
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
  uploadInvoiceAttachmentAction,
  removeInvoiceAttachmentAction,
  bulkDeleteInvoicesAction,
  bulkDuplicateInvoicesAction,
  bulkSetInvoiceStatusAction,
  bulkSetInvoiceTagsAction,
  bulkSetInvoiceAmountAction,
} from "./actions";
import { ReminderTimeline } from "./reminder-timeline";
import { sendReminderStepAction } from "./reminder-actions";
import { buildReminderTimeline, type ExistingReminder } from "@/lib/payment-reminders";

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
  // sekwencja przypomnień o płatności
  remindersEnabled: boolean;
  reminders: ExistingReminder[];
  clientHasEmail: boolean;
  clientHasPhone: boolean;
  attachmentName: string | null; // wgrany plik faktury (do maila)
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

interface ReminderTarget {
  invoiceId: string;
  stepKey: string;
}
interface ClientGroup {
  clientId: string;
  clientName: string;
  positions: InvoiceRow[];
  netGr: number;
  grossGr: number;
  status: string; // najpilniejszy status w grupie (do plakietki wiersza)
  offerTags: string[]; // suma tagów wszystkich pozycji (bez duplikatów)
  // szybkie przypomnienia z listy: pozycje z aktualnym krokiem SMS/e-mail do wysłania
  smsTargets: ReminderTarget[];
  emailTargets: ReminderTarget[];
  clientHasPhone: boolean;
  clientHasEmail: boolean;
}

const REVENUE_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Bez FV",
  ISSUED: "Wysłana",
  PAID: "Opłacona",
  OVERDUE: "Przeterminowana",
  ESTYMACJA: "Estymacja",
};

// statusy oferowane w masowej zmianie statusu (bez OVERDUE — wyliczany automatycznie)
const BULK_STATUSES = [
  "ISSUED",
  "PAID",
  "DRAFT",
  "WAITING",
  "NOT_ISSUED",
  "NO_INVOICE",
] as const;

// wspólny styl przycisku w ciemnej belce akcji masowych
const BULK_BAR_BTN =
  "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium text-neutral-100 transition-colors hover:bg-white/10 disabled:opacity-40";

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

/** Mały donut udziału w przychodach (arc = pct, tor = jasny). */
function ShareDonut({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct));
  return (
    <svg viewBox="0 0 36 36" className="size-5 shrink-0 text-muted-foreground/25" aria-hidden="true">
      <circle cx="18" cy="18" r="15.915" fill="none" stroke="currentColor" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="15.915"
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${p} ${100 - p}`}
        strokeDashoffset="25"
        style={{ stroke: "var(--primary)" }}
      />
    </svg>
  );
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

/** Załącznik faktury (skan) — wgraj / podejrzyj / usuń. Dołączany do maili. */
function InvoiceAttachment({
  invoiceId,
  attachmentName,
}: {
  invoiceId: string;
  attachmentName: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = (file: File) => {
    const fd = new FormData();
    fd.append("attachment", file);
    startTransition(async () => {
      const r = await uploadInvoiceAttachmentAction(invoiceId, fd);
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  };

  return (
    <div className="mt-4 border-t pt-4">
      <div className="mb-2 flex items-center gap-2">
        <Paperclip className="size-4 text-muted-foreground" />
        <h4 className="text-sm font-semibold">Faktura (plik)</h4>
      </div>
      {attachmentName ? (
        <div className="flex flex-wrap items-center gap-2">
          <a
            href={`/api/zalaczniki-przychod/${invoiceId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-w-0 items-center gap-1.5 rounded-lg border bg-muted/40 px-3 py-1.5 text-sm hover:bg-accent"
          >
            <Download className="size-4 shrink-0" />
            <span className="truncate">{attachmentName}</span>
          </a>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
            Zmień
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const r = await removeInvoiceAttachmentAction(invoiceId);
                if (r.ok) toast.success(r.message);
                else toast.error(r.error);
              })
            }
          >
            Usuń
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => inputRef.current?.click()}>
          <Paperclip className="size-4" /> Wgraj fakturę (PDF/JPG/PNG)
        </Button>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Plik dołączymy do maili przypominających o płatności. Maks. 10 MB.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

export function InvoicesTable({
  invoices,
  clients,
  kpis,
  leadVerticals,
  todayIso,
  estimatedMonth = false,
}: {
  invoices: InvoiceRow[];
  clients: ClientOption[];
  kpis: RevenueKpis;
  leadVerticals: string[];
  todayIso: string;
  estimatedMonth?: boolean;
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

  // ── Zaznaczanie pozycji (akcje masowe, styl ClickUp) ──────────────
  // Trzymamy ID realnych pozycji (nie „Estymacji"). Checkbox na wierszu
  // klienta zaznacza wszystkie jego pozycje. Belka akcji na dole pojawia
  // się, gdy coś jest zaznaczone.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkTagsOpen, setBulkTagsOpen] = useState(false);
  const [bulkTags, setBulkTags] = useState("");
  const [bulkAmountOpen, setBulkAmountOpen] = useState(false);
  const [bulkNet, setBulkNet] = useState("");
  const [bulkVat, setBulkVat] = useState<string>("23");

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
          smsTargets: [],
          emailTargets: [],
          clientHasPhone: inv.clientHasPhone,
          clientHasEmail: inv.clientHasEmail,
        };
        map.set(inv.clientId, g);
      }
      g.positions.push(inv);
      g.netGr += inv.netGr;
      g.grossGr += inv.grossGr;
    }
    const result = [...map.values()];
    const today = new Date(todayIso);
    for (const g of result) {
      g.status = groupStatus(g.positions);
      const seen = new Set<string>();
      for (const p of g.positions)
        for (const t of parseTags(p.offerTags))
          if (!seen.has(t)) seen.add(t);
      g.offerTags = [...seen];
      // aktualny krok przypomnień per pozycja (tylko Wystawiona/Przeterminowana)
      for (const p of g.positions) {
        if (p.status !== "ISSUED" && p.status !== "OVERDUE") continue;
        const cur = buildReminderTimeline(new Date(p.dueDate), today, p.reminders, {
          paid: false,
          enabled: p.remindersEnabled,
        }).steps.find((s) => s.isCurrent);
        if (!cur) continue;
        for (const ch of cur.channels) {
          if (!ch.actionable) continue;
          if (ch.channel === "SMS") g.smsTargets.push({ invoiceId: p.id, stepKey: cur.key });
          else if (ch.channel === "EMAIL") g.emailTargets.push({ invoiceId: p.id, stepKey: cur.key });
        }
      }
    }
    return result;
  }, [invoices, todayIso]);

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

  // ── Zaznaczanie: pomocnicze ───────────────────────────────────────
  // realne (niesyntetyczne) ID pozycji per klient + globalnie
  const idsByGroup = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of groups) {
      m.set(
        g.clientId,
        g.positions.filter((p) => p.status !== "ESTYMACJA").map((p) => p.id)
      );
    }
    return m;
  }, [groups]);
  const allSelectableIds = useMemo(
    () => invoices.filter((i) => i.status !== "ESTYMACJA").map((i) => i.id),
    [invoices]
  );

  // po zmianie danych (nawigacja/rewalidacja) usuń z zaznaczenia nieistniejące ID
  useEffect(() => {
    const valid = new Set(allSelectableIds);
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [allSelectableIds]);

  const selectedCount = selectedIds.size;
  const headerChecked: boolean | "indeterminate" =
    allSelectableIds.length > 0 && selectedCount === allSelectableIds.length
      ? true
      : selectedCount > 0
        ? "indeterminate"
        : false;

  function groupChecked(g: ClientGroup): boolean {
    const ids = idsByGroup.get(g.clientId) ?? [];
    return ids.length > 0 && ids.every((id) => selectedIds.has(id));
  }
  function toggleGroup(g: ClientGroup, checked: boolean) {
    const ids = idsByGroup.get(g.clientId) ?? [];
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) checked ? next.add(id) : next.delete(id);
      return next;
    });
  }
  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? new Set(allSelectableIds) : new Set());
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  // wykonaj akcję masową i po sukcesie wyczyść zaznaczenie
  function runBulk(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) {
        toast.success(r.message);
        clearSelection();
      } else {
        toast.error(r.error);
      }
    });
  }

  const selectedIdList = () => [...selectedIds];

  // szybka wysyłka z listy: aktualny krok przypomnień dla wskazanych pozycji
  function sendReminders(targets: ReminderTarget[], channel: "SMS" | "EMAIL") {
    if (targets.length === 0) return;
    startTransition(async () => {
      let okN = 0;
      let lastErr = "";
      for (const t of targets) {
        const r = await sendReminderStepAction({
          invoiceId: t.invoiceId,
          stepKey: t.stepKey,
          channel,
        });
        if (r.ok) okN += 1;
        else lastErr = r.error;
      }
      const label = channel === "SMS" ? "SMS" : "e-mail";
      if (okN === targets.length) toast.success(`Przypomnienie wysłane (${okN} × ${label})`);
      else toast.error(lastErr || `Wysłano ${okN}/${targets.length}`);
    });
  }

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
        id: "select",
        enableSorting: false,
        header: () => (
          <Checkbox
            aria-label="Zaznacz wszystkie"
            checked={headerChecked}
            onCheckedChange={(c) => toggleAll(c === true)}
          />
        ),
        cell: ({ row }) => {
          const g = row.original;
          const ids = idsByGroup.get(g.clientId) ?? [];
          if (ids.length === 0) return null; // „Estymacja" — nie do zaznaczenia
          const checked = groupChecked(g);
          return (
            <div
              className="flex items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <Checkbox
                aria-label={`Zaznacz: ${g.clientName}`}
                checked={checked}
                onCheckedChange={(c) => toggleGroup(g, c === true)}
                className={cn(
                  "transition-opacity",
                  checked
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                )}
              />
            </div>
          );
        },
      },
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
        id: "revenueShare",
        header: () => <div className="text-right">% przychodów</div>,
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => {
          const pct = totals.netGr > 0 ? (row.original.netGr / totals.netGr) * 100 : 0;
          return (
            <div className="flex items-center justify-end gap-2">
              <span className="font-medium tabular-nums">
                {pct.toFixed(1).replace(".", ",")}%
              </span>
              <ShareDonut pct={pct} />
            </div>
          );
        },
      },
      {
        id: "remind",
        header: () => <div className="text-right">Przypomnij</div>,
        enableSorting: false,
        meta: { align: "right" },
        cell: ({ row }) => {
          const g = row.original;
          if (g.smsTargets.length === 0 && g.emailTargets.length === 0) {
            return <div className="text-right text-muted-foreground/40">—</div>;
          }
          return (
            <div
              className="flex justify-end gap-1"
              onClick={(e) => e.stopPropagation()}
            >
              {g.smsTargets.length > 0 && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={pending || !g.clientHasPhone}
                  title={
                    g.clientHasPhone
                      ? `Wyślij SMS (${g.smsTargets.length})`
                      : "Brak numeru telefonu klienta"
                  }
                  onClick={() => sendReminders(g.smsTargets, "SMS")}
                >
                  <MessageSquare className="size-4" />
                </Button>
              )}
              {g.emailTargets.length > 0 && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={pending || !g.clientHasEmail}
                  title={
                    g.clientHasEmail
                      ? `Wyślij e-mail (${g.emailTargets.length})`
                      : "Brak adresu e-mail klienta"
                  }
                  onClick={() => sendReminders(g.emailTargets, "EMAIL")}
                >
                  <Mail className="size-4" />
                </Button>
              )}
            </div>
          );
        },
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totals.netGr, pending, selectedIds, idsByGroup, headerChecked]
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

      {estimatedMonth && (
        <div className="rounded-xl border border-dashed border-border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          Miesiąc przyszły — pozycje <span className="font-medium text-foreground">„Estymacja"</span>{" "}
          to kopie z ostatniego zafakturowanego miesiąca dla umów w toku. Znikają, gdy dodasz realny
          przychód; zatrzymują się po złożeniu wypowiedzenia (Klienci).
        </div>
      )}

      <DataTable
        columns={columns}
        data={groups}
        initialSorting={[{ id: "grossGr", desc: true }]}
        onRowClick={(g) => {
          setOpenClientId(g.clientId);
          setOpenPositionId(null);
        }}
        rowClassName={(g) =>
          cn("group cursor-pointer", groupChecked(g) && "bg-primary/5")
        }
        footer={
          <>
            <TableCell />
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
            <TableCell />
            <TableCell className="text-right font-medium tabular-nums">100%</TableCell>
            <TableCell />
            <TableCell />
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

      {/* ── Belka akcji masowych (pojawia się przy zaznaczeniu) ── */}
      {selectedCount > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
          <div className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-1 overflow-x-auto rounded-2xl border border-white/10 bg-neutral-900 p-1.5 text-neutral-100 shadow-2xl dark:bg-neutral-800">
            <span className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-1.5 text-sm font-medium">
              {selectedCount} {pluralPl(selectedCount, "pozycja", "pozycje", "pozycji")}
              <button
                type="button"
                onClick={clearSelection}
                className="grid size-4 place-items-center rounded text-neutral-400 transition-colors hover:text-white"
                aria-label="Wyczyść zaznaczenie"
              >
                <X className="size-4" />
              </button>
            </span>
            <div className="mx-1 h-6 w-px bg-white/15" />

            {/* Status */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={pending} className={BULK_BAR_BTN}>
                  <CircleDot className="size-4" /> Status
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center">
                <DropdownMenuLabel>Ustaw status</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {BULK_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s}
                    onClick={() =>
                      runBulk(() => bulkSetInvoiceStatusAction(selectedIdList(), s))
                    }
                  >
                    <StatusBadge tone={invoiceTone(s)}>{statusLabel(s)}</StatusBadge>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Tagi */}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setBulkTags("");
                setBulkTagsOpen(true);
              }}
              className={BULK_BAR_BTN}
            >
              <Tag className="size-4" /> Tagi
            </button>

            {/* Kwota */}
            <button
              type="button"
              disabled={pending}
              onClick={() => {
                setBulkNet("");
                setBulkVat("23");
                setBulkAmountOpen(true);
              }}
              className={BULK_BAR_BTN}
            >
              <Coins className="size-4" /> Kwota
            </button>

            {/* Duplikuj na kolejne miesiące */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" disabled={pending} className={BULK_BAR_BTN}>
                  <CopyPlus className="size-4" /> Duplikuj
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center">
                <DropdownMenuLabel>Skopiuj na przyszłość</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() =>
                    runBulk(() => bulkDuplicateInvoicesAction(selectedIdList(), 1))
                  }
                >
                  Następny miesiąc
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    runBulk(() => bulkDuplicateInvoicesAction(selectedIdList(), 3))
                  }
                >
                  Kolejne 3 miesiące
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    runBulk(() => bulkDuplicateInvoicesAction(selectedIdList(), 6))
                  }
                >
                  Kolejne 6 miesięcy
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="mx-1 h-6 w-px bg-white/15" />

            {/* Usuń */}
            <button
              type="button"
              disabled={pending}
              onClick={() => setBulkDeleteOpen(true)}
              className={cn(
                BULK_BAR_BTN,
                "text-red-300 hover:bg-red-500/20 hover:text-red-200"
              )}
            >
              <Trash2 className="size-4" /> Usuń
            </button>
          </div>
        </div>
      )}

      {/* Masowe: potwierdzenie usunięcia */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć zaznaczone pozycje?</AlertDialogTitle>
            <AlertDialogDescription>
              Usuniesz {selectedCount}{" "}
              {pluralPl(selectedCount, "pozycję", "pozycje", "pozycji")} przychodu.
              Tej operacji nie można cofnąć.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                runBulk(() => bulkDeleteInvoicesAction(selectedIdList()));
                setBulkDeleteOpen(false);
              }}
            >
              Usuń
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Masowe: tagi oferty */}
      <Dialog open={bulkTagsOpen} onOpenChange={setBulkTagsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ustaw tagi oferty</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="bulk-tags">Tagi (po przecinku)</Label>
            <Input
              id="bulk-tags"
              value={bulkTags}
              onChange={(e) => setBulkTags(e.target.value)}
              placeholder="np. Leady, Call center"
            />
            <p className="text-xs text-muted-foreground">
              Zastąpi tagi w {selectedCount}{" "}
              {pluralPl(selectedCount, "zaznaczonej pozycji", "zaznaczonych pozycjach", "zaznaczonych pozycjach")}.
              Puste pole = wyczyść tagi.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkTagsOpen(false)}>
              Anuluj
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                runBulk(() => bulkSetInvoiceTagsAction(selectedIdList(), bulkTags));
                setBulkTagsOpen(false);
              }}
            >
              Zapisz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Masowe: kwota netto */}
      <Dialog open={bulkAmountOpen} onOpenChange={setBulkAmountOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ustaw kwotę netto</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-net">Kwota netto (zł)</Label>
              <Input
                id="bulk-net"
                value={bulkNet}
                onChange={(e) => setBulkNet(e.target.value)}
                placeholder="12 000,00"
                inputMode="decimal"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-vat">Stawka VAT</Label>
              <Select value={bulkVat} onValueChange={setBulkVat}>
                <SelectTrigger id="bulk-vat">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VAT_RATES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {VAT_RATE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Ustawi tę samą kwotę netto (VAT/brutto policzone) w {selectedCount}{" "}
            {pluralPl(selectedCount, "zaznaczonej pozycji", "zaznaczonych pozycjach", "zaznaczonych pozycjach")}.
            Rozbicie paczek leadów zostanie usunięte.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkAmountOpen(false)}>
              Anuluj
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                runBulk(() =>
                  bulkSetInvoiceAmountAction(selectedIdList(), bulkNet, bulkVat)
                );
                setBulkAmountOpen(false);
              }}
            >
              Zapisz
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
          openPosition && openPosition.status === "ESTYMACJA" ? (
            <InvoiceFormDialog
              clients={clients}
              leadVerticals={leadVerticals}
              defaultClientId={openPosition.clientId}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Dodaj realny przychód
                </Button>
              }
            />
          ) : (
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
            <DetailRow label="Data wysłania">
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
            <InvoiceAttachment
              invoiceId={openPosition.id}
              attachmentName={openPosition.attachmentName}
            />
            {["ISSUED", "OVERDUE", "PAID"].includes(openPosition.status) && (
              <ReminderTimeline
                invoiceId={openPosition.id}
                dueDateIso={openPosition.dueDate}
                grossGr={openPosition.grossGr}
                status={openPosition.status}
                remindersEnabled={openPosition.remindersEnabled}
                reminders={openPosition.reminders}
                todayIso={todayIso}
                clientHasEmail={openPosition.clientHasEmail}
                clientHasPhone={openPosition.clientHasPhone}
              />
            )}
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
