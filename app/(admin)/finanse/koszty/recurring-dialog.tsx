"use client";

// Dialog zarządzania szablonami kosztów cyklicznych: lista z przełącznikiem
// aktywności, edycją kwoty/dnia terminu i usuwaniem.

import { useState, useTransition } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatAmount, formatMoney } from "@/lib/format";
import {
  deleteRecurringCostAction,
  toggleRecurringActiveAction,
  updateRecurringCostAction,
} from "./actions";

export interface RecurringRow {
  id: string;
  active: boolean;
  supplierName: string;
  docNumber: string | null;
  netGr: number;
  vatRate: string;
  categoryName: string;
  clientName: string | null;
  dueDayOfMonth: number;
}

export function RecurringCostsDialog({
  templates,
  trigger,
}: {
  templates: RecurringRow[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringRow | null>(null);
  const [toDelete, setToDelete] = useState<RecurringRow | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleActive(id: string, active: boolean) {
    startTransition(async () => {
      const result = await toggleRecurringActiveAction(id, active);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function confirmDelete() {
    if (!toDelete) return;
    startTransition(async () => {
      const result = await deleteRecurringCostAction(toDelete.id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
      setToDelete(null);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Koszty cykliczne</DialogTitle>
        </DialogHeader>

        {templates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Brak szablonów kosztów cyklicznych. Utworzysz je, zaznaczając
            „Powtarzaj co miesiąc” przy dodawaniu nowego kosztu.
          </p>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dostawca</TableHead>
                  <TableHead className="text-right">Netto</TableHead>
                  <TableHead>Kategoria</TableHead>
                  <TableHead>Przypisanie</TableHead>
                  <TableHead className="text-right">Dzień terminu</TableHead>
                  <TableHead>Aktywny</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <div className="font-medium">{t.supplierName}</div>
                      {t.docNumber && (
                        <div className="text-xs text-muted-foreground">
                          {t.docNumber}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(t.netGr)}
                    </TableCell>
                    <TableCell>{t.categoryName}</TableCell>
                    <TableCell>
                      {t.clientName ?? (
                        <StatusBadge tone="neutral">Koszt ogólny</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.dueDayOfMonth}.
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={t.active}
                        disabled={pending}
                        onCheckedChange={(checked) =>
                          toggleActive(t.id, checked)
                        }
                        aria-label="Aktywny"
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edytuj szablon"
                          onClick={() => setEditing(t)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Usuń szablon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setToDelete(t)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Wyłączenie przełącznika zatrzymuje generowanie miesięcznych kopii.
          Kopie powstają automatycznie przy wejściu na stronę Kosztów i trafiają
          do sekcji „Do potwierdzenia”.
        </p>

        <RecurringEditDialog
          template={editing}
          onClose={() => setEditing(null)}
        />

        <AlertDialog
          open={toDelete !== null}
          onOpenChange={(o) => !o && setToDelete(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Usunąć szablon?</AlertDialogTitle>
              <AlertDialogDescription>
                Szablon „{toDelete?.supplierName}” zostanie trwale usunięty.
                Dotychczas wygenerowane koszty pozostaną bez zmian.
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
      </DialogContent>
    </Dialog>
  );
}

function RecurringEditDialog({
  template,
  onClose,
}: {
  template: RecurringRow | null;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template) return;
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateRecurringCostAction(template.id, formData);
      if (result.ok) {
        toast.success(result.message);
        onClose();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={template !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Edytuj szablon — {template?.supplierName}</DialogTitle>
        </DialogHeader>
        {template && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="recurring-net">Kwota netto (zł) *</Label>
              <Input
                id="recurring-net"
                name="net"
                inputMode="decimal"
                required
                defaultValue={formatAmount(template.netGr)}
                placeholder="1 234,56"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="recurring-day">
                Dzień miesiąca jako termin płatności (1–28) *
              </Label>
              <Input
                id="recurring-day"
                name="dueDayOfMonth"
                type="number"
                min={1}
                max={28}
                required
                defaultValue={template.dueDayOfMonth}
                className="w-24"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Anuluj
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Zapisywanie…" : "Zapisz"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
