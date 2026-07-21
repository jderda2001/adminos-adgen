"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import {
  ArrowRight,
  CircleX,
  Download,
  Info,
  Megaphone,
  MessageSquare,
  Paperclip,
  Pencil,
  Clock,
  Plus,
  Repeat,
  SlidersHorizontal,
  Trash2,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";
import { DataTable, SortableHeader } from "@/components/data-table";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { PeriodFilter } from "@/components/period-filter";
import { StatusBadge, costTone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  daysOverdue,
  formatAmount,
  formatDate,
  formatMoney,
  parseMoneyToGr,
  pluralPl,
  todayUTC,
} from "@/lib/format";
import { COST_APPROVAL_LABELS, VAT_RATE_LABELS, isVatRate } from "@/lib/types";
import type { ActionResult } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/date-picker";
import {
  deleteCostAction,
  togglePaidAction,
  toggleApprovalAction,
  toggleDelayedAction,
  rollCostToNextMonthAction,
  patchCostAction,
  addCostCommentAction,
  deleteCostCommentAction,
} from "./actions";
import { CostFormDialog, type SelectOption } from "./cost-form";
import { categoryBadgeClass, categoryPillClass } from "./category-color";
import { RecurringCostsDialog, type RecurringRow } from "./recurring-dialog";
import { CostImportDialog } from "./cost-import-dialog";

export interface CostRow {
  id: string;
  supplierName: string;
  supplierAccount: string | null;
  docNumber: string;
  docDate: string; // ISO
  dueDate: string | null; // ISO
  netGr: number;
  vatRate: string;
  vatGr: number;
  grossGr: number;
  categoryId: string;
  categoryName: string;
  clientId: string | null;
  clientName: string | null;
  paid: boolean;
  approvedForPayment: boolean;
  delayed: boolean;
  paidDate: string | null; // ISO
  comments: CostCommentItem[];
  attachmentName: string | null;
  recurringCostId: string | null;
  planned?: boolean; // zaplanowana przyszła kopia cykliczna (estymacja, jeszcze nie do zapłaty)
  autoAdBudget?: boolean; // wiersz-widmo „Budżet reklamowy" (auto, tylko-do-odczytu, fioletowy)
}

export interface CostCommentItem {
  id: string;
  authorId: string | null;
  authorName: string;
  body: string;
  createdAt: string; // ISO
}

/** Etykieta statusu płatności kosztu */
function costApprovalLabel(cost: CostRow): string {
  if (cost.paid) return COST_APPROVAL_LABELS.PAID;
  if (cost.delayed) return COST_APPROVAL_LABELS.DELAYED;
  if (cost.approvedForPayment) return COST_APPROVAL_LABELS.APPROVED;
  return COST_APPROVAL_LABELS.NONE;
}

/** Znacznik przypisania kosztu: klient albo „Koszt ogólny" */
function AssignmentBadge({ clientName }: { clientName: string | null }) {
  if (clientName) return <span>{clientName}</span>;
  return <StatusBadge tone="neutral">Koszt ogólny</StatusBadge>;
}

// ── Edycja inline z listy (bez rozwijania szczegółów) ────────────────
// Zapis pojedynczego pola przez patchCostAction; revalidatePath odświeża dane.

function useCostPatch() {
  const [pending, startTransition] = useTransition();
  const run = (id: string, patch: Parameters<typeof patchCostAction>[1]) =>
    startTransition(async () => {
      const res = await patchCostAction(id, patch);
      if (!res.ok) toast.error(res.error);
    });
  return { pending, run };
}

type CostStatus = "NONE" | "APPROVED" | "DELAYED" | "PAID";
function costStatus(c: CostRow): CostStatus {
  if (c.paid) return "PAID";
  if (c.delayed) return "DELAYED";
  if (c.approvedForPayment) return "APPROVED";
  return "NONE";
}
const STATUS_ORDER: CostStatus[] = ["NONE", "APPROVED", "DELAYED", "PAID"];
function statusTone(s: CostStatus) {
  return costTone(s === "PAID", s === "APPROVED", s === "DELAYED");
}

