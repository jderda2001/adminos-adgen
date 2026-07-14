"use client";

// Import CSV rachunku wyników — dwa źródła, wykrywane automatycznie:
//
//   • WYCIĄGI mBank (surowy eksport „Lista operacji") — można wgrać WIELE
//     plików naraz (po jednym na konto) albo jeden obejmujący wszystkie konta.
//     Tool scala pliki, usuwa dokładne duplikaty operacji i wykrywa PRZELEWY
//     WŁASNE między kontami adGen (domyślnie pomijane — obie nogi; wyjątki:
//     oszczędności / zaliczka CIT / premie → koszt w momencie przelewu).
//     Porównuje też konta z poprzednimi importami („brakuje konta X").
//   • Arkusz „Rachunek wyników" (kolumny Miesiąc/Kategoria/Netto) — pojedynczo.
//
// Krok 1: wybór plików (parsowanie LOKALNE). Krok 2: PRZEGLĄD — kategorie
// edytowalne, podział operacji, sekcja pominiętych przelewów własnych
// z możliwością przywrócenia. Krok 3: zatwierdzenie → walidacja serwerowa.

import { useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Upload,
  ArrowLeft,
  Wand2,
  AlertTriangle,
  Split,
  Undo2,
  ArrowLeftRight,
} from "lucide-react";
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
import { parseMbankCsv, type BankAccount } from "@/lib/bank-parse";
import {
  classifyBankRow,
  mergeBankFiles,
  DEFAULT_SELF_NAMES,
  type InternalRulesConfig,
  type MergedBankRow,
} from "@/lib/rw-internal";
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
import {
  commitRwReviewAction,
  commitRwBankReviewAction,
  type RwReviewRow,
  type RwBankReviewRow,
} from "./actions";
import { cn } from "@/lib/utils";

const MAX_ISSUES_SHOWN = 10;
const RW_MONTH_SHORT = [
  "sty", "lut", "mar", "kwi", "maj", "cze",
  "lip", "sie", "wrz", "paź", "lis", "gru",
];

type Parsed =
  | {
      mode: "bank";
      rows: MergedBankRow[];
      accounts: BankAccount[];
      duplicates: number;
      skippedNonTx: number;
      files: string[];
    }
  | { mode: "sheet"; sheet: RwParseResult; filename: string };
type Preview = Parsed | { formatError: string };

function isFormatError(p: Preview): p is { formatError: string } {
  return "formatError" in p;
}

/** opcje kategorii pogrupowane sekcjami arkusza (do dropdownu), per kierunek */
function categoryGroups(kind: RwKind) {
  const cats = RW_CATEGORIES.filter((c) => c.kind === kind);
  const buckets = [...new Set(cats.map((c) => c.bucket))] as RwBucket[];
  return buckets.map((b) => ({
    label: RW_BUCKET_LABELS[b],
    items: cats.filter((c) => c.bucket === b).map((c) => c.name),
  }));
}

interface ReviewRow {
  kind: RwKind;
  month: number;
  dateISO: string | null;
  description: string | null;
  contractor: string | null;
  bank: string | null;
  note: string | null;
  amountGr: number; // kwota ze znakiem — to trafia do bazy
  category: string; // "" = do wyboru
  source: "csv" | "auto";
  confidence: "high" | "medium" | "low";
  /** operacja rozpoznana jako przelew własny (zostawiona: odłożone środki / przywrócona) */
  internal: boolean;
  sourceFile: string | null;
  // podział jednej operacji na kategorie
  splitId: number | null;
  splitRole: "a" | "b" | null;
}

