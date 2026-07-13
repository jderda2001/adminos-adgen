"use client";

// Import CSV rachunku wyników — trzy kroki:
//   1) wybór pliku (parsowanie LOKALNE, wykrycie typu, błędy struktury)
//   2) PRZEGLĄD: kategorie przypisane automatycznie (kontrahent/opis → kategoria),
//      każda operacja edytowalna w dropdownie; niepewne oznaczone „do sprawdzenia"
//   3) zatwierdzenie → commitRwReviewAction (serwer waliduje każde pole)
//
// Kategorie decydowane są u klienta, więc do zatwierdzenia wysyłamy wiersze
// (nie plik). Serwer waliduje miesiąc, kwotę i przynależność kategorii.

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Upload, ArrowLeft, Wand2, AlertTriangle } from "lucide-react";
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
import { parseRwCsv, type RwParseResult, type RwParseIssue } from "@/lib/rw-parse";
import { suggestCategory, type PersonRule } from "@/lib/rw-categorize";
import {
  RW_CATEGORIES,
  RW_BUCKET_LABELS,
  RW_MONTH_LABELS,
  type RwBucket,
  type RwKind,
} from "@/lib/rw-types";
import { pluralPl } from "@/lib/format";
import { formatZl } from "./rw-format";
import { commitRwReviewAction, type RwReviewRow } from "./actions";
import { cn } from "@/lib/utils";

const MAX_ISSUES_SHOWN = 10;
const RW_MONTH_SHORT = [
  "sty", "lut", "mar", "kwi", "maj", "cze",
  "lip", "sie", "wrz", "paź", "lis", "gru",
];

type Preview = RwParseResult | { formatError: string };
function isFormatError(p: Preview): p is { formatError: string } {
  return "formatError" in p;
}

/** opcje kategorii pogrupowane sekcjami arkusza (do dropdownu) */
function categoryGroups(kind: RwKind) {
  const cats = RW_CATEGORIES.filter((c) => c.kind === kind);
  const buckets = [...new Set(cats.map((c) => c.bucket))] as RwBucket[];
  return buckets.map((b) => ({
    label: RW_BUCKET_LABELS[b],
    items: cats.filter((c) => c.bucket === b).map((c) => c.name),
  }));
}