/** Status płatności — dropdown edytowalny wprost z wiersza */
function InlineStatus({ cost }: { cost: CostRow }) {
  const { pending, run } = useCostPatch();
  const status = costStatus(cost);
  // zaplanowana przyszła kopia cykliczna — estymacja, jeszcze nie do zapłaty.
  // h-7 + px-1 = ta sama wysokość i wcięcie co dropdown statusu (równy układ)
  if (cost.planned) {
    return (
      <div className="flex h-7 items-center px-1">
        <StatusBadge tone="indigo">Planowany</StatusBadge>
      </div>
    );
  }
  return (
    <Select
      value={status}
      disabled={pending}
      onValueChange={(v) => v !== status && run(cost.id, { status: v as CostStatus })}
    >
      <SelectTrigger
        size="sm"
        className="h-7 w-full border-transparent bg-transparent px-1 shadow-none hover:bg-muted/60 focus:border-ring"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {STATUS_ORDER.map((s) => (
          <SelectItem key={s} value={s}>
            <StatusBadge tone={statusTone(s)}>{COST_APPROVAL_LABELS[s]}</StatusBadge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Kategoria — kolorowy dropdown edytowalny wprost z wiersza */
function InlineCategory({
  cost,
  categories,
}: {
  cost: CostRow;
  categories: { id: string; name: string }[];
}) {
  const { pending, run } = useCostPatch();
  return (
    <Select
      value={cost.categoryId}
      disabled={pending}
      onValueChange={(v) => v !== cost.categoryId && run(cost.id, { categoryId: v })}
    >
      <SelectTrigger
        size="sm"
        className="h-7 w-full border-transparent bg-transparent px-1 shadow-none hover:bg-muted/60 focus:border-ring"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {categories.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            <span className={categoryPillClass(c.name)}>{c.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Tekst edytowalny po kliknięciu (dostawca) */
function InlineSupplier({ cost }: { cost: CostRow }) {
  const { pending, run } = useCostPatch();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(cost.supplierName);
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setVal(cost.supplierName);
          setEditing(true);
        }}
        className="block max-w-[18rem] truncate text-left font-medium hover:text-primary"
        title={cost.supplierName}
      >
        {cost.supplierName}
      </button>
    );
  }
  const save = () => {
    setEditing(false);
    const s = val.trim();
    if (s && s !== cost.supplierName) run(cost.id, { supplierName: s });
  };
  return (
    <Input
      autoFocus
      value={val}
      disabled={pending}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") setEditing(false);
      }}
      className="h-7"
    />
  );
}

/** Kwota netto edytowalna po kliknięciu (VAT/brutto przeliczane serwerowo) */
function InlineNet({ cost }: { cost: CostRow }) {
  const { pending, run } = useCostPatch();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setVal(formatAmount(cost.netGr));
          setEditing(true);
        }}
        className="tabular-nums hover:text-primary"
        title="Kliknij, aby edytować"
      >
        {formatMoney(cost.netGr)}
      </button>
    );
  }
  const save = () => {
    setEditing(false);
    const gr = parseMoneyToGr(val);
    if (gr !== null && gr !== cost.netGr) run(cost.id, { netGr: gr });
  };
  return (
    <Input
      autoFocus
      inputMode="decimal"
      value={val}
      disabled={pending}
      onChange={(e) => setVal(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          save();
        } else if (e.key === "Escape") setEditing(false);
      }}
      className="h-7 w-24 text-right tabular-nums"
    />
  );
}

