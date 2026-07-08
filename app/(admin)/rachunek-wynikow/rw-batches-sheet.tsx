"use client";

// Historia importów rachunku wyników — wysuwany panel (DetailSheet) z listą
// partii CSV i możliwością cofnięcia importu (usuwa wpisy partii; wyliczenia
// przeliczają się z pozostałych danych po revalidatePath w akcji).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { History, Undo2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { DetailSheet } from "@/components/detail-sheet";
import { StatusBadge } from "@/components/status-badge";
import { formatDate, pluralPl } from "@/lib/format";
import { deleteRwBatchAction } from "./actions";
import type { RwBatchRow } from "./rw-view";

function kindLabel(kind: string): string {
  return kind === "PRZYCHOD" ? "Przychody" : kind === "KOSZT" ? "Koszty" : kind;
}

function BatchItem({ batch }: { batch: RwBatchRow }) {
  const [pending, startTransition] = useTransition();
  const created = new Date(batch.createdAt);
  const time = created.toLocaleTimeString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
  });

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteRwBatchAction(batch.id);
      if (result.ok) {
        toast.success(result.message ?? "Cofnięto import");
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="rounded-xl border bg-card p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium" title={batch.filename}>
            {batch.filename}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {batch.rowCount}{" "}
            {pluralPl(batch.rowCount, "wiersz", "wiersze", "wierszy")} ·{" "}
            {formatDate(created)}, {time}
          </p>
        </div>
        <StatusBadge tone={batch.kind === "PRZYCHOD" ? "green" : "red"}>
          {kindLabel(batch.kind)}
        </StatusBadge>
      </div>
      <div className="mt-2 flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              disabled={pending}
              className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
            >
              <Undo2 data-icon="inline-start" />
              {pending ? "Cofanie…" : "Cofnij import"}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cofnąć import?</AlertDialogTitle>
              <AlertDialogDescription>
                Usunie {batch.rowCount}{" "}
                {pluralPl(
                  batch.rowCount,
                  "wiersz zaimportowany",
                  "wiersze zaimportowane",
                  "wierszy zaimportowanych"
                )}{" "}
                z pliku „{batch.filename}” — wyliczenia rachunku wyników zostaną
                przeliczone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Anuluj</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>
                Cofnij import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function RwBatchesSheet({ batches }: { batches: RwBatchRow[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History data-icon="inline-start" /> Historia importów
        {batches.length > 0 && ` (${batches.length})`}
      </Button>
      <DetailSheet
        open={open}
        onOpenChange={setOpen}
        title="Historia importów"
        description="Partie zaimportowane z plików CSV. Cofnięcie importu usuwa wszystkie wiersze danej partii."
      >
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Brak importów dla tego roku.
          </p>
        ) : (
          <div className="space-y-3">
            {batches.map((batch) => (
              <BatchItem key={batch.id} batch={batch} />
            ))}
          </div>
        )}
      </DetailSheet>
    </>
  );
}