/** pominięty przelew własny (do wglądu / przywrócenia) */
interface SkippedRow {
  row: MergedBankRow;
  reason: string;
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
  internalRules = { selfNames: DEFAULT_SELF_NAMES, accounts: [] },
  knownAccounts = [],
}: {
  year: number;
  trigger?: ReactNode;
  peopleRules?: PersonRule[];
  internalRules?: InternalRulesConfig;
  knownAccounts?: BankAccount[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"select" | "review">("select");
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<"bank" | "sheet">("bank");
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, startTransition] = useTransition();
  const parseToken = useRef(0);
  const splitCounter = useRef(0);
  const splitOriginals = useRef<Map<number, ReviewRow>>(new Map());

  const groupsByKind = useMemo(
    () => ({ PRZYCHOD: categoryGroups("PRZYCHOD"), KOSZT: categoryGroups("KOSZT") }),
    []
  );

  const previewCount = useMemo(() => {
    if (!preview || isFormatError(preview)) return 0;
    return preview.mode === "bank" ? preview.rows.length : preview.sheet.entries.length;
  }, [preview]);

  const sheetErrors =
    preview && !isFormatError(preview) && preview.mode === "sheet"
      ? preview.sheet.errors
      : [];

  // brakujące konta względem poprzednich importów (kontrola kompletności)
  const missingAccounts = useMemo(() => {
    if (!preview || isFormatError(preview) || preview.mode !== "bank") return [];
    if (preview.accounts.length === 0) return []; // preambuła bez kont — nie oceniamy
    const uploaded = new Set(preview.accounts.map((a) => a.number));
    return knownAccounts.filter((a) => !uploaded.has(a.number));
  }, [preview, knownAccounts]);

  const canProceed =
    preview !== null &&
    !isFormatError(preview) &&
    previewCount > 0 &&
    (preview.mode === "bank" || preview.sheet.errors.length === 0);

  const stats = useMemo(() => {
    let auto = 0;
    let toCheck = 0;
    let missing = 0;
    let revenueGr = 0;
    let costGr = 0;
    for (const r of rows) {
      if (r.source === "auto") auto++;
      if (r.category === "") missing++;
      else if (r.source === "auto" && r.confidence !== "high") toCheck++;
      if (r.kind === "PRZYCHOD") revenueGr += r.amountGr;
      else costGr += r.amountGr;
    }
    return { auto, toCheck, missing, revenueGr, costGr };
  }, [rows]);

  const skippedSumGr = useMemo(
    () => skipped.reduce((s, x) => s + x.row.amountGr, 0),
    [skipped]
  );

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
    setSkipped([]);
    setShowSkipped(false);
    setAccounts([]);
    setPreview(null);
    setMode("bank");
    splitOriginals.current.clear();
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (!next) reset();
  }

  async function handleFilesChange(list: FileList | null) {
    const token = ++parseToken.current;
    const files = list ? [...list] : [];
    setFileName(files.map((f) => f.name).join(" + "));
    setPreview(null);
    if (files.length === 0) return;
    try {
      const texts = await Promise.all(files.map((f) => f.text()));
      if (token !== parseToken.current) return;

      const bankFiles: { filename: string; rows: MergedBankRow[]; accounts: BankAccount[] }[] = [];
      const notBank: { name: string; text: string }[] = [];
      let skippedNonTx = 0;
      for (let i = 0; i < files.length; i++) {
        const mb = parseMbankCsv(texts[i]);
        if (!("formatError" in mb) && mb.rows.length > 0) {
          bankFiles.push({
            filename: files[i].name,
            rows: mb.rows.map((r) => ({ ...r, sourceFile: files[i].name })),
            accounts: mb.accounts,
          });
          skippedNonTx += mb.skipped.length;
        } else {
          notBank.push({ name: files[i].name, text: texts[i] });
        }
      }

      if (bankFiles.length > 0) {
        if (notBank.length > 0) {
          setPreview({
            formatError: `Nie rozpoznano jako wyciąg mBank: ${notBank
              .map((f) => f.name)
              .join(", ")} — wgraj wyciągi razem, arkusz RW osobno.`,
          });
          return;
        }
        const merged = mergeBankFiles(bankFiles);
        setPreview({
          mode: "bank",
          rows: merged.rows,
          accounts: merged.accounts,
          duplicates: merged.duplicates,
          skippedNonTx,
          files: files.map((f) => f.name),
        });
        return;
      }

      // nie-bank: arkusz RW (tylko pojedynczo)
      if (notBank.length > 1) {
        setPreview({
          formatError:
            "Arkusz „Rachunek wyników” wgrywaj pojedynczo (wiele plików naraz działa dla wyciągów mBank).",
        });
        return;
      }
      const sh = parseRwCsv(notBank[0].text);
      if (!("formatError" in sh)) {
        setPreview({ mode: "sheet", sheet: sh, filename: notBank[0].name });
        return;
      }
      setPreview({
        formatError:
          "Nierozpoznany plik. Wgraj surowy wyciąg mBank (CSV „Lista operacji”) " +
          "albo arkusz „Rachunek wyników” (kolumny Miesiąc/Kategoria/Netto).",
      });
    } catch {
      if (token !== parseToken.current) return;
      setPreview({ formatError: "Nie udało się odczytać plików — spróbuj ponownie." });
    }
  }

  function proceedToReview() {
    if (!preview || isFormatError(preview) || !canProceed) return;
    setMode(preview.mode);

    if (preview.mode === "bank") {
      // własne konta: preambuły wgranych plików + poprzednie importy
      const ownNumbers = [
        ...preview.accounts.map((a) => a.number),
        ...knownAccounts.map((a) => a.number),
      ];
      const main: ReviewRow[] = [];
      const skip: SkippedRow[] = [];
      const multiFile = preview.files.length > 1;
      for (const e of preview.rows) {
        const verdict = classifyBankRow(e, internalRules, ownNumbers);
        if (verdict.internal && verdict.category === null) {
          skip.push({ row: e, reason: verdict.reason });
          continue;
        }
        if (verdict.internal && verdict.category !== null) {
          // odłożone środki — koszt w momencie przelewu (do sprawdzenia w przeglądzie)
          main.push({
            kind: e.kind,
            month: e.month,
            dateISO: e.dateISO,
            description: e.description || null,
            contractor: null,
            bank: "mBank",
            note: null,
            amountGr: e.amountGr,
            category: verdict.category,
            source: "auto",
            confidence: "medium",
            internal: true,
            sourceFile: multiFile ? e.sourceFile : null,
            splitId: null,
            splitRole: null,
          });
          continue;
        }
        const s = suggestCategory(e.kind, { description: e.description }, peopleRules);
        main.push({
          kind: e.kind,
          month: e.month,
          dateISO: e.dateISO,
          description: e.description || null,
          contractor: null,
          bank: "mBank",
          note: null,
          amountGr: e.amountGr,
          category: s.category ?? "",
          source: "auto",
          confidence: s.confidence,
          internal: false,
          sourceFile: multiFile ? e.sourceFile : null,
          splitId: null,
          splitRole: null,
        });
      }
      setRows(main);
      setSkipped(skip);
      setAccounts(preview.accounts);
    } else {
      const sheet = preview.sheet;
      const built: ReviewRow[] = sheet.entries.map((e) => {
        const base = {
          kind: sheet.kind,
          month: e.month,
          dateISO: null,
          description: e.description,
          contractor: e.contractor,
          bank: e.bank,
          note: e.note,
          amountGr: e.amountGr,
          internal: false,
          sourceFile: null,
          splitId: null,
          splitRole: null,
        } as const;
        if (e.category) {
          return { ...base, category: e.category, source: "csv", confidence: "high" };
        }
        const s = suggestCategory(sheet.kind, {
          description: e.description,
          contractor: e.contractor,
        }, peopleRules);
        return { ...base, category: s.category ?? "", source: "auto", confidence: s.confidence };
      });
      setRows(built);
      setSkipped([]);
      setAccounts([]);
    }
    setStep("review");
  }

  function setRowCategory(index: number, category: string) {
    setRows((prev) =>
      prev.map((r, i) =>
        i === index ? { ...r, category, source: "csv", confidence: "high" } : r
      )
    );
  }

  /** przywraca pominięty przelew własny do listy (kategoria do wyboru) */
  function restoreSkipped(index: number) {
    setSkipped((prev) => {
      const s = prev[index];
      if (!s) return prev;
      setRows((rows) => [
        {
          kind: s.row.kind,
          month: s.row.month,
          dateISO: s.row.dateISO,
          description: s.row.description || null,
          contractor: null,
          bank: "mBank",
          note: null,
          amountGr: s.row.amountGr,
          category: "",
          source: "auto",
          confidence: "low",
          internal: true,
          sourceFile: s.row.sourceFile ?? null,
          splitId: null,
          splitRole: null,
        },
        ...rows,
      ]);
      return prev.filter((_, i) => i !== index);
    });
  }

  function splitRow(index: number) {
    setRows((prev) => {
      const r = prev[index];
      if (!r || r.splitId !== null || Math.abs(r.amountGr) < 2) return prev;
      const id = ++splitCounter.current;
      splitOriginals.current.set(id, r);
      const half = Math.round(r.amountGr / 2);
      const base = { ...r, splitId: id, source: "csv" as const, confidence: "high" as const };
      const partA: ReviewRow = { ...base, amountGr: half, splitRole: "a" };
      const partB: ReviewRow = { ...base, amountGr: r.amountGr - half, splitRole: "b" };
      return [...prev.slice(0, index), partA, partB, ...prev.slice(index + 1)];
    });
  }

  function mergeSplit(splitId: number) {
    const orig = splitOriginals.current.get(splitId);
    setRows((prev) => {
      const out: ReviewRow[] = [];
      let done = false;
      for (const r of prev) {
        if (r.splitId === splitId) {
          if (!done) {
            out.push(orig ?? { ...r, splitId: null, splitRole: null });
            done = true;
          }
        } else out.push(r);
      }
      return out;
    });
    splitOriginals.current.delete(splitId);
  }

  function setSplitNet(splitId: number, absGr: number) {
    const orig = splitOriginals.current.get(splitId);
    if (!orig) return;
    const total = orig.amountGr;
    const sign = total < 0 ? -1 : 1;
    const mag = Math.min(Math.abs(total) - 1, Math.max(1, Math.round(Math.abs(absGr))));
    const a = sign * mag;
    const b = total - a;
    setRows((prev) =>
      prev.map((r) =>
        r.splitId === splitId
          ? { ...r, amountGr: r.splitRole === "a" ? a : b }
          : r
      )
    );
  }

  function handleCommit() {
    if (stats.missing > 0) {
      toast.error("Uzupełnij kategorie dla wszystkich operacji");
      return;
    }
    startTransition(async () => {
      const result =
        mode === "bank"
          ? await commitRwBankReviewAction({
              year,
              filename: fileName,
              accounts,
              rows: rows.map<RwBankReviewRow>((r) => ({
                kind: r.kind,
                month: r.month,
                category: r.category,
                amountGr: r.amountGr,
                description: r.description,
                note: r.note,
                dateISO: r.dateISO,
              })),
            })
          : await commitRwReviewAction({
              year,
              kind: rows[0]?.kind ?? "KOSZT",
              filename: fileName,
              rows: rows.map<RwReviewRow>((r) => ({
                month: r.month,
                category: r.category,
                amountGr: r.amountGr,
                description: r.description,
                contractor: r.contractor,
                bank: r.bank,
                note: r.note,
              })),
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

  const isBank = mode === "bank";

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
              : "Sprawdź operacje przed zatwierdzeniem"}
          </DialogTitle>
          <DialogDescription>
            {step === "select" ? (
              <>
                Wgraj <span className="font-medium text-foreground">wyciągi mBank</span>{" "}
                (można kilka naraz — po jednym na konto) albo arkusz „Rachunek
                wyników”. Import zapisze dane do roku{" "}
                <span className="font-medium text-foreground">{year}</span>.
              </>
            ) : isBank ? (
              <>
                Przelewy między kontami adGen zostały{" "}
                <span className="font-medium text-foreground">wykryte i pominięte</span>{" "}
                (poza odłożonymi środkami). Sprawdź kategorie; operację można{" "}
                <span className="font-medium text-foreground">podzielić</span> na dwie
                kategorie.
              </>
            ) : (
              <>
                Kategorie przypisane automatycznie. Sprawdź i popraw — zatwierdzenie
                zapisze dane do roku{" "}
                <span className="font-medium text-foreground">{year}</span>.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4 overflow-y-auto">
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Uwaga: ponowny import tych samych plików <strong>zdubluje dane</strong>.
              Aby poprawić już zaimportowane dane, najpierw cofnij poprzednią
              partię w „Historii importów”.
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rw-csv-file">Pliki CSV (wyciągi — można kilka)</Label>
              <Input
                id="rw-csv-file"
                type="file"
                accept=".csv,text/csv"
                multiple
                onChange={(e) => handleFilesChange(e.target.files)}
              />
            </div>

            {preview && isFormatError(preview) && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                {preview.formatError}
              </div>
            )}

            {preview && !isFormatError(preview) && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">Wykryto:</span>
                  {preview.mode === "bank" ? (
                    <StatusBadge tone="blue">
                      Wyciąg mBank{preview.files.length > 1 ? ` × ${preview.files.length}` : ""}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone={preview.sheet.kind === "PRZYCHOD" ? "green" : "red"}>
                      Arkusz — {preview.sheet.kind === "PRZYCHOD" ? "Przychody" : "Koszty"}
                    </StatusBadge>
                  )}
                  <span className="tabular-nums">
                    {previewCount} {pluralPl(previewCount, "operacja", "operacje", "operacji")}
                  </span>
                </div>

                {preview.mode === "bank" && preview.accounts.length > 0 && (
                  <div className="rounded-lg border px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Konta w wyciągach:</span>{" "}
                    {preview.accounts
                      .map((a) => `${a.name || "konto"} (…${a.number.slice(-4)})`)
                      .join(", ")}
                  </div>
                )}

                {missingAccounts.length > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    <span className="font-medium">
                      Brakuje {missingAccounts.length}{" "}
                      {pluralPl(missingAccounts.length, "konta", "kont", "kont")} względem
                      poprzednich importów:
                    </span>{" "}
                    {missingAccounts
                      .map((a) => `${a.name || "konto"} (…${a.number.slice(-4)})`)
                      .join(", ")}
                    . Jeśli to celowe — kontynuuj; jeśli nie, dołącz brakujące wyciągi.
                  </div>
                )}

                {preview.mode === "bank" && preview.duplicates > 0 && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                    Pominięto {preview.duplicates}{" "}
                    {pluralPl(preview.duplicates, "zdublowaną operację", "zdublowane operacje", "zdublowanych operacji")}{" "}
                    (te same operacje w kilku plikach).
                  </div>
                )}

                {sheetErrors.length > 0 && (
                  <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
                    <p className="text-sm font-medium">
                      {sheetErrors.length}{" "}
                      {pluralPl(sheetErrors.length, "błąd", "błędy", "błędów")} — import zablokowany
                    </p>
                    <IssueList issues={sheetErrors} />
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
                {rows.length} {pluralPl(rows.length, "operacja", "operacje", "operacji")}
              </span>
              {stats.toCheck > 0 && (
                <StatusBadge tone="amber">
                  <AlertTriangle className="size-3" /> {stats.toCheck} do sprawdzenia
                </StatusBadge>
              )}
              {stats.missing > 0 && (
                <StatusBadge tone="red">{stats.missing} bez kategorii</StatusBadge>
              )}
              {skipped.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSkipped((v) => !v)}
                  className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                >
                  <ArrowLeftRight className="size-3" />
                  {skipped.length} przelewów własnych pominięto
                  <span className="text-muted-foreground/60">
                    ({showSkipped ? "ukryj" : "pokaż"})
                  </span>
                </button>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Wand2 className="size-3" /> {stats.auto} przypisano automatycznie
              </span>
            </div>

            {showSkipped && skipped.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30">
                <div className="flex items-center justify-between px-3 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <span>Pominięte przelewy własne</span>
                  <span className="tabular-nums">suma: {formatZl(skippedSumGr)}</span>
                </div>
                {skipped.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 border-t px-3 py-1 text-xs"
                  >
                    <span className="text-muted-foreground tabular-nums">
                      {RW_MONTH_SHORT[s.row.month - 1]}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.row.description}</span>
                    <span className="text-muted-foreground">{s.reason}</span>
                    <span
                      className={cn(
                        "w-20 text-right tabular-nums",
                        s.row.amountGr < 0 && "text-red-600 dark:text-red-400"
                      )}
                    >
                      {formatZl(s.row.amountGr)}
                    </span>
                    <button
                      type="button"
                      onClick={() => restoreSkipped(i)}
                      className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted"
                    >
                      Przywróć
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-muted/95 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur">
                  <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left">
                    <th className="w-9">Mc</th>
                    <th>Operacja</th>
                    <th className="w-28 text-right">Kwota</th>
                    <th className="w-60">Kategoria</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const needsCheck =
                      r.category === "" ||
                      (r.source === "auto" && r.confidence !== "high");
                    const isSplit = r.splitId !== null;
                    return (
                      <tr
                        key={isSplit ? `s${r.splitId}-${r.splitRole}` : `r${i}`}
                        className={cn(
                          "border-t align-top",
                          needsCheck && "bg-amber-50/60 dark:bg-amber-950/20",
                          isSplit && "bg-accent/5"
                        )}
                      >
                        <td className="px-2 py-1.5 text-xs text-muted-foreground tabular-nums">
                          {r.splitRole === "b" ? "" : RW_MONTH_SHORT[r.month - 1]}
                        </td>
                        <td className="px-2 py-1.5">
                          <div className={cn("flex items-center gap-1.5", isSplit && "pl-3")}>
                            {isBank && !isSplit && (
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
                            )}
                            {r.internal && !isSplit && (
                              <span
                                title="przelew własny (między kontami adGen)"
                                className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                              >
                                własny
                              </span>
                            )}
                            {isSplit && <span className="shrink-0 text-muted-foreground">↳</span>}
                            <span className="min-w-0 flex-1">
                              <span className="block max-w-[240px] truncate font-medium">
                                {r.description || r.contractor || "—"}
                              </span>
                              {r.sourceFile && (
                                <span className="block max-w-[240px] truncate text-[10px] text-muted-foreground">
                                  {r.sourceFile}
                                </span>
                              )}
                            </span>
                            {isBank && !isSplit && (
                              <button
                                type="button"
                                onClick={() => splitRow(i)}
                                title="Podziel operację na dwie kategorie"
                                className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <Split className="size-3.5" />
                              </button>
                            )}
                            {isSplit && r.splitRole === "a" && (
                              <button
                                type="button"
                                onClick={() => mergeSplit(r.splitId as number)}
                                title="Scal podział z powrotem w jedną operację"
                                className="ml-1 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                              >
                                <Undo2 className="size-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1.5 text-right tabular-nums font-medium",
                            r.amountGr < 0 && "text-red-600 dark:text-red-400"
                          )}
                        >
                          {isSplit && r.splitRole === "a" ? (
                            <input
                              key={`net-${r.splitId}`}
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={(Math.abs(r.amountGr) / 100).toFixed(2)}
                              onChange={(e) =>
                                setSplitNet(
                                  r.splitId as number,
                                  Math.round(parseFloat(e.target.value || "0") * 100)
                                )
                              }
                              className="w-24 rounded-md border border-input bg-background px-1.5 py-0.5 text-right tabular-nums focus:border-ring focus:outline-none"
                            />
                          ) : (
                            formatZl(r.amountGr)
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          <Select value={r.category} onValueChange={(v) => setRowCategory(i, v)}>
                            <SelectTrigger
                              size="sm"
                              className={cn(
                                "w-full",
                                r.category === "" && "border-red-400 text-muted-foreground"
                              )}
                            >
                              <SelectValue placeholder="wybierz kategorię…" />
                            </SelectTrigger>
                            <SelectContent>
                              {groupsByKind[r.kind].map((g) => (
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
              {isBank && (
                <>
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
                  <span className="text-muted-foreground/60">·</span>
                </>
              )}
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
              <Button variant="outline" onClick={() => handleOpenChange(false)}>
                Anuluj
              </Button>
              <Button onClick={proceedToReview} disabled={!canProceed}>
                Dalej: sprawdź operacje
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep("select")} disabled={pending}>
                <ArrowLeft data-icon="inline-start" /> Wstecz
              </Button>
              <Button onClick={handleCommit} disabled={pending || stats.missing > 0}>
                {pending ? "Zapisywanie…" : `Zatwierdź import (${rows.length})`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
