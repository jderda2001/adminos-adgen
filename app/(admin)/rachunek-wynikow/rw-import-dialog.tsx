"use client";

// Import CSV rachunku wyników — dialog dwuetapowy: wybór pliku → podgląd
// (parsowanie LOKALNE w przeglądarce, wyłącznie informacyjne) → import.
// Serwer parsuje plik PONOWNIE (importRwCsvAction) — wysyłamy sam plik,
// nigdy sparsowane dane.

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { parseRwCsv, type RwParseResult, type RwParseIssue } from "@/lib/rw-parse";
import { RW_MONTH_LABELS } from "@/lib/rw-types";
import { pluralPl } from "@/lib/format";
import { formatZl } from "./rw-format";
import { importRwCsvAction } from "./actions";

const MAX_ISSUES_SHOWN = 10;

type Preview = RwParseResult | { formatError: string };

function isFormatError(p: Preview): p is { formatError: string } {
  return "formatError" in p;
}

/** Lista problemów parsowania (linia + komunikat), max 10 + licznik reszty */
function IssueList({ issues }: { issues: RwParseIssue[] }) {
  const shown = issues.slice(0, MAX_ISSUES_SHOWN);
  const rest = issues.length - shown.length;
  return (
    <ul className="mt-1.5 space-y-0.5">
      {shown.map((issue, i) => (
        <li key={i} className="text-xs tabular-nums">
          linia {issue.line}: {issue.message}
        </li>
      ))}
      {rest > 0 && (
        <li className="text-xs italic">
          … i {rest} {pluralPl(rest, "kolejny", "kolejne", "kolejnych")}
        </li>
      )}
    </ul>
  );
}

