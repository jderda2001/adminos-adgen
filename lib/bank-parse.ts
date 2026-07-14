// Parser surowego wyciągu bankowego mBank (eksport CSV „Lista operacji").
//
// Format (średnik jako separator, preambuła przed tabelą):
//   …preambuła (mBank S.A., #Klient, #Za okres, …)…
//   #Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
//   2026-04-30;OPIS…;<nr konta>;<kat. mBank>;-1 234,56 PLN;
//
// Jeden plik zawiera OBA kierunki — przychody (kwota +) i koszty (kwota −).
// Kwoty są BRUTTO; przeliczenie na netto (÷1,23 / ÷1,08) robimy osobno
// (guessVatRate + netFromGrossGr), z możliwością korekty stawki w przeglądzie.

import { parseCsv, parseRwAmountGr } from "./rw-parse";
import type { RwKind } from "./rw-types";

export type VatRate = 0 | 8 | 23;

export interface BankRow {
  line: number; // 1-indeksowana linia pliku
  dateISO: string; // RRRR-MM-DD
  month: number; // 1–12 z daty
  description: string; // #Opis operacji (zawiera kontrahenta/merchant)
  account: string; // #Rachunek (kontrahent — nr konta)
  bankCategory: string; // #Kategoria (własna kat. mBanku — poglądowa)
  grossAmountGr: number; // BRUTTO w groszach, ze znakiem
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

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

/** nagłówek tabeli transakcji mBanku (bez „#", znormalizowany) */
function headerCols(row: string[]): string[] {
  return row.map((c) => c.replace(/^#/, "").trim().toLowerCase());
}

/**
 * Parsuje wyciąg mBank. Zwraca wiersze z kwotą BRUTTO i wykrytym kierunkiem.
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
    const grossAmountGr = parseRwAmountGr(amtRaw);
    if (grossAmountGr === null || grossAmountGr === 0) {
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
      grossAmountGr,
      kind: grossAmountGr > 0 ? "PRZYCHOD" : "KOSZT",
    });
  }

  return { bank: "mBank", rows: out, skipped, skippedEmpty };
}

/**
 * Zgaduje stawkę VAT dla operacji (do przeliczenia brutto→netto). Sygnały
 * „bez VAT" (0%): wynagrodzenia, podatki (CIT/ZUS/US), opłaty bankowe,
 * przelewy na oszczędności, ubezpieczenia. Reszta → 23% (domyślnie).
 * 8% nie jest zgadywane automatycznie (rzadkie) — użytkownik ustawia ręcznie.
 * Użytkownik i tak może zmienić stawkę w przeglądzie.
 */
export function guessVatRate(hint: {
  description?: string | null;
  bankCategory?: string | null;
}): VatRate {
  const s = norm(`${hint.description ?? ""} ${hint.bankCategory ?? ""}`);
  if (/wynagrodz|pensj|wyplat|umowa|zlecen|honorarium|premi/.test(s)) return 0;
  if (/\bcit\b|\bzus\b|\bpit\b|\bvat\b|urzad skarbow|\bus\b|podatek|zaliczk/.test(s)) return 0;
  if (/oplata za prowadzenie|prowizj|odsetki|oplata bankow|oplaty bankow/.test(s)) return 0;
  if (/oszczednosci|przelew wlasny|transfer wlasny|srodki wlasne/.test(s)) return 0;
  if (/ubezpiecz/.test(s)) return 0;
  return 23;
}

/** Brutto (grosze, ze znakiem) → netto (grosze). Netto = brutto / (1 + stawka). */
export function netFromGrossGr(grossGr: number, rate: VatRate): number {
  if (rate === 0) return grossGr;
  return Math.round(grossGr / (1 + rate / 100));
}
