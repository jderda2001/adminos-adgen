"use client";

// Import CSV kosztów historycznych. Krok 1: wybór pliku + ROK (daty w arkuszu
// bywają bez roku, np. „1 sierpnia" — rok bierzemy z nazwy pliku/selektora).
// Krok 2: przegląd — edytowalna kategoria RW (auto-sugestia) i stawka VAT.
// Zatwierdzenie tworzy dokumenty Cost + wpisy RwEntry (commitCostImportAction).

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Upload, ArrowLeft } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { parseCostCsv, yearFromFilename } from "@/lib/cost-csv";
import { suggestCategory } from "@/lib/rw-categorize";
import { findRwCategory, activeCategoryName } from "@/lib/rw-types";
import { VAT_RATES, VAT_RATE_LABELS, VAT_RATE_FRACTIONS, type VatRate } from "@/lib/types";
import { formatMoney, formatMonth, pluralPl } from "@/lib/format";
import { cn } from "@/lib/utils";
import { categoryGroups } from "@/app/(admin)/rachunek-wynikow/rw-category-groups";
import { commitCostImportAction, type CostImportRow } from "./actions";

interface ReviewRow {
  dateISO: string;
  year: number;
  month: number;
  supplier: string;
  category: string; // RW
  netGr: number;
  grossGr: number;
  vatRate: string; // 23|8|5|0|ZW
}

const FALLBACK = "Pozostałe wydatki operacyjne";
const YEARS = [2024, 2025, 2026, 2027];

function mapCategory(categoryText: string, supplier: string): string {
  const active = activeCategoryName("KOSZT", categoryText.trim());
  if (categoryText.trim() && findRwCategory("KOSZT", active)) return active;
  const s = suggestCategory("KOSZT", { description: `${supplier} ${categoryText}`.trim() });
  return s.category ?? FALLBACK;
}
function grossFromVat(netGr: number, vatRate: string): number {
  const frac = VAT_RATE_FRACTIONS[vatRate as VatRate] ?? 0;
  return Math.round(netGr * (1 + frac));
}

