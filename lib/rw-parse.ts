// Parser CSV rachunku wyników — formaty plików adGen:
//
//   Przychody: Miesiąc,Klient,Przychód netto,Typ Przychodu,NestBank / mBank,Opis
//   Koszty:    Miesiąc,Opis,Netto,Kategoria,NestBank / mBank,Brutto,Kontrahent,Uwagi
//
// Czyste funkcje (bez bazy/serwera) — testowane jednostkowo, w tym „złotym
// testem" na realnych plikach porównującym wynik z arkuszem Google.

import { findRwCategory, type RwKind } from "./rw-types";

// ── CSV (RFC 4180: cudzysłowy, przecinki i nowe linie w polach) ──────

export function parseCsv(text: string, delimiter = ","): string[][] {
  // usuń BOM
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── Kwoty i miesiące ─────────────────────────────────────────────────

/**
 * Kwota z CSV → grosze (Int, ze znakiem). Obsługiwane warianty spotykane
 * w plikach: "1 459,00 zł", "-2 667,00 zł", "257,3", "861", "3 250,00",
 * spacje zwykłe i twarde (NBSP/narrow NBSP). Zwraca null dla nie-kwot.
 */
export function parseRwAmountGr(raw: string): number | null {
  const cleaned = raw
    .replace(/[\s  ]/g, "")
    .replace(/zł|PLN/gi, "")
    .replace(",", ".")
    .trim();
  if (cleaned === "" || cleaned === "-") return null;
  // maks. 2 cyfry po separatorze dziesiętnym — "1.459" (kropka tysięcy z eksportu
  // w innym locale) ma być ODRZUCONE, nie zinterpretowane jako 1,459 zł
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** "01 - styczeń" / "3 - marzec" / "12-grudzień" → 1–12; null gdy nie pasuje */
export function parseRwMonth(raw: string): number | null {
  const m = raw.trim().match(/^(\d{1,2})\s*-/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n >= 1 && n <= 12 ? n : null;
}

// ── Wiersze wynikowe importu ─────────────────────────────────────────

export interface RwParsedEntry {
  month: number; // 1–12
  kind: RwKind;
  /** kanoniczna kategoria z pliku (zweryfikowana) LUB null gdy pusta/nieznana
      — wtedy zostanie zaproponowana automatycznie i sprawdzona przy przeglądzie */
  category: string | null;
  rawCategory: string; // oryginalna wartość kolumny (do podglądu przy przeglądzie)
  amountGr: number; // przychody +, koszty −
  description: string | null;
  contractor: string | null;
  bank: string | null;
  note: string | null;
}

export interface RwParseIssue {
  line: number; // 1-indeksowana linia pliku (nagłówek = 1)
  message: string;
}

export interface RwParseResult {
  kind: RwKind;
  entries: RwParsedEntry[];
  /** błędy — wiersze odrzucone (import zablokowany dopóki są błędy) */
  errors: RwParseIssue[];
  /** ostrzeżenia — wiersze przyjęte, ale warte uwagi (np. nietypowy znak kwoty) */
  warnings: RwParseIssue[];
  /** liczba pominiętych pustych wierszy-separatorów */
  skippedEmpty: number;
}

const REVENUE_HEADER = ["miesiąc", "klient", "przychód netto", "typ przychodu"];
const COST_HEADER = ["miesiąc", "opis", "netto", "kategoria"];

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Rozpoznaje format pliku po nagłówku; null gdy nagłówek nie pasuje */
export function detectRwCsvKind(headerRow: string[]): RwKind | null {
  const h = headerRow.map(norm);
  if (REVENUE_HEADER.every((col, i) => h[i] === col)) return "PRZYCHOD";
  if (COST_HEADER.every((col, i) => h[i] === col)) return "KOSZT";
  return null;
}

/** Skraca długie opisy przelewów (pełne dane bankowe nie są potrzebne w RW) */
function truncate(s: string, max = 300): string | null {
  const t = s.replace(/\s+/g, " ").trim();
  if (t === "") return null;
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

/**
 * Parsuje CSV przychodów lub kosztów (format wykrywany z nagłówka).
 * Wiersze całkowicie puste (separatory między miesiącami) są pomijane.
 */
export function parseRwCsv(text: string): RwParseResult | { formatError: string } {
  const rows = parseCsv(text);
  if (rows.length === 0) return { formatError: "Plik jest pusty" };

  const kind = detectRwCsvKind(rows[0]);
  if (kind === null) {
    return {
      formatError:
        "Nierozpoznany format pliku. Oczekiwany nagłówek przychodów: " +
        "„Miesiąc,Klient,Przychód netto,Typ Przychodu,…” albo kosztów: " +
        "„Miesiąc,Opis,Netto,Kategoria,…”.",
    };
  }

  const entries: RwParsedEntry[] = [];
  const errors: RwParseIssue[] = [];
  const warnings: RwParseIssue[] = [];
  let skippedEmpty = 0;

  for (let r = 1; r < rows.length; r++) {
    const line = r + 1;
    const cols = rows[r];
    if (cols.every((c) => c.trim() === "")) {
      skippedEmpty++;
      continue;
    }

    const monthRaw = cols[0] ?? "";
    const month = parseRwMonth(monthRaw);
    if (month === null) {
      errors.push({
        line,
        message: `Nieprawidłowy miesiąc: „${monthRaw.trim() || "(pusty)"}” — oczekiwano np. „01 - styczeń”`,
      });
      continue;
    }

    if (kind === "PRZYCHOD") {
      const [, klient = "", kwotaRaw = "", typ = "", bank = "", opis = ""] = cols;
      const amountGr = parseRwAmountGr(kwotaRaw);
      if (amountGr === null) {
        errors.push({ line, message: `Nieprawidłowa kwota: „${kwotaRaw.trim()}”` });
        continue;
      }
      // nieznany/pusty typ NIE jest błędem — kategoria zostanie zaproponowana
      // automatycznie i sprawdzona przy przeglądzie przed zatwierdzeniem
      const category = findRwCategory("PRZYCHOD", typ);
      if (amountGr < 0) {
        warnings.push({ line, message: "Ujemna kwota przychodu — zaimportowano ze znakiem z pliku" });
      }
      entries.push({
        month,
        kind,
        category: category?.name ?? null,
        rawCategory: typ.trim(),
        amountGr,
        description: truncate(klient),
        contractor: null,
        bank: truncate(bank, 40),
        note: truncate(opis, 200),
      });
    } else {
      const [, opis = "", nettoRaw = "", kategoria = "", bank = "", , kontrahent = "", uwagi = ""] = cols;
      const amountGr = parseRwAmountGr(nettoRaw);
      if (amountGr === null) {
        errors.push({ line, message: `Nieprawidłowa kwota: „${nettoRaw.trim()}”` });
        continue;
      }
      // nieznana/pusta kategoria NIE jest błędem — zostanie zaproponowana
      // automatycznie i sprawdzona przy przeglądzie przed zatwierdzeniem
      const category = findRwCategory("KOSZT", kategoria);
      if (amountGr > 0) {
        warnings.push({
          line,
          message: "Dodatnia kwota kosztu (korekta/zwrot?) — zaimportowano ze znakiem z pliku",
        });
      }
      entries.push({
        month,
        kind,
        category: category?.name ?? null,
        rawCategory: kategoria.trim(),
        amountGr,
        description: truncate(opis),
        contractor: truncate(kontrahent, 120),
        bank: truncate(bank, 40),
        note: truncate(uwagi, 200),
      });
    }
  }

  return { kind, entries, errors, warnings, skippedEmpty };
}
