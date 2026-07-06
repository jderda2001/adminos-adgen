"use client";

// Widok tygodnia: nawigacja ←/→ (?tydzien=<offset>), wpisy zgrupowane po dniu
// z sumami dziennymi, edycja w dialogu, usuwanie z potwierdzeniem, suma tygodnia.

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
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
import { formatHours } from "@/lib/format";
import { deleteTimeEntryAction } from "./actions";
import { EntryEditDialog } from "./entry-edit-dialog";
import type { ClientOption } from "./time-entry-form";

export interface EntryRow {
  id: string;
  clientId: string;
  clientName: string;
  description: string | null;
  date: string; // ISO — serializowane z serwera
  minutes: number;
}

export interface DayGroup {
  iso: string;
  label: string; // np. "poniedziałek, 30.06"
  isToday: boolean;
  totalMinutes: number;
  entries: EntryRow[];
}

export function WeekView({
  days,
  weekLabel,
  weekOffset,
  weekTotalMinutes,
  clients,
}: {
  days: DayGroup[];
  weekLabel: string;
  weekOffset: number; // 0 = bieżący tydzień, ujemny = wstecz
  weekTotalMinutes: number;
  clients: ClientOption[];
}) {
  const [toDelete, setToDelete] = useState<EntryRow | null>(null);
  const [pending, startTransition] = useTransition();

  const prevHref = `/moj-czas?tydzien=${weekOffset - 1}`;
  const nextHref =
    weekOffset + 1 === 0 ? "/moj-czas" : `/moj-czas?tydzien=${weekOffset + 1}`;

  function confirmDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result = await deleteTimeEntryAction(toDelete.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setToDelete(null);
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon-sm">
            <Link href={prevHref} aria-label="Poprzedni tydzień">
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          {weekOffset < 0 ? (
            <Button asChild variant="outline" size="icon-sm">
              <Link href={nextHref} aria-label="Następny tydzień">
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon-sm"
              disabled
              aria-label="Następny tydzień"
            >
              <ChevronRight className="size-4" />
            </Button>
          )}
          <span className="text-sm font-medium">
            {weekOffset === 0 ? "Bieżący tydzień" : "Tydzień"}{" "}
            <span className="text-muted-foreground">({weekLabel})</span>
          </span>
        </div>
        <span className="text-sm text-muted-foreground">
          Suma tygodnia:{" "}
          <span className="font-medium text-foreground tabular-nums">
            {formatHours(weekTotalMinutes)}
          </span>
        </span>
      </div>

      {days.length === 0 ? (
        <EmptyState
          title="Brak wpisów w tym tygodniu"
          description="Dodaj wpis formularzem powyżej: wybierz klienta, wpisz liczbę godzin (np. 1,5) i naciśnij Enter. Możesz też wystartować timer przyciskiem „Start” i zatrzymać go po skończonej pracy."
        />
      ) : (
        <div className="space-y-3">
          {days.map((day) => (
            <div key={day.iso} className="rounded-md border bg-background">
              <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-1.5">
                <span className="text-sm font-medium capitalize">
                  {day.label}
                  {day.isToday && (
                    <span className="ml-2 text-xs font-normal text-primary">
                      dziś
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {formatHours(day.totalMinutes)}
                </span>
              </div>
              <ul className="divide-y">
                {day.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center gap-3 px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {entry.clientName}
                      </div>
                      {entry.description && (
                        <div className="truncate text-xs text-muted-foreground">
                          {entry.description}
                        </div>
                      )}
                    </div>
                    <span className="text-sm tabular-nums">
                      {formatHours(entry.minutes)}
                    </span>
                    <div className="flex items-center gap-1">
                      <EntryEditDialog
                        entry={entry}
                        clients={clients}
                        trigger={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Edytuj wpis"
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Usuń wpis"
                        onClick={() => setToDelete(entry)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <div className="flex justify-end px-1 text-sm">
            <span className="text-muted-foreground">
              Suma tygodnia:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {formatHours(weekTotalMinutes)}
              </span>
            </span>
          </div>
        </div>
      )}

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => !open && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć wpis czasu?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete &&
                `${toDelete.clientName} — ${formatHours(toDelete.minutes)}. `}
              Tej operacji nie można cofnąć.
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
