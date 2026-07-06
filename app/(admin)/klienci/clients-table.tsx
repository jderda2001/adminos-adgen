"use client";

import { useMemo, useState, useTransition } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DataTable, SortableHeader } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { KpiCard } from "@/components/kpi-card";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BILLING_MODEL_LABELS,
  CLIENT_STATUS_LABELS,
  type BillingModel,
  type ClientStatus,
} from "@/lib/types";
import { formatDate, formatMoney, pluralPl } from "@/lib/format";
import { ClientFormDialog } from "./client-form";
import { ClientDetailSheet } from "./client-detail-sheet";
import { deleteClientAction } from "./actions";

export interface ClientRow {
  id: string;
  name: string;
  nip: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  billingModel: string;
  monthlyRetainerGr: number | null;
  offerTags: string | null; // tagi oferty rozdzielone przecinkami
  status: string;
  startDate: string | null; // ISO — serializowane z serwera
  notes: string | null;
}

export function ClientsTable({ clients }: { clients: ClientRow[] }) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [toDelete, setToDelete] = useState<ClientRow | null>(null);
  const [selected, setSelected] = useState<ClientRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return clients.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (!q) return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.nip ?? "").includes(q) ||
        (c.contactPerson ?? "").toLowerCase().includes(q)
      );
    });
  }, [clients, search, statusFilter]);

  const activeCount = useMemo(
    () => clients.filter((c) => c.status === "ACTIVE").length,
    [clients]
  );

  const totalMrrGr = useMemo(
    () =>
      clients
        .filter((c) => c.status === "ACTIVE")
        .reduce((sum, c) => sum + (c.monthlyRetainerGr ?? 0), 0),
    [clients]
  );

  const columns: ColumnDef<ClientRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <SortableHeader column={column}>Nazwa</SortableHeader>
        ),
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.name}</div>
            {row.original.nip && (
              <div className="text-xs text-muted-foreground">
                NIP {row.original.nip}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "billingModel",
        header: "Model rozliczeń",
        cell: ({ row }) =>
          BILLING_MODEL_LABELS[row.original.billingModel as BillingModel] ??
          row.original.billingModel,
      },
      {
        accessorKey: "offerTags",
        header: "Oferta",
        enableSorting: false,
        cell: ({ row }) => {
          const tags = (row.original.offerTags ?? "")
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          if (tags.length === 0) {
            return <span className="text-muted-foreground">—</span>;
          }
          return (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag) => (
                <StatusBadge key={tag} tone="indigo">
                  {tag}
                </StatusBadge>
              ))}
            </div>
          );
        },
      },
      {
        accessorKey: "monthlyRetainerGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Abonament (MRR)
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.monthlyRetainerGr != null
            ? formatMoney(row.original.monthlyRetainerGr)
            : "—",
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.status === "ACTIVE" ? "green" : "neutral"}
          >
            {CLIENT_STATUS_LABELS[row.original.status as ClientStatus] ??
              row.original.status}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "startDate",
        header: ({ column }) => (
          <SortableHeader column={column}>Start</SortableHeader>
        ),
        cell: ({ row }) =>
          row.original.startDate
            ? formatDate(new Date(row.original.startDate))
            : "—",
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <div
            className="flex justify-end"
            onClick={(e) => e.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Akcje">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <ClientFormDialog
                  client={row.original}
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Pencil className="size-4" /> Edytuj
                    </DropdownMenuItem>
                  }
                />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setToDelete(row.original)}
                >
                  <Trash2 className="size-4" /> Usuń
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ],
    []
  );

  function confirmDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result = await deleteClientAction(toDelete.id);
      if (result.ok) {
        toast.success(result.message);
        setSheetOpen(false);
      } else toast.error(result.error);
      setToDelete(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Aktywni klienci"
          value={activeCount}
          sub={`z ${clients.length} ${pluralPl(
            clients.length,
            "klienta",
            "klientów",
            "klientów"
          )}`}
        />
        <KpiCard
          label="Suma MRR (aktywni)"
          value={formatMoney(totalMrrGr)}
          sub="miesięczny abonament netto"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Szukaj po nazwie, NIP, osobie kontaktowej…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-72"
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie statusy</SelectItem>
            <SelectItem value="ACTIVE">Aktywni</SelectItem>
            <SelectItem value="ENDED">Zakończeni</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <ClientFormDialog
            trigger={
              <Button size="sm">
                <Plus className="size-4" /> Nowy klient
              </Button>
            }
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        initialSorting={[{ id: "name", desc: false }]}
        onRowClick={(row) => {
          setSelected(row);
          setSheetOpen(true);
        }}
        emptyState={
          <EmptyState
            title="Brak klientów"
            description="Dodaj pierwszego klienta, aby wystawiać faktury, przypisywać koszty i rejestrować czas pracy."
          >
            <ClientFormDialog
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Dodaj klienta
                </Button>
              }
            />
          </EmptyState>
        }
      />

      <ClientDetailSheet
        client={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onDelete={(client) => setToDelete(client)}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć klienta?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.name} zostanie trwale usunięty. Tej operacji nie można
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
