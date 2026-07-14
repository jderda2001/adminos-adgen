// Parser surowego wyciągu bankowego mBank (eksport CSV „Lista operacji").
//
// Format (średnik jako separator, preambuła przed tabelą):
//   …preambuła (mBank S.A., #Klient, #Za okres, …)…
//   #Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
//   2026-04-30;OPIS…;<nr konta>;<kat. mBank>;-1 234,56 PLN;
//
// Jeden plik zawiera OBA kierunki — przychody (kwota +) i koszty (kwota −).
// Kwoty bierzemy WPROST z wyciągu (nie operujemy już VAT-em); podział kwoty
// na kategorie robi się w przeglądzie.

import { parseCsv, parseRwAmountGr } from "./rw-parse";
import type { RwKind } from "./rw-types";

export interface BankRow {
  line: number; // 1-indeksowana linia pliku
  dateISO: string; // RRRR-MM-DD
  month: number; // 1–12 z daty
  description: string; // #Opis operacji (zawiera kontrahenta/merchant)
  account: string; // #Rachunek (kontrahent — nr konta)
  bankCategory: string; // #Kategoria (własna kat. mBanku — poglądowa)
  amountGr: number; // kwota w groszach, ze znakiem (wprost z wyciągu)
  kind: RwKind; // PRZYCHOD gdy +, KOSZT gdy −
}

export interface BankParseResult {
  bank: "mBank";
  rows: BankRow[];
  /** wiersze pominięte (nie-transakcyjne: podsumowania, błędne daty/kwoty) */
  skipped: { line: number; reason: string }[];
  skippedEmpty: number;
}
export type BankParseOutcome = BankParseResult | { formatError: string };

/** nagłówek tabeli transakcji mBanku (bez „#", znormalizowany) */
function headerCols(row: string[]): string[] {
  return row.map((c) => c.replace(/^#/, "").trim().toLowerCase());
}

/**
 * Parsuje wyciąg mBank. Zwraca wiersze z kwotą i wykrytym kierunkiem.
 * Wiersze nietransakcyjne (podsumowania, złe daty) są pomijane z podaniem
 * powodu (nie blokują importu — bank dokleja wiersze zbiorcze).
 */
export function parseMbankCsv(text: string): BankParseOutcome {
  const rows = parseCsv(text, ";");

  // znajdź wiersz nagłówka tabeli (zawiera „data operacji" i „kwota")
  let h = -1;
  for (let i = 0; i < rows.length; i++) {
    const c = headerCols(rows[i]);
    if (c.includes("data operacji") && c.includes("kwota")) {
      h = i;
      break;
    }
  }
  if (h === -1) {
    return {
      formatError:
        "Nierozpoznany plik — oczekiwano wyciągu mBank z nagłówkiem " +
        "„#Data operacji;#Opis operacji;…;#Kwota”.",
    };
  }

  const header = headerCols(rows[h]);
  const idxDate = header.indexOf("data operacji");
  const idxDesc = header.indexOf("opis operacji");
  const idxAcct = header.indexOf("rachunek");
  const idxCat = header.indexOf("kategoria");
  const idxAmt = header.indexOf("kwota");

  const out: BankRow[] = [];
  const skipped: { line: number; reason: string }[] = [];
  let skippedEmpty = 0;

  const cell = (cols: string[], i: number) => (i >= 0 ? (cols[i] ?? "") : "");
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();

  for (let r = h + 1; r < rows.length; r++) {
    const line = r + 1;
    const cols = rows[r];
    if (cols.every((c) => c.trim() === "")) {
      skippedEmpty++;
      continue;
    }

    const dateRaw = cell(cols, idxDate).trim();
    const m = dateRaw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) {
      skipped.push({ line, reason: `nietransakcyjny/zła data: „${dateRaw.slice(0, 30)}”` });
      continue;
    }
    const month = parseInt(m[2], 10);
    if (month < 1 || month > 12) {
      skipped.push({ line, reason: `zły miesiąc w dacie: „${dateRaw}”` });
      continue;
    }

    const amtRaw = cell(cols, idxAmt);
    const amountGr = parseRwAmountGr(amtRaw);
    if (amountGr === null || amountGr === 0) {
      skipped.push({ line, reason: `zła/zerowa kwota: „${amtRaw.trim()}”` });
      continue;
    }

    out.push({
      line,
      dateISO: dateRaw,
      month,
      description: clean(cell(cols, idxDesc)),
      account: clean(cell(cols, idxAcct)),
      bankCategory: cell(cols, idxCat).trim(),
      amountGr,
      kind: amountGr > 0 ? "PRZYCHOD" : "KOSZT",
    });
  }

  return { bank: "mBank", rows: out, skipped, skippedEmpty };
}