interface ReviewRow {
  month: number;
  description: string | null;
  contractor: string | null;
  bank: string | null;
  note: string | null;
  amountGr: number;
  category: string; // "" = do wyboru
  source: "csv" | "auto"; // skąd wzięła się kategoria
  confidence: "high" | "medium" | "low";
}

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
  peopleRules = [],
}: {
  year: number;
  trigger?: ReactNode;
  peopleRules?: PersonRule[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"select" | "review">("select");
  const [fileName, setFileName] = useState("");
  const [kind, setKind] = useState<RwKind>("KOSZT");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();
  const parseToken = useRef(0);

  const parsed = preview && !isFormatError(preview) ? preview : null;
  const parsedCount = parsed?.entries.length ?? 0;
  const canProceed =
    parsed !== null && parsed.errors.length === 0 && parsedCount > 0;

  const groups = useMemo(() => categoryGroups(kind), [kind]);

  // statystyki przeglądu
  const stats = useMemo(() => {
    let auto = 0;
    let toCheck = 0;
    let missing = 0;
    for (const r of rows) {
      if (r.source === "auto") auto++;
      if (r.category === "") missing++;
      else if (r.source === "auto" && r.confidence !== "high") toCheck++;
    }
    return { auto, toCheck, missing };
  }, [rows]);

  const monthSums = useMemo(() => {
    const sums = new Map<number, number>();
    for (const r of rows) sums.set(r.month, (sums.get(r.month) ?? 0) + r.amountGr);
    return [...sums.entries()].sort((a, b) => a[0] - b[0]);
  }, [rows]);

  function reset() {
    parseToken.current++;
    setStep("select");
    setFileName("");
    setRows([]);
    setPreview(null);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) reset();
  }

  async function handleFileChange(f: File | null) {
    const token = ++parseToken.current;
    setFileName(f?.name ?? "");
    setPreview(null);
    if (!f) return;
    try {
      const text = await f.text();
      if (token !== parseToken.current) return;
      setPreview(parseRwCsv(text));
    } catch {
      if (token !== parseToken.current) return;
      setPreview({ formatError: "Nie udało się odczytać pliku — spróbuj ponownie." });
    }
  }

  function proceedToReview() {
    if (!parsed || !canProceed) return;
    setKind(parsed.kind);
    // przypisz kategorie: z pliku jeśli były, inaczej propozycja automatyczna
    const built: ReviewRow[] = parsed.entries.map((e) => {
      if (e.category) {
        return {
          month: e.month,
          description: e.description,
          contractor: e.contractor,
          bank: e.bank,
          note: e.note,
          amountGr: e.amountGr,
          category: e.category,
          source: "csv",
          confidence: "high",
        };
      }
      const s = suggestCategory(
        e.kind,
        { description: e.description, contractor: e.contractor },
        peopleRules
      );
      return {
        month: e.month,
        description: e.description,
        contractor: e.contractor,
        bank: e.bank,
        note: e.note,
        amountGr: e.amountGr,
        category: s.category ?? "",
        source: "auto",
        confidence: s.confidence,
      };
    });
    setRows(built);
    setStep("review");
  }

  function setRowCategory(index: number, category: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, category, source: "csv", confidence: "high" } : r
      )
    );
  }

  function handleCommit() {
    if (stats.missing > 0) {
      toast.error("Uzupełnij kategorie dla wszystkich operacji");
      return;
    }
    const payload: RwReviewRow[] = rows.map((r) => ({
      month: r.month,
      category: r.category,
      amountGr: r.amountGr,
      description: r.description,
      contractor: r.contractor,
      bank: r.bank,
      note: r.note,
    }));
    startTransition(async () => {
      const result = await commitRwReviewAction({
        year,
        kind,
        filename: fileName,
        rows: payload,
      });
      if (result.ok) {
        const monthNames = result.months.map((m) => RW_MONTH_LABELS[m - 1]).join(", ");
        toast.success(
          `Zatwierdzono ${result.imported} ${pluralPl(result.imported, "operację", "operacje", "operacji")}` +
            (monthNames ? ` — ${monthNames}` : "")
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
      <DialogContent
        className={cn(
          "flex max-h-[90vh] flex-col",
          step === "review" ? "sm:max-w-3xl" : "sm:max-w-lg"
        )}
      >
        <DialogHeader>
          <DialogTitle>
            {step === "select"
              ? "Import CSV — rachunek wyników"
              : "Sprawdź przypisane kategorie"}
          </DialogTitle>
          <DialogDescription>
            {step === "select" ? (
              <>
                Import zapisze dane do roku{" "}
                <span className="font-medium text-foreground">{year}</span>.
                Obsługiwane pliki: przychody lub koszty z arkusza „Rachunek
                wyników” (typ wykrywany automatycznie z nagłówka).
              </>
            ) : (
              <>
                Kategorie przypisane automatycznie na podstawie kontrahenta i
                opisu. Sprawdź i popraw w razie potrzeby — zatwierdzenie zapisze
                dane do roku{" "}
                <span className="font-medium text-foreground">{year}</span>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Uwaga: ponowny import tego samego pliku <strong>zdubluje dane</strong>.
              Aby poprawić już zaimportowane dane, najpierw cofnij poprzednią
              partię w „Historii importów”.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rw-csv-file">Plik CSV</Label>
              <Input
                id="rw-csv-file"
                type="file"
                accept=".csv,text/csv"
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
                    {parsedCount}{" "}
                    {pluralPl(parsedCount, "operacja", "operacje", "operacji")}
                  </span>
                </div>

                {parsed.errors.length > 0 && (
                  <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                    <p className="text-sm font-medium">
                      {parsed.errors.length}{" "}
                      {pluralPl(parsed.errors.length, "błąd", "błędy", "błędów")} — import zablokowany
                    </p>
                    <IssueList issues={parsed.errors} />
                    <p className="mt-1.5 text-xs">
                      Popraw błędne wiersze w źródle i wybierz plik ponownie.
                    </p>
                  </div>
                )}

                {parsed.errors.length === 0 && parsedCount === 0 && (
                  <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                    Plik nie zawiera żadnych wierszy z danymi.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === "review" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge tone={kind === "PRZYCHOD" ? "green" : "red"}>
                {kind === "PRZYCHOD" ? "Przychody" : "Koszty"}
              </StatusBadge>
              <span className="tabular-nums text-muted-foreground">
                {rows.length}{" "}
                {pluralPl(rows.length, "operacja", "operacje", "operacji")}
              </span>
              {stats.toCheck > 0 && (
                <StatusBadge tone="amber">
                  <AlertTriangle className="size-3" /> {stats.toCheck} do sprawdzenia
                </StatusBadge>
              )}
              {stats.missing > 0 && (
                <StatusBadge tone="red">
                  {stats.missing} bez kategorii
                </StatusBadge>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Wand2 className="size-3" /> {stats.auto} przypisano automatycznie
              </span>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                    <th className="w-10">Mc</th>
                    <th>Operacja</th>
                    <th className="w-24 text-right">Kwota</th>
                    <th className="w-64">Kategoria</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const needsCheck =
                      r.category === "" ||
                      (r.source === "auto" && r.confidence !== "high");
                    return (
                      <tr
                        key={i}
                        className={cn(
                          "border-t align-top",
                          needsCheck && "bg-amber-50/60 dark:bg-amber-950/20"
                        )}
                      >
                        <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">
                          {RW_MONTH_SHORT[r.month - 1]}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="max-w-[280px] truncate font-medium">
                            {r.contractor || r.description || "—"}
                          </div>
                          {r.contractor && r.description && (
                            <div className="max-w-[280px] truncate text-xs text-muted-foreground">
                              {r.description}
                            </div>
                          )}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums",
                            r.amountGr < 0 && "text-red-600 dark:text-red-400"
                          )}
                        >
                          {formatZl(r.amountGr)}
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            value={r.category}
                            onValueChange={(v) => setRowCategory(i, v)}
                          >
                            <SelectTrigger
                              size="sm"
                              className={cn(
                                "w-full",
                                r.category === "" &&
                                  "border-red-400 text-muted-foreground"
                              )}
                            >
                              <SelectValue placeholder="wybierz kategorię…" />
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
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {monthSums.map(([month, sumGr]) => (
                <span key={month} className="tabular-nums">
                  {RW_MONTH_LABELS[month - 1]}:{" "}
                  <span
                    className={cn(
                      "font-medium text-foreground",
                      sumGr < 0 && "text-red-600 dark:text-red-400"
                    )}
                  >
                    {formatZl(sumGr)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        <DialogFooter>
          {step === "select" ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
              >
                Anuluj
              </Button>
              <Button onClick={proceedToReview} disabled={!canProceed}>
                Dalej: sprawdź kategorie
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => setStep("select")}
                disabled={pending}
              >
                <ArrowLeft data-icon="inline-start" /> Wstecz
              </Button>
              <Button onClick={handleCommit} disabled={pending || stats.missing > 0}>
                {pending
                  ? "Zapisywanie…"
                  : `Zatwierdź import (${rows.length})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
