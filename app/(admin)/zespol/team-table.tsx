"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  KeyRound,
  MoreHorizontal,
  Pencil,
  Plus,
  UserCheck,
  UserX,
} from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { formatMoney, pluralPl } from "@/lib/format";
import { InviteMemberDialog, EditMemberDialog } from "./member-form";
import { MemberDetailSheet } from "./member-detail-sheet";
import {
  TempPasswordDialog,
  type TempPasswordInfo,
} from "./temp-password-dialog";
import { resetPasswordAction, setMemberActiveAction } from "./actions";

export interface RateRow {
  id: string;
  ratePerHourGr: number;
  validFrom: string; // ISO — serializowane z serwera
}

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  /** stawka obowiązująca dziś w gr/h; 0 = brak stawki */
  currentRateGr: number;
  rates: RateRow[];
}

export function TeamTable({
  members,
  currentUserId,
}: {
  members: MemberRow[];
  currentUserId: string;
}) {
  const [search, setSearch] = useState("");
  const [toDeactivate, setToDeactivate] = useState<MemberRow | null>(null);
  const [toReset, setToReset] = useState<MemberRow | null>(null);
  const [selected, setSelected] = useState<MemberRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [tempPassword, setTempPassword] = useState<TempPasswordInfo | null>(
    null
  );
  const [pending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  }, [members, search]);

  const activeCount = useMemo(
    () => members.filter((m) => m.active).length,
    [members]
  );
  const adminCount = useMemo(
    () => members.filter((m) => m.role === "ADMIN").length,
    [members]
  );

  const activate = useCallback(
    (member: MemberRow) => {
      startTransition(async () => {
        const result = await setMemberActiveAction(member.id, true);
        if (result.ok) toast.success(result.message);
        else toast.error(result.error);
      });
    },
    [startTransition]
  );

  const columns: ColumnDef<MemberRow>[] = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => (
          <SortableHeader column={column}>Imię i nazwisko</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="font-medium">{row.original.name}</span>
        ),
      },
      {
        accessorKey: "email",
        header: ({ column }) => (
          <SortableHeader column={column}>E-mail</SortableHeader>
        ),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.original.email}
          </span>
        ),
      },
      {
        accessorKey: "role",
        header: ({ column }) => (
          <SortableHeader column={column}>Rola</SortableHeader>
        ),
        cell: ({ row }) => (
          <StatusBadge
            tone={row.original.role === "ADMIN" ? "indigo" : "neutral"}
          >
            {ROLE_LABELS[row.original.role as Role] ?? row.original.role}
          </StatusBadge>
        ),
      },
      {
        accessorKey: "currentRateGr",
        header: ({ column }) => (
          <SortableHeader column={column} align="right">
            Stawka kosztowa
          </SortableHeader>
        ),
        meta: { align: "right" },
        cell: ({ row }) =>
          row.original.currentRateGr > 0
            ? `${formatMoney(row.original.currentRateGr)}/h`
            : "—",
      },
      {
        accessorKey: "active",
        header: "Status",
        cell: ({ row }) => (
          <StatusBadge tone={row.original.active ? "green" : "neutral"}>
            {row.original.active ? "Aktywny" : "Nieaktywny"}
          </StatusBadge>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const member = row.original;
          const isSelf = member.id === currentUserId;
          return (
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
                  <EditMemberDialog
                    member={member}
                    trigger={
                      <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                        <Pencil className="size-4" /> Edytuj
                      </DropdownMenuItem>
                    }
                  />
                  <DropdownMenuItem onSelect={() => setToReset(member)}>
                    <KeyRound className="size-4" /> Resetuj hasło
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {member.active ? (
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={isSelf}
                      onSelect={() => setToDeactivate(member)}
                    >
                      <UserX className="size-4" /> Dezaktywuj
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onSelect={() => activate(member)}>
                      <UserCheck className="size-4" /> Aktywuj
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [currentUserId, activate]
  );

  function confirmDeactivate() {
    if (!toDeactivate) return;
    startTransition(async () => {
      const result = await setMemberActiveAction(toDeactivate.id, false);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setToDeactivate(null);
    });
  }

  function confirmReset() {
    if (!toReset) return;
    const member = toReset;
    startTransition(async () => {
      const result = await resetPasswordAction(member.id);
      if (result.ok) {
        setTempPassword({
          password: result.tempPassword,
          userName: member.name,
        });
      } else {
        toast.error(result.error);
      }
      setToReset(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Aktywni pracownicy"
          value={activeCount}
          sub={`z ${members.length} ${pluralPl(
            members.length,
            "konta",
            "kont",
            "kont"
          )}`}
        />
        <KpiCard
          label="Administratorzy"
          value={adminCount}
          sub={`${members.length - adminCount} ${pluralPl(
            members.length - adminCount,
            "pracownik",
            "pracowników",
            "pracowników"
          )}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          placeholder="Szukaj po imieniu lub e-mailu…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 w-72"
        />
        <div className="ml-auto flex items-center gap-2">
          <InviteMemberDialog
            onInvited={(password, userName) =>
              setTempPassword({ password, userName })
            }
            trigger={
              <Button size="sm">
                <Plus className="size-4" /> Zaproś pracownika
              </Button>
            }
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        initialSorting={[{ id: "name", desc: false }]}
        rowClassName={(row) => (row.active ? undefined : "opacity-60")}
        onRowClick={(row) => {
          setSelected(row);
          setSheetOpen(true);
        }}
        emptyState={
          <EmptyState
            title="Brak pracowników"
            description="Zaproś pierwszego pracownika, aby nadać mu dostęp do systemu i ustawić stawkę kosztową do wyceny czasu pracy."
          >
            <InviteMemberDialog
              onInvited={(password, userName) =>
                setTempPassword({ password, userName })
              }
              trigger={
                <Button size="sm">
                  <Plus className="size-4" /> Zaproś pracownika
                </Button>
              }
            />
          </EmptyState>
        }
      />

      <MemberDetailSheet
        member={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        isSelf={selected?.id === currentUserId}
        onReset={(m) => setToReset(m)}
        onDeactivate={(m) => setToDeactivate(m)}
        onActivate={(m) => activate(m)}
      />

      {/* Potwierdzenie dezaktywacji */}
      <AlertDialog
        open={toDeactivate !== null}
        onOpenChange={(open) => !open && setToDeactivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Dezaktywować konto?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDeactivate?.name} straci dostęp do systemu, a wszystkie jego
              aktywne sesje zostaną zakończone. Dane (wpisy czasu, stawki)
              pozostaną bez zmian. Konto można później aktywować ponownie.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate} disabled={pending}>
              {pending ? "Dezaktywowanie…" : "Dezaktywuj"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Potwierdzenie resetu hasła */}
      <AlertDialog
        open={toReset !== null}
        onOpenChange={(open) => !open && setToReset(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zresetować hasło?</AlertDialogTitle>
            <AlertDialogDescription>
              Dla {toReset?.name} zostanie wygenerowane nowe hasło tymczasowe,
              a dotychczasowe sesje zostaną zakończone. Przy pierwszym
              logowaniu wymagana będzie zmiana hasła.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset} disabled={pending}>
              {pending ? "Resetowanie…" : "Resetuj hasło"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hasło tymczasowe — widoczne dokładnie raz */}
      <TempPasswordDialog
        info={tempPassword}
        onClose={() => setTempPassword(null)}
      />
    </div>
  );
}
