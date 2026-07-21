"use client";

// Historia importów kosztów — wysuwany panel z listą partii CSV. Dla każdej:
//  • „Edytuj wiersze" → filtruje rejestr do wierszy tej partii (?import=<id>),
//    gdzie edytuje się je inline (kategoria, kwota, dostawca, status…),
//  • „Cofnij import" → usuwa dokumenty Cost tej partii oraz mirror-wpisy RW.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History, Pencil, Undo2 } from "lucide-react";
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
import { formatDate, pluralPl } from "@/lib/format";
import { deleteCostImportBatchAction } from "./actions";

export interface CostImportRowInfo {
  id: string;
  filename: string;
  createdAt: string; // ISO
  costCount: number;
}

function BatchItem({ batch, onEdit }: { batch: CostImportRowInfo; onEdit: (id: string) => void }) {
  const [pending, startTransition] = useTransition();
  const created = new Date(batch.createdAt);
  const time = created.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" });

  function handleUndo() {
    startTransition(async () => {
      const r = await deleteCostImportBatchAction(batch.id);
      if (r.ok) toast.success(r.message ?? "Cofnięto import");
      else toast.error(r.error);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-3 shadow-[var(--shadow-card)]">
      <p className="truncate text-sm font-medium" title={batch.filename}>
        {batch.filename}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {batch.costCount} {pluralPl(batch.costCount, "koszt", "koszty", "kosztów")} ·{" "}
        {formatDate(created)}, {time}
      </p>
      <div className="mt-2 flex justify-end gap-1">
        <Button variant="ghost" size="xs" disabled={pending} onClick={() => onEdit(batch.id)}>
          <Pencil data-icon="inline-start" /> Edytuj wiersze
        </Button>
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
                Usunie {batch.costCount}{" "}
                {pluralPl(
                  batch.costCount,
                  "koszt zaimportowany",
                  "koszty zaimportowane",
                  "kosztów zaimportowanych"
                )}{" "}
                z pliku „{batch.filename}” oraz odpowiadające im wpisy w rachunku
                wyników. Tej operacji nie można cofnąć.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Anuluj</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleUndo}>
                Cofnij import
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function CostImportsSheet({ imports }: { imports: CostImportRowInfo[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  function handleEdit(id: string) {
    setOpen(false);
    router.push(`/finanse/koszty?import=${id}`);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <History data-icon="inline-start" /> Historia importów ({imports.length})
      </Button>
      <DetailSheet
        open={open}
        onOpenChange={setOpen}
        title="Historia importów kosztów"
        description="Partie zaimportowane z plików CSV. „Edytuj wiersze” pokazuje wiersze danego importu do poprawy w rejestrze; „Cofnij import” usuwa je razem z wpisami w rachunku wyników."
      >
        {imports.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak importów kosztów.</p>
        ) : (
          <div className="space-y-3">
            {imports.map((b) => (
              <BatchItem key={b.id} batch={b} onEdit={handleEdit} />
            ))}
          </div>
        )}
      </DetailSheet>
    </>
  );
}