export function CostImportDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"select" | "review">("select");
  const [fileName, setFileName] = useState("");
  const [rawText, setRawText] = useState<string | null>(null);
  const [year, setYear] = useState<number>(2026);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [errors, setErrors] = useState<{ line: number; reason: string }[]>([]);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const groups = useMemo(() => categoryGroups("KOSZT"), []);

  function reset() {
    setStep("select");
    setFileName("");
    setRawText(null);
    setRows([]);
    setErrors([]);
    setFormatError(null);
  }
  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) reset();
  }

  function parseText(text: string, y: number) {
    const res = parseCostCsv(text, y);
    if ("formatError" in res) {
      setFormatError(res.formatError);
      setErrors([]);
      setRows([]);
      return;
    }
    setFormatError(null);
    setErrors(res.errors);
    setRows(
      res.rows.map((r) => ({
        dateISO: r.dateISO,
        year: r.year,
        month: r.month,
        supplier: r.supplier,
        category: mapCategory(r.categoryText, r.supplier),
        netGr: r.netGr,
        grossGr: r.grossGr,
        vatRate: r.vatRate ?? "0",
      }))
    );
  }

  async function handleFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    const detected = yearFromFilename(file.name) ?? year;
    setFileName(file.name);
    setRawText(text);
    setYear(detected);
    parseText(text, detected);
  }

  function changeYear(y: number) {
    setYear(y);
    if (rawText) parseText(rawText, y);
  }

  function setRowCategory(i: number, category: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, category } : r)));
  }
  function setRowVat(i: number, vatRate: string) {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, vatRate, grossGr: grossFromVat(r.netGr, vatRate) } : r))
    );
  }
  function setAllVat(vatRate: string) {
    setRows((prev) => prev.map((r) => ({ ...r, vatRate, grossGr: grossFromVat(r.netGr, vatRate) })));
  }

  const monthsCovered = useMemo(() => {
    const set = new Set(rows.map((r) => `${r.year}-${String(r.month).padStart(2, "0")}`));
    return [...set].sort();
  }, [rows]);
  const totalNet = useMemo(() => rows.reduce((a, r) => a + r.netGr, 0), [rows]);

  function commit() {
    startTransition(async () => {
      const payload: CostImportRow[] = rows.map((r) => ({
        dateISO: r.dateISO,
        year: r.year,
        month: r.month,
        supplier: r.supplier,
        category: r.category,
        netGr: r.netGr,
        grossGr: r.grossGr,
        vatRate: r.vatRate,
      }));
      const res = await commitCostImportAction({ filename: fileName, rows: payload });
      if (res.ok) {
        toast.success(
          `Zaimportowano ${res.imported} ${pluralPl(res.imported, "koszt", "koszty", "kosztów")} (lata: ${res.years.join(", ")})`
        );
        setOpen(false);
        reset();
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm" variant="outline">
            <Upload data-icon="inline-start" /> Importuj CSV
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className={cn("flex max-h-[90vh] flex-col", step === "review" ? "sm:max-w-4xl" : "sm:max-w-lg")}
      >
        <DialogHeader>
          <DialogTitle>
            {step === "select" ? "Import kosztów z CSV" : "Sprawdź koszty przed zapisem"}
          </DialogTitle>
          <DialogDescription>
            {step === "select" ? (
              <>
                Rozpoznaję kolumny: <span className="font-medium text-foreground">Data, Faktura/Dostawca,
                Kategoria, Wartość netto, Wartość Brutto</span>. Daty mogą być słowne („1 sierpnia") —
                dlatego wskaż <span className="font-medium text-foreground">rok</span> pliku. Każdy wiersz
                trafia do Kosztów i do Rachunku wyników.
              </>
            ) : (
              <>Popraw kategorię (RW) i VAT. Kwoty to netto; koszty oznaczamy jako opłacone.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 overflow-y-auto">
            <div className="grid grid-cols-[1fr_auto] items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="cost-csv-file">Plik CSV</Label>
                <Input
                  id="cost-csv-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cost-csv-year">Rok</Label>
                <Select value={String(year)} onValueChange={(v) => changeYear(Number(v))}>
                  <SelectTrigger id="cost-csv-year" className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {YEARS.map((y) => (
                      <SelectItem key={y} value={String(y)}>
                        {y}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {formatError && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                {formatError}
              </div>
            )}
            {rows.length > 0 && (
              <div className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone="blue">
                    {rows.length} {pluralPl(rows.length, "wiersz", "wiersze", "wierszy")}
                  </StatusBadge>
                  <span className="text-muted-foreground">
                    miesiące: {monthsCovered.length} · suma netto {formatMoney(totalNet)}
                  </span>
                </div>
                {errors.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    Pominięto {errors.length} {pluralPl(errors.length, "wiersz", "wiersze", "wierszy")}:{" "}
                    {errors.slice(0, 6).map((e) => `linia ${e.line} (${e.reason})`).join("; ")}
                    {errors.length > 6 ? "…" : ""}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === "review" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="tabular-nums text-muted-foreground">
                {rows.length} {pluralPl(rows.length, "koszt", "koszty", "kosztów")} · suma netto{" "}
                <span className="font-medium text-foreground">{formatMoney(totalNet)}</span>
              </span>
              <span className="ml-auto flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span>Ustaw VAT wszystkim:</span>
                {VAT_RATES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setAllVat(r)}
                    className="rounded-full border px-2 py-0.5 hover:bg-muted hover:text-foreground"
                  >
                    {VAT_RATE_LABELS[r as VatRate]}
                  </button>
                ))}
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                    <th className="w-24">Data</th>
                    <th>Pozycja</th>
                    <th className="w-28 text-right">Netto</th>
                    <th className="w-24">VAT</th>
                    <th className="w-52">Kategoria (RW)</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">{r.dateISO}</td>
                      <td className="px-2 py-1.5">
                        <span className="block break-words font-medium" title={r.supplier}>
                          {r.supplier}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(r.netGr)}</td>
                      <td className="px-2 py-1.5">
                        <Select value={r.vatRate} onValueChange={(v) => setRowVat(i, v)}>
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {VAT_RATES.map((rate) => (
                              <SelectItem key={rate} value={rate}>
                                {VAT_RATE_LABELS[rate as VatRate]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-2 py-1.5">
                        <Select value={r.category} onValueChange={(v) => setRowCategory(i, v)}>
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {groups.map((g) => (
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {monthsCovered.map((m) => (
                <span key={m} className="capitalize">
                  {formatMonth(m)}
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "select" ? (
            <>
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Anuluj
              </Button>
              <Button onClick={() => setStep("review")} disabled={rows.length === 0}>
                Dalej: sprawdź ({rows.length})
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("select")} disabled={pending}>
                <ArrowLeft data-icon="inline-start" /> Wstecz
              </Button>
              <Button onClick={commit} disabled={pending || rows.length === 0}>
                {pending ? "Zapisywanie…" : `Zaimportuj (${rows.length})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