export function RwImportDialog({
  year,
  trigger,
}: {
  year: number;
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();
  const parseToken = useRef(0);

  const parsed = preview && !isFormatError(preview) ? preview : null;
  const rowCount = parsed?.entries.length ?? 0;
  const canImport =
    file !== null &&
    parsed !== null &&
    parsed.errors.length === 0 &&
    rowCount > 0;

  // Podgląd sum per miesiąc — sanity check przed zatwierdzeniem importu
  // (suma kwot z wierszy pliku; serwer i tak parsuje plik od nowa).
  const monthSums = useMemo(() => {
    if (!parsed) return [];
    const sums = new Map<number, number>();
    for (const e of parsed.entries) {
      sums.set(e.month, (sums.get(e.month) ?? 0) + e.amountGr);
    }
    return [...sums.entries()].sort((a, b) => a[0] - b[0]);
  }, [parsed]);
  const totalGr = useMemo(
    () => monthSums.reduce((acc, [, v]) => acc + v, 0),
    [monthSums]
  );

  function reset() {
    parseToken.current++;
    setFile(null);
    setPreview(null);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return; // nie zamykaj w trakcie importu
    setOpen(next);
    if (!next) reset();
  }

  async function handleFileChange(f: File | null) {
    const token = ++parseToken.current;
    setFile(f);
    setPreview(null);
    if (!f) return;
    try {
      const text = await f.text();
      if (token !== parseToken.current) return; // wybrano inny plik w międzyczasie
      setPreview(parseRwCsv(text));
    } catch {
      if (token !== parseToken.current) return;
      setPreview({ formatError: "Nie udało się odczytać pliku — spróbuj ponownie." });
    }
  }

  function handleImport() {
    if (!file || !canImport) return;
    const formData = new FormData();
    formData.set("file", file);
    formData.set("year", String(year));
    startTransition(async () => {
      const result = await importRwCsvAction(formData);
      if (result.ok) {
        const monthNames = result.months
          .map((m) => RW_MONTH_LABELS[m - 1])
          .join(", ");
        toast.success(
          `Zaimportowano ${result.imported} ${pluralPl(result.imported, "wiersz", "wiersze", "wierszy")}` +
            (monthNames ? ` — miesiące: ${monthNames}` : "")
        );
        setOpen(false);
        reset();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button size="sm">
            <Upload data-icon="inline-start" /> Importuj CSV
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import CSV — rachunek wyników</DialogTitle>
          <DialogDescription>
            Import zapisze dane do roku <span className="font-medium text-foreground">{year}</span>.
            Obsługiwane pliki: przychody lub koszty z arkusza „Rachunek wyników”
            (typ wykrywany automatycznie z nagłówka).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Uwaga: ponowny import tego samego pliku <strong>zdubluje dane</strong>.
            Aby poprawić już zaimportowane dane, najpierw cofnij poprzednią partię
            w „Historii importów”, a dopiero potem importuj plik ponownie.
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rw-csv-file">Plik CSV</Label>
            <Input
              id="rw-csv-file"
              type="file"
              accept=".csv,text/csv"
              disabled={pending}
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
          </div>

          {preview && isFormatError(preview) && (
            <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
              {preview.formatError}
            </div>
          )}

          {parsed && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Wykryty typ:</span>
                <StatusBadge tone={parsed.kind === "PRZYCHOD" ? "green" : "red"}>
                  {parsed.kind === "PRZYCHOD" ? "Przychody" : "Koszty"}
                </StatusBadge>
                <span className="tabular-nums">
                  {rowCount} {pluralPl(rowCount, "wiersz", "wiersze", "wierszy")} OK
                </span>
                {parsed.skippedEmpty > 0 && (
                  <span className="text-xs text-muted-foreground">
                    (pominięto {parsed.skippedEmpty}{" "}
                    {pluralPl(parsed.skippedEmpty, "pusty wiersz", "puste wiersze", "pustych wierszy")})
                  </span>
                )}
              </div>

              {parsed.errors.length > 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                  <p className="text-sm font-medium">
                    {parsed.errors.length}{" "}
                    {pluralPl(parsed.errors.length, "błąd", "błędy", "błędów")} — import zablokowany
                  </p>
                  <IssueList issues={parsed.errors} />
                  <p className="mt-1.5 text-xs">
                    Import wymaga poprawienia pliku: usuń lub popraw błędne wiersze
                    w źródle, a następnie wybierz plik ponownie.
                  </p>
                </div>
              )}

              {parsed.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <p className="text-sm font-medium">
                    {parsed.warnings.length}{" "}
                    {pluralPl(parsed.warnings.length, "ostrzeżenie", "ostrzeżenia", "ostrzeżeń")}{" "}
                    (nie blokują importu)
                  </p>
                  <IssueList issues={parsed.warnings} />
                </div>
              )}

              {parsed.errors.length === 0 && rowCount === 0 && (
                <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                  Plik nie zawiera żadnych wierszy z danymi.
                </div>
              )}

              {monthSums.length > 0 && (
                <div className="rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Suma per miesiąc — sprawdź zgodność z arkuszem przed importem
                  </p>
                  <div className="mt-1.5 space-y-0.5">
                    {monthSums.map(([month, sumGr]) => (
                      <div
                        key={month}
                        className="flex items-baseline justify-between gap-4 text-sm"
                      >
                        <span className="text-muted-foreground">
                          {RW_MONTH_LABELS[month - 1]}
                        </span>
                        <span
                          className={
                            "font-medium tabular-nums" +
                            (sumGr < 0 ? " text-red-600 dark:text-red-400" : "")
                          }
                        >
                          {formatZl(sumGr)}
                        </span>
                      </div>
                    ))}
                    <div className="flex items-baseline justify-between gap-4 border-t pt-1 text-sm">
                      <span className="font-medium">Razem</span>
                      <span
                        className={
                          "font-semibold tabular-nums" +
                          (totalGr < 0 ? " text-red-600 dark:text-red-400" : "")
                        }
                      >
                        {formatZl(totalGr)}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Anuluj
            </Button>
          </DialogClose>
          <Button onClick={handleImport} disabled={!canImport || pending}>
            {pending
              ? "Importowanie…"
              : canImport
                ? `Importuj (${rowCount} ${pluralPl(rowCount, "wiersz", "wiersze", "wierszy")})`
                : "Importuj"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
