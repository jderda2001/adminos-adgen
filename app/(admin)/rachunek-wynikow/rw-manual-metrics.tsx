"use client";

// Metryki ręczne Rachunku Wyników — macierz metryka × 12 miesięcy z edycją
// inline (klik → Input; Enter/blur zapisuje, Escape anuluje, pusta wartość
// usuwa). Pod spodem dwa wiersze POCHODNE (tylko odczyt) liczone przez silnik
// lib/rw.ts: CAC i odchylenie zysku od estymacji.

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RwReport } from "@/lib/rw";
import { RW_MANUAL_METRICS, type RwManualMetricKey } from "@/lib/rw-types";
import { setRwManualMetricAction } from "./actions";
import { formatRwPct, formatZl, RW_MONTH_SHORT } from "./rw-format";

const plNum = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2 });

type ManualCell = { num: number | null; text: string | null } | undefined;

/** Wartość do wyświetlenia w komórce (null → „—”). */
function displayValue(cell: ManualCell): string | null {
  if (!cell) return null;
  if (cell.text !== null && cell.text !== "") return cell.text;
  if (cell.num !== null) return plNum.format(cell.num);
  return null;
}

/** Wartość startowa edycji — surowa, parsowalna przez akcję (przecinek). */
function editValue(cell: ManualCell): string {
  if (!cell) return "";
  if (cell.text !== null && cell.text !== "") return cell.text;
  if (cell.num !== null) return String(cell.num).replace(".", ",");
  return "";
}

const STICKY_CELL =
  "sticky left-0 z-10 min-w-64 bg-card py-2 pr-3 text-left align-middle";

export function RwManualMetrics({ report }: { report: RwReport }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{
    key: RwManualMetricKey;
    month: number;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const initialRef = useRef("");
  const skipBlurRef = useRef(false);

  function startEdit(key: RwManualMetricKey, month: number, current: string) {
    skipBlurRef.current = false;
    initialRef.current = current;
    setDraft(current);
    setEditing({ key, month });
  }

  function commit(key: RwManualMetricKey, month: number, value: string) {
    setEditing(null);
    if (value.trim() === initialRef.current.trim()) return; // bez zmian — nie zapisuj
    startTransition(async () => {
      const result = await setRwManualMetricAction(report.year, month, key, value);
      if (result.ok) toast.success(result.message ?? "Zapisano");
      else toast.error(result.error);
    });
  }

  return (
    <section className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3">
        <h2 className="font-heading text-sm font-semibold">
          Metryki ręczne (uzupełniane co miesiąc)
        </h2>
        <p className="text-xs text-muted-foreground">
          Te pola wypełniacie ręcznie (estymacja zysku, dane z CRM, oszczędności) —
          reszta rachunku liczy się automatycznie z importów. Kliknij komórkę, aby
          wpisać wartość: Enter zapisuje, Escape anuluje, pusta wartość usuwa.
        </p>
      </div>

      <div className={cn("overflow-x-auto", pending && "opacity-60")}>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th
                className={cn(
                  STICKY_CELL,
                  "text-xs font-medium tracking-wide text-muted-foreground uppercase"
                )}
              >
                Metryka
              </th>
              {RW_MONTH_SHORT.map((m) => (
                <th
                  key={m}
                  className="px-2 py-2 text-right text-xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RW_MANUAL_METRICS.map((metric) => (
              <tr key={metric.key} className="border-b border-border/60">
                <th scope="row" className={cn(STICKY_CELL, "font-normal")}>
                  {metric.label}
                  {metric.unit && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({metric.unit})
                    </span>
                  )}
                </th>
                {report.months.map((m) => {
                  const cell = m.manual[metric.key] as ManualCell;
                  const isEditing =
                    editing?.key === metric.key && editing.month === m.month;
                  const text = displayValue(cell);
                  return (
                    <td key={m.month} className="px-1 py-1 text-right">
                      {isEditing ? (
                        <Input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              skipBlurRef.current = true;
                              commit(metric.key, m.month, e.currentTarget.value);
                            } else if (e.key === "Escape") {
                              skipBlurRef.current = true;
                              setEditing(null);
                            }
                          }}
                          onBlur={(e) => {
                            if (skipBlurRef.current) {
                              skipBlurRef.current = false;
                              return;
                            }
                            commit(metric.key, m.month, e.currentTarget.value);
                          }}
                          className="h-7 w-24 px-1.5 text-right tabular-nums md:text-xs"
                          aria-label={`${metric.label} — ${RW_MONTH_SHORT[m.month - 1]}`}
                        />
                      ) : (
                        <button
                          type="button"
                          disabled={pending}
                          onClick={() =>
                            startEdit(metric.key, m.month, editValue(cell))
                          }
                          className={cn(
                            "w-full min-w-16 cursor-pointer rounded px-1.5 py-1 text-right tabular-nums whitespace-nowrap transition-colors hover:bg-accent",
                            text === null && "text-muted-foreground/50"
                          )}
                          title="Kliknij, aby edytować"
                        >
                          {text ?? "—"}
                        </button>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}

            {/* Wiersze pochodne — tylko odczyt, liczone przez silnik lib/rw.ts */}
            <tr className="border-t-2 border-b border-border/60">
              <th
                scope="row"
                className={cn(STICKY_CELL, "font-normal text-muted-foreground")}
              >
                CAC (koszt pozyskania klienta)
                <span className="ml-1 text-xs">— pochodna</span>
              </th>
              {report.months.map((m) => (
                <td
                  key={m.month}
                  className="px-2.5 py-2 text-right tabular-nums whitespace-nowrap"
                >
                  {m.cacGr !== null ? (
                    formatZl(m.cacGr)
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </td>
              ))}
            </tr>
            <tr className="border-b border-border/60">
              <th
                scope="row"
                className={cn(STICKY_CELL, "font-normal text-muted-foreground")}
              >
                Odchylenie zysku od estymacji
                <span className="ml-1 text-xs">— pochodna</span>
              </th>
              {report.months.map((m) => (
                <td
                  key={m.month}
                  className={cn(
                    "px-2.5 py-2 text-right tabular-nums whitespace-nowrap",
                    m.odchylenie !== null &&
                      m.odchylenie < 0 &&
                      "text-red-600 dark:text-red-400"
                  )}
                >
                  {m.odchylenie !== null ? (
                    formatRwPct(m.odchylenie)
                  ) : (
                    <span className="text-xs text-muted-foreground/50">
                      Brak danych
                    </span>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
