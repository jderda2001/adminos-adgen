"use client";

// Edycja zaimportowanej partii — otwierana z „Historii importów". Wczytuje
// wpisy partii, pozwala poprawić kategorię i kwotę oraz usunąć wiersze, po
// czym PODMIENIA wszystkie wpisy partii (updateRwBatchAction). Rok i miesiąc
// wpisów są zachowane (edycja nie zmienia dat). Pusty zestaw = usunięcie partii.

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { RW_MONTH_LABELS, type RwKind } from "@/lib/rw-types";
import { pluralPl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { formatZl } from "./rw-format";
import { categoryGroups } from "./rw-category-groups";
import {
  getRwBatchForEditAction,
  updateRwBatchAction,
  type RwBatchEditRow,
} from "./actions";

const RW_MONTH_SHORT = [
  "sty", "lut", "mar", "kwi", "maj", "cze",
  "lip", "sie", "wrz", "paź", "lis", "gru",
];

interface EditRow extends RwBatchEditRow {
  rid: number; // stabilny klucz w UI (kolejność wczytania)
}

export function RwBatchEditDialog({
  batchId,
  filename,
  open,
  onOpenChange,
}: {
  batchId: string | null;
  filename: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<EditRow[]>([]);
  const [pending, startTransition] = useTransition();
  const rowsRef = useRef<EditRow[]>(rows);
  rowsRef.current = rows;

  const groupsByKind = useMemo(
    () => ({ PRZYCHOD: categoryGroups("PRZYCHOD"), KOSZT: categoryGroups("KOSZT") }),
    []
  );

  // wczytaj wpisy przy otwarciu
  useEffect(() => {
    if (!open || !batchId) return;
    let alive = true;
    setLoading(true);
    setRows([]);
    getRwBatchForEditAction(batchId)
      .then((res) => {
        if (!alive) return;
        if (!res.ok) {
          toast.error(res.error);
          onOpenChange(false);
          return;
        }
        setRows(res.rows.map((r, i) => ({ ...r, rid: i })));
      })
      .catch(() => {
        if (!alive) return;
        toast.error("Nie udało się wczytać importu");
        onOpenChange(false);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [open, batchId, onOpenChange]);

  const stats = useMemo(() => {
    let revenueGr = 0;
    let costGr = 0;
    let invalid = 0;
    for (const r of rows) {
      if (r.amountGr === 0) invalid++;
      if (r.kind === "PRZYCHOD") revenueGr += r.amountGr;
      else costGr += r.amountGr;
    }
    return { revenueGr, costGr, invalid };
  }, [rows]);

  function setCategory(rid: number, category: string) {
    setRows((prev) => prev.map((r) => (r.rid === rid ? { ...r, category } : r)));
  }

  function setAmount(rid: number, magnitude: number) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.rid !== rid) return r;
        const sign = r.kind === "PRZYCHOD" ? 1 : -1;
        const mag = Number.isFinite(magnitude) ? Math.max(0, Math.round(magnitude * 100)) : 0;
        return { ...r, amountGr: sign * mag };
      })
    );
  }

  function removeRow(rid: number) {
    setRows((prev) => prev.filter((r) => r.rid !== rid));
  }

  function handleSave() {
    if (!batchId) return;
    if (stats.invalid > 0) {
      toast.error("Uzupełnij kwoty (nie mogą być zerowe)");
      return;
    }
    const payload: RwBatchEditRow[] = rowsRef.current.map((r) => ({
      year: r.year,
      month: r.month,
      kind: r.kind,
      category: r.category,
      amountGr: r.amountGr,
      description: r.description,
      contractor: r.contractor,
      bank: r.bank,
      note: r.note,
    }));
    startTransition(async () => {
      const res = await updateRwBatchAction({ batchId, rows: payload });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.imported === 0) {
        toast.success("Usunięto wszystkie wiersze — partia skasowana");
      } else {
        toast.success(
          `Zapisano zmiany — ${res.imported} ${pluralPl(res.imported, "operacja", "operacje", "operacji")}`
        );
      }
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (pending ? null : onOpenChange(o))}>
      <DialogContent
        className="flex max-h-[90vh] flex-col sm:max-w-3xl"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edytuj import</DialogTitle>
          <DialogDescription>
            Popraw kategorie i kwoty operacji z pliku „
            <span className="font-medium text-foreground">{filename}</span>". Zapis
            podmienia wszystkie wiersze tej partii; daty (miesiąc/rok) pozostają.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Wczytywanie…
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="tabular-nums text-muted-foreground">
                {rows.length} {pluralPl(rows.length, "operacja", "operacje", "operacji")}
              </span>
              {stats.invalid > 0 && (
                <StatusBadge tone="red">{stats.invalid} bez kwoty</StatusBadge>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                    <th className="w-9">Mc</th>
                    <th>Operacja</th>
                    <th className="w-28 text-right">Kwota</th>
                    <th className="w-56">Kategoria</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rid} className="border-t align-top">
                      <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">
                        {RW_MONTH_SHORT[r.month - 1]}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={cn(
                              "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium",
                              r.kind === "PRZYCHOD"
                                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"
                                : "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400"
                            )}
                          >
                            {r.kind === "PRZYCHOD" ? "P" : "K"}
                          </span>
                          <span className="max-w-[240px] truncate font-medium">
                            {r.description || r.contractor || "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <input
                          key={`amt-${r.rid}`}
                          type="number"
                          step="0.01"
                          min="0"
                          defaultValue={(Math.abs(r.amountGr) / 100).toFixed(2)}
                          onChange={(e) =>
                            setAmount(r.rid, parseFloat(e.target.value || "0"))
                          }
                          className={cn(
                            "w-24 rounded-md border bg-background px-1.5 py-0.5 text-right tabular-nums focus:border-ring focus:outline-none",
                            r.amountGr === 0 ? "border-red-400" : "border-input",
                            r.amountGr < 0 && "text-red-600 dark:text-red-400"
                          )}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <Select
                          value={r.category}
                          onValueChange={(v) => setCategory(r.rid, v)}
                        >
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {groupsByKind[r.kind as RwKind].map((g) => (
                              <SelectGroup key={g.label}>
                                <SelectLabel>{g.label}</SelectLabel>
                                {g.items.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-1 py-1.5">
                        <button
                          type="button"
                          onClick={() => removeRow(r.rid)}
                          title="Usuń wiersz z importu"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground">
              <span className="tabular-nums">
                Przychody:{" "}
                <span className="font-medium text-emerald-600 dark:text-emerald-400">
                  {formatZl(stats.revenueGr)}
                </span>
              </span>
              <span className="tabular-nums">
                Koszty:{" "}
                <span className="font-medium text-red-600 dark:text-red-400">
                  {formatZl(stats.costGr)}
                </span>
              </span>
              {rows.length === 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  Zapis usunie całą partię.
                </span>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Anuluj
          </Button>
          <Button onClick={handleSave} disabled={pending || loading || stats.invalid > 0}>
            {pending ? "Zapisywanie…" : "Zapisz zmiany"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