/** Termin płatności — inline DatePicker */
function InlineDue({ cost }: { cost: CostRow }) {
  const { pending, run } = useCostPatch();
  const iso = cost.dueDate ? cost.dueDate.slice(0, 10) : "";
  const overdue =
    !!cost.dueDate && !cost.paid && daysOverdue(new Date(cost.dueDate), todayUTC()) > 0;
  return (
    <DatePicker
      value={iso}
      clearable
      disabled={pending}
      onChange={(v) => v !== iso && run(cost.id, { dueDate: v || null })}
      className={cn("w-36", overdue && "[&_button]:text-red-600 dark:[&_button]:text-red-400")}
    />
  );
}

/** Wątek komentarzy do kosztu — historia z autorem (kto i kiedy). */
function CostComments({
  cost,
  currentUserId,
  authDisabled,
}: {
  cost: CostRow;
  currentUserId: string;
  authDisabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const count = cost.comments.length;

  function add() {
    const text = draft.trim();
    if (!text) return;
    startTransition(async () => {
      const res = await addCostCommentAction(cost.id, text);
      if (res.ok) {
        toast.success(res.message);
        setDraft("");
      } else {
        toast.error(res.error);
      }
    });
  }
  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteCostCommentAction(id);
      if (!res.ok) toast.error(res.error);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          title={count > 0 ? `Komentarze (${count})` : "Dodaj komentarz"}
          aria-label={count > 0 ? `Komentarze (${count})` : "Dodaj komentarz"}
          className={cn(
            "relative shrink-0 transition",
            count > 0
              ? "text-primary"
              : "text-muted-foreground/40 opacity-0 hover:text-foreground group-hover:opacity-100"
          )}
        >
          <MessageSquare className="size-3.5" />
          {count > 0 && (
            <span className="absolute -top-1.5 -right-1.5 grid size-3.5 place-items-center rounded-full bg-primary text-[9px] font-semibold text-primary-foreground">
              {count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="text-xs font-medium text-muted-foreground">Komentarze</div>
        {count > 0 ? (
          <ul className="max-h-56 space-y-2.5 overflow-y-auto">
            {cost.comments.map((c) => (
              <li key={c.id} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{c.authorName}</span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {formatDate(new Date(c.createdAt))}
                    {(c.authorId === currentUserId || c.authorId === null) && (
                      <button
                        type="button"
                        onClick={() => remove(c.id)}
                        disabled={pending}
                        aria-label="Usuń komentarz"
                        className="text-muted-foreground/60 hover:text-destructive"
                      >
                        <X className="size-3" />
                      </button>
                    )}
                  </span>
                </div>
                <p className="whitespace-pre-wrap text-muted-foreground">{c.body}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">Brak komentarzy.</p>
        )}
        <div className="space-y-2 border-t pt-2">
          <Textarea
            rows={2}
            value={draft}
            disabled={pending}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Napisz komentarz…"
          />
          <div className="flex items-center justify-between gap-2">
            {authDisabled ? (
              <span className="text-[11px] leading-tight text-muted-foreground">
                Podpisze pierwszy admin — włącz logowanie, by rozróżniać autorów
              </span>
            ) : (
              <span />
            )}
            <Button type="button" size="sm" onClick={add} disabled={pending || !draft.trim()}>
              Dodaj
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CostsTable({
  costs,
  categories,
  clients,
  supplierNames,
  templates,
  prevVat,
  currentUserId,
  authDisabled,
}: {
  costs: CostRow[];
  categories: SelectOption[];
  clients: SelectOption[];
  supplierNames: string[];
  templates: RecurringRow[];
  prevVat: { monthLabel: string; dueGr: number };
  currentUserId: string;
  authDisabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<CostRow | null>(null);
  const [toDelete, setToDelete] = useState<CostRow | null>(null);
  const [pending, startTransition] = useTransition();

  const kategoria = searchParams.get("kategoria") ?? "all";
  const przypisanie = searchParams.get("przypisanie") ?? "all";
  const platnosc = searchParams.get("platnosc") ?? "all";
  const sort = searchParams.get("sort") ?? "docDate";

  // liczba aktywnych filtrów (do plakietki na ikonie „Filtry")
  const activeFilters =
    (kategoria !== "all" ? 1 : 0) +
    (przypisanie !== "all" ? 1 : 0) +
    (platnosc !== "all" ? 1 : 0);

  // sortowanie z paska filtrów → stan początkowy tabeli (klucz wymusza remount)
  const SORT_STATE: Record<string, { id: string; desc: boolean }[]> = {
    docDate: [], // domyślnie: kolejność z bazy (data dokumentu malejąco = najnowsze)
    termin: [{ id: "dueDate", desc: false }],
    kategoria: [{ id: "categoryName", desc: false }],
    dostawca: [{ id: "supplierName", desc: false }],
    kwota: [{ id: "netGr", desc: true }],
  };
  const sortState = SORT_STATE[sort] ?? SORT_STATE.docDate;

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  // wyszukiwarka dostawca / nr dokumentu — filtr po stronie klienta
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return costs;
    return costs.filter(
      (c) =>
        c.supplierName.toLowerCase().includes(q) ||
        c.docNumber.toLowerCase().includes(q)
    );
  }, [costs, search]);

  const totals = useMemo(
    () =>
      filtered.reduce(
        (acc, c) => ({
          netGr: acc.netGr + c.netGr,
          vatGr: acc.vatGr + c.vatGr,
          grossGr: acc.grossGr + c.grossGr,
        }),
        { netGr: 0, vatGr: 0, grossGr: 0 }
      ),
    [filtered]
  );

  // KPI: netto (okres), do zapłaty (niezapłacone brutto), zaległe (po terminie)
  const kpi = useMemo(() => {
    const today = todayUTC();
    let unpaidGrossGr = 0;
    let overdueGrossGr = 0;
    let overdueCount = 0;
    for (const c of filtered) {
      if (c.paid) continue;
      // „Do zapłaty" = cały niezapłacony wypływ okresu (w tym planowane kopie
      // cykliczne — to realny przyszły wydatek). „Zaległe" liczy tylko po
      // terminie i NIE dotyczy planowanych (ich termin jest w przyszłości).
      unpaidGrossGr += c.grossGr;
      if (!c.planned && c.dueDate && daysOverdue(new Date(c.dueDate), today) > 0) {
        overdueGrossGr += c.grossGr;
        overdueCount += 1;
      }
    }
    return { unpaidGrossGr, overdueGrossGr, overdueCount };
  }, [filtered]);

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
      const result = await deleteCostAction(id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setToDelete(null);
      setDetail(null);
    });
  }

  const columns: ColumnDef<CostRow>[] = useMemo(
    () => [
      {
        id: "approval",
        header: "Status",
        cell: ({ row }) =>
          row.original.autoAdBudget ? (
            <div className="flex h-7 items-center px-1">
              <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                auto
              </span>
            </div>
          ) : (
            <InlineStatus cost={row.original} />
          ),
      },
      {
        accessorKey: "supplierName",
        header: ({ column }) => (
          <SortableHeader column={column}>Dostawca</SortableHeader>
        ),
        cell: ({ row }) =>
          row.original.autoAdBudget ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-purple-800 dark:text-purple-200">
              <Megaphone className="size-3.5" /> {row.original.supplierName}
            </span>
          ) : (
          <div className="flex items-center gap-1.5">
            <InlineSupplier cost={row.original} />
            {row.original.attachmentName && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a
                      href={`/api/zalaczniki/${row.original.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={`Załącznik: ${row.original.attachmentName}`}
                    >
                      <Paperclip className="size-3.5" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>{row.original.attachmentName}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {row.original.recurringCostId && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Repeat className="size-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    Koszt cykliczny — wygenerowany z szablonu
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            <CostComments
              cost={row.original}
              currentUserId={currentUserId}
              authDisabled={authDisabled}
            />
          </div>
          ),
      },
      {
        accessorKey: "categoryName",
        header: ({ column }) => (
          <SortableHeader column={column}>Kategoria</SortableHeader>
        ),
        cell: ({ row }) =>
          row.original.autoAdBudget ? (
            <span className={categoryPillClass(row.original.categoryName)}>
              {row.original.categoryName}
            </span>
          ) : (
            <InlineCategory cost={row.original} categories={categories} />
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
        cell: ({ row }) =>
          row.original.autoAdBudget ? (
            <div className="text-right font-medium text-purple-800 tabular-nums dark:text-purple-200">
              {formatMoney(row.original.netGr)}
            </div>
          ) : (
          <div className="flex justify-end">
            <InlineNet cost={row.original} />
          </div>
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
        cell: ({ row }) =>
          row.original.autoAdBudget ? (
            <span className="text-purple-800 tabular-nums dark:text-purple-200">
              {formatMoney(row.original.grossGr)}
            </span>
          ) : (
            formatMoney(row.original.grossGr)
          ),
      },
      {
        accessorKey: "dueDate",
        header: ({ column }) => (
          <SortableHeader column={column}>Termin</SortableHeader>
        ),
        cell: ({ row }) =>
          row.original.autoAdBudget ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <InlineDue cost={row.original} />
          ),
      },
      {
        id: "details",
        header: "",
        cell: ({ row }) =>
          row.original.autoAdBudget ? null : (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon-sm"
              title="Szczegóły"
              aria-label="Szczegóły kosztu"
              className="opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
              onClick={() => setDetail(row.original)}
            >
              <Info className="size-4" />
            </Button>
          </div>
          ),
      },
    ],
    [categories, currentUserId, authDisabled]
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Suma kosztów netto (okres)"
          value={formatMoney(totals.netGr)}
          sub={`${filtered.length} ${pluralPl(filtered.length, "pozycja", "pozycje", "pozycji")}`}
        />
        <KpiCard
          label="Do zapłaty (brutto)"
          value={formatMoney(kpi.unpaidGrossGr)}
          sub="Niezapłacone koszty w okresie"
          tone={kpi.unpaidGrossGr > 0 ? "warning" : "default"}
        />
        <KpiCard
          label="Zaległe (po terminie)"
          value={formatMoney(kpi.overdueGrossGr)}
          sub={`${kpi.overdueCount} ${pluralPl(kpi.overdueCount, "pozycja", "pozycje", "pozycji")} po terminie`}
          tone={kpi.overdueGrossGr > 0 ? "negative" : "default"}
        />
        <KpiCard
          label={`VAT za ${prevVat.monthLabel}`}
          value={formatMoney(Math.abs(prevVat.dueGr))}
          sub={
            prevVat.dueGr < 0
              ? "nadwyżka naliczonego (do zwrotu)"
              : "odłożony na osobnym koncie — nie jest kosztem"
          }
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PeriodFilter />
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <SlidersHorizontal className="size-4" /> Filtry
              {activeFilters > 0 && (
                <span className="ml-1 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                  {activeFilters}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Kategoria</label>
              <Select
                value={kategoria}
                onValueChange={(v) => setParam("kategoria", v === "all" ? null : v)}
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie kategorie</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Przypisanie</label>
              <Select
                value={przypisanie}
                onValueChange={(v) => setParam("przypisanie", v === "all" ? null : v)}
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie przypisania</SelectItem>
                  <SelectItem value="ogolny">Koszt ogólny</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Płatność</label>
              <Select
                value={platnosc}
                onValueChange={(v) => setParam("platnosc", v === "all" ? null : v)}
              >
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie płatności</SelectItem>
                  <SelectItem value="zaplacone">Zapłacone</SelectItem>
                  <SelectItem value="niezaplacone">Niezapłacone</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 border-t pt-3">
              <label className="text-xs font-medium text-muted-foreground">Sortuj po</label>
              <Select value={sort} onValueChange={(v) => setParam("sort", v === "docDate" ? null : v)}>
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="docDate">Dacie dokumentu (domyślnie)</SelectItem>
                  <SelectItem value="termin">Terminie płatności</SelectItem>
                  <SelectItem value="kategoria">Kategorii</SelectItem>
                  <SelectItem value="dostawca">Dostawcy</SelectItem>
                  <SelectItem value="kwota">Kwocie (netto)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
        <Input
          placeholder="Szukaj: dostawca, nr dokumentu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 min-w-[10rem] flex-1"
        />
        <div className="ml-auto flex items-center gap-1">
          {/* akcje poboczne — ikony z tooltipami, zgrupowane, żeby nie tłoczyć paska */}
          <div className="flex items-center gap-0.5 rounded-lg border bg-card p-0.5">
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={`/api/eksport/koszty?${searchParams.toString()}`}
                title="Eksport CSV"
                aria-label="Eksport CSV"
              >
                <Download className="size-4" />
              </a>
            </Button>
            <CostImportDialog
              trigger={
                <Button variant="ghost" size="icon-sm" title="Importuj CSV" aria-label="Importuj CSV">
                  <Upload className="size-4" />
                </Button>
              }
            />
            <RecurringCostsDialog
              templates={templates}
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title="Koszty cykliczne"
                  aria-label="Koszty cykliczne"
                >
                  <Repeat className="size-4" />
                </Button>
              }
            />
          </div>
          <CostFormDialog
            categories={categories}
            clients={clients}
            supplierNames={supplierNames}
            trigger={
              <Button size="sm">
                <Plus className="size-4" /> Nowy koszt
              </Button>
            }
          />
        </div>
      </div>

      <DataTable
        key={sort}
        columns={columns}
        data={filtered}
        scrollable
        dense
        initialSorting={sortState}
        rowClassName={(row) =>
          cn(
            "group",
            row.autoAdBudget &&
              "bg-purple-50/70 hover:bg-purple-50 dark:bg-purple-950/25 dark:hover:bg-purple-950/40"
          )
        }
        footer={
          <>
            <TableCell colSpan={3} className="font-medium">
              Suma ({filtered.length}{" "}
              {pluralPl(filtered.length, "pozycja", "pozycje", "pozycji")})
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
            title="Brak kosztów w wybranym okresie"
            description="Dodaj fakturę kosztową przyciskiem „Nowy koszt” albo zmień filtry okresu, kategorii lub przypisania."
          >
            <CostFormDialog
              categories={categories}
              clients={clients}
              supplierNames={supplierNames}
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Nowy koszt
                </Button>
              }
            />
          </EmptyState>
        }
      />

      {/* ── Panel szczegółów kosztu ─────────────────────────────── */}
      <DetailSheet
        open={detail !== null}
        onOpenChange={(open) => !open && setDetail(null)}
        title={detail?.supplierName ?? "Koszt"}
        description={
          detail ? `${detail.docNumber} · ${detail.categoryName}` : undefined
        }
        footer={
          detail && (
            <div className="flex flex-wrap items-center gap-2">
              <CostFormDialog
                cost={detail}
                categories={categories}
                clients={clients}
                supplierNames={supplierNames}
                trigger={
                  <Button variant="outline" size="sm">
                    <Pencil className="size-4" /> Edytuj
                  </Button>
                }
              />
              {!detail.paid &&
                (detail.approvedForPayment ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => runAction(() => toggleApprovalAction(detail.id))}
                  >
                    <CircleX className="size-4" /> Cofnij do „Brak działań”
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => runAction(() => toggleApprovalAction(detail.id))}
                  >
                    <Wallet className="size-4" /> Można płacić
                  </Button>
                ))}
              {!detail.paid && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() => runAction(() => toggleDelayedAction(detail.id))}
                >
                  <Clock className="size-4" />
                  {detail.delayed ? "Cofnij opóźnienie" : "Opóźniamy"}
                </Button>
              )}
              {!detail.paid && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  title="Przenieś ten koszt na następny miesiąc"
                  onClick={() =>
                    startTransition(async () => {
                      const r = await rollCostToNextMonthAction(detail.id);
                      if (r.ok) {
                        toast.success(r.message);
                        setDetail(null); // koszt zmienił miesiąc — zamknij panel
                      } else toast.error(r.error);
                    })
                  }
                >
                  <ArrowRight className="size-4" /> Przerzuć
                </Button>
              )}
              <Button
                size="sm"
                disabled={pending}
                onClick={() => runAction(() => togglePaidAction(detail.id))}
              >
                {detail.paid ? (
                  <>
                    <CircleX className="size-4" /> Cofnij zapłatę
                  </>
                ) : (
                  <>
                    <Wallet className="size-4" /> Oznacz zapłacony
                  </>
                )}
              </Button>
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
          <div className="space-y-1">
            <DetailRow label="Status">
              <StatusBadge tone={costTone(detail.paid, detail.approvedForPayment, detail.delayed)}>
                {costApprovalLabel(detail)}
              </StatusBadge>
            </DetailRow>
            <DetailRow label="Dostawca">{detail.supplierName}</DetailRow>
            <DetailRow label="Nr rachunku dostawcy">
              {detail.supplierAccount ?? "—"}
            </DetailRow>
            <DetailRow label="Nr dokumentu">{detail.docNumber}</DetailRow>
            <DetailRow label="Data dokumentu">
              {formatDate(new Date(detail.docDate))}
            </DetailRow>
            <DetailRow label="Termin płatności">
              {detail.dueDate ? formatDate(new Date(detail.dueDate)) : "—"}
            </DetailRow>
            <DetailRow label="Kategoria">{detail.categoryName}</DetailRow>
            <DetailRow label="Przypisanie">
              <AssignmentBadge clientName={detail.clientName} />
            </DetailRow>
            <DetailRow label="Netto">{formatMoney(detail.netGr)}</DetailRow>
            <DetailRow label="VAT">
              {isVatRate(detail.vatRate)
                ? `${formatMoney(detail.vatGr)} (${VAT_RATE_LABELS[detail.vatRate]})`
                : formatMoney(detail.vatGr)}
            </DetailRow>
            <DetailRow label="Brutto">{formatMoney(detail.grossGr)}</DetailRow>
            <DetailRow label="Data zapłaty">
              {detail.paidDate ? formatDate(new Date(detail.paidDate)) : "—"}
            </DetailRow>
            {detail.recurringCostId && (
              <DetailRow label="Koszt cykliczny">
                <StatusBadge tone="indigo">Z szablonu</StatusBadge>
              </DetailRow>
            )}
            {detail.attachmentName && (
              <DetailRow label="Załącznik">
                <a
                  href={`/api/zalaczniki/${detail.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-primary hover:underline"
                >
                  <Paperclip className="size-3.5" /> {detail.attachmentName}
                </a>
              </DetailRow>
            )}
            {detail.comments.length > 0 && (
              <div className="pt-3">
                <div className="mb-1.5 text-sm text-muted-foreground">
                  Komentarze ({detail.comments.length})
                </div>
                <ul className="space-y-2">
                  {detail.comments.map((c) => (
                    <li key={c.id} className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{c.authorName}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatDate(new Date(c.createdAt))}
                        </span>
                      </div>
                      <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">{c.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </DetailSheet>

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć koszt?</AlertDialogTitle>
            <AlertDialogDescription>
              Koszt „{toDelete?.docNumber}” od {toDelete?.supplierName} zostanie
              trwale usunięty wraz z załącznikiem. Tej operacji nie można
              cofnąć.
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
