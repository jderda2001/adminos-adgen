"use client";

// Macierz rozliczenia zespołu: wiersz = pracownik; kolumny = Założenie (edytowalne
// inline), Tydz. 1..N (koszt pracy w danym tygodniu miesiąca), Wynik końcowy.
// Pod tabelą trzy wiersze podsumowania jak w arkuszu adGen: suma live / założenie /
// różnica (założenie − suma live; dodatnia = poniżej budżetu).

import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { formatAmount, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { setMonthlyBudgetAction } from "../budget-actions";

export interface WeekColumn {
  index: number;
  label: string; // "Tydz. 1"
  range: string; // "01.07.2026 – 06.07.2026"
}

export interface SettlementRow {
  userId: string;
  name: string;
  budgetGr: number | null; // założenie (monthlyBudgetGr)
  weeks: number[]; // koszt pracy w kolejnych tygodniach miesiąca
  totalGr: number; // suma tygodni = wynik końcowy
}

// tło "pomarańczowe" jak kolumna założenia w arkuszu
const BUDGET_BG = "bg-amber-100/70 dark:bg-amber-950/40";
const TOTAL_BG = "bg-muted/60";

function BudgetCell({
  userId,
  name,
  budgetGr,
}: {
  userId: string;
  name: string;
  budgetGr: number | null;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(
    budgetGr != null ? formatAmount(budgetGr) : ""
  );
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // zsynchronizuj wartość po zapisie/odświeżeniu danych z serwera
  useEffect(() => {
    if (!editing) setValue(budgetGr != null ? formatAmount(budgetGr) : "");
  }, [budgetGr, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function save() {
    const current = budgetGr != null ? formatAmount(budgetGr) : "";
    if (value.trim() === current.trim()) {
      setEditing(false);
      return;
    }
    startTransition(async () => {
      const result = await setMonthlyBudgetAction(userId, value);
      if (result.ok) {
        toast.success(result.message ?? "Zapisano");
        setEditing(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  function cancel() {
    setValue(budgetGr != null ? formatAmount(budgetGr) : "");
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <Input
          ref={inputRef}
          value={value}
          disabled={pending}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              save();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="0,00"
          inputMode="decimal"
          aria-label={`Założenie — ${name}`}
          className="h-7 w-28 text-right tabular-nums"
        />
        <span className="text-xs text-muted-foreground">zł</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group flex w-full items-center justify-end gap-1.5 rounded px-1 py-0.5 tabular-nums hover:bg-amber-200/60 dark:hover:bg-amber-900/40"
      aria-label={`Edytuj założenie — ${name}`}
    >
      {budgetGr != null ? (
        formatMoney(budgetGr)
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
      <Pencil className="size-3 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}

export function SettlementTable({
  rows,
  weekColumns,
  periodLabel,
  sumLiveGr,
  sumBudgetGr,
  differenceGr,
}: {
  rows: SettlementRow[];
  weekColumns: WeekColumn[];
  periodLabel: string;
  sumLiveGr: number;
  sumBudgetGr: number;
  differenceGr: number;
}) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Brak pracowników"
        description="Dodaj pracowników w module Zespół, aby rozliczać koszt pracy względem założeń miesięcznych."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Okres: <span className="font-medium text-foreground">{periodLabel}</span>{" "}
        — koszt pracy liczony z godzin i stawek historycznych; kolumna{" "}
        <span className="font-medium text-foreground">Założenie</span> jest
        edytowalna (kliknij kwotę).
      </p>

      <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
        <Table className="w-full table-fixed text-[13px] [&_td]:px-2.5 [&_th]:px-2.5">
          <colgroup>
            <col className="w-9" />
            <col />
            <col className="w-28" />
            {weekColumns.map((w) => (
              <col key={w.index} className="w-[86px]" />
            ))}
            <col className="w-28" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 text-right text-muted-foreground">
                #
              </TableHead>
              <TableHead>Pracownik</TableHead>
              <TableHead
                className={cn("text-right", BUDGET_BG)}
                title="Miesięczny budżet wypłaty (monthlyBudgetGr)"
              >
                Założenie
              </TableHead>
              {weekColumns.map((w) => (
                <TableHead key={w.index} className="text-right">
                  <div className="leading-tight">
                    <div>{w.label}</div>
                    <div className="text-xs font-normal text-muted-foreground">
                      {w.range}
                    </div>
                  </div>
                </TableHead>
              ))}
              <TableHead className={cn("text-right", TOTAL_BG)}>
                Wynik końcowy
              </TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={r.userId}>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {i + 1}
                </TableCell>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className={cn("text-right", BUDGET_BG)}>
                  <BudgetCell
                    userId={r.userId}
                    name={r.name}
                    budgetGr={r.budgetGr}
                  />
                </TableCell>
                {r.weeks.map((wGr, wi) => (
                  <TableCell
                    key={wi}
                    className={cn(
                      "text-right tabular-nums",
                      wGr === 0 && "text-muted-foreground"
                    )}
                  >
                    {formatMoney(wGr)}
                  </TableCell>
                ))}
                <TableCell
                  className={cn("text-right font-medium tabular-nums", TOTAL_BG)}
                >
                  {formatMoney(r.totalGr)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>

          <TableFooter>
            <TableRow>
              <TableCell />
              <TableCell className="font-medium">suma live</TableCell>
              <TableCell className={cn("text-right", BUDGET_BG)} />
              {weekColumns.length > 0 && (
                <TableCell
                  colSpan={weekColumns.length}
                  className="text-right text-xs font-normal text-muted-foreground"
                >
                  łączny koszt pracy w miesiącu
                </TableCell>
              )}
              <TableCell
                className={cn("text-right font-semibold tabular-nums", TOTAL_BG)}
              >
                {formatMoney(sumLiveGr)}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell />
              <TableCell className="font-medium">założenie</TableCell>
              <TableCell
                className={cn(
                  "text-right font-semibold tabular-nums",
                  BUDGET_BG
                )}
              >
                {formatMoney(sumBudgetGr)}
              </TableCell>
              {weekColumns.length > 0 && (
                <TableCell colSpan={weekColumns.length} />
              )}
              <TableCell className={TOTAL_BG} />
            </TableRow>
            <TableRow>
              <TableCell />
              <TableCell className="font-medium">różnica</TableCell>
              <TableCell className={cn("text-right", BUDGET_BG)} />
              <TableCell
                colSpan={Math.max(1, weekColumns.length + 1)}
                className={cn(
                  "text-right font-semibold tabular-nums",
                  differenceGr < 0 && "text-red-600 dark:text-red-400"
                )}
              >
                {formatMoney(differenceGr)}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {differenceGr >= 0 ? "poniżej budżetu" : "przekroczenie"}
                </span>
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  );
}
