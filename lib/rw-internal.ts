// Wykrywanie PRZELEWÓW WŁASNYCH w wyciągu bankowym (operacje między kontami
// adGen). Bez tego import liczyłby je jak przychody/koszty — w realnym wyciągu
// to ~połowa wierszy (obie nogi transferu).
//
// Sygnały (dowolny wystarczy):
//   1) kontrahent (#Rachunek) pasuje do WŁASNEGO konta — z preambuł wgranych
//      plików, z poprzednich importów albo z config/rw-accounts.json,
//   2) opis zawiera nazwę własną firmy (domyślnie „adgen sp", konfigurowalne).
//
// Los wykrytych: DOMYŚLNIE pomijane (obie nogi), z wyjątkiem przelewów, które
// wg metodologii adGen SĄ kosztem w momencie przelewu (odłożone środki):
// oszczędności / zaliczka CIT / zaliczka na premie — te dostają kategorię
// (z reguły konta w configu albo ze słów kluczowych opisu) i zostają.
// Wszystko widać i można przywrócić w przeglądzie przed zatwierdzeniem.
//
// Moduł CZYSTY (bez fs/serwera) — konfig wstrzykiwany; loader: lib/rw-accounts.ts.

import type { BankAccount, BankRow } from "./bank-parse";

/** Reguła własnego konta z config/rw-accounts.json (numery = dane wrażliwe → poza repo) */
export interface OwnAccountRule {
  match: string; // numer konta (same cyfry lub z odstępami)
  name?: string; // etykieta do przeglądu
  /** gdy przelew NA to konto jest kosztem w momencie przelewu (odłożone środki) */
  transferCategory?: string;
}

export interface InternalRulesConfig {
  selfNames: string[]; // fragmenty nazwy własnej firmy w opisie (znormalizowane dopasowanie)
  accounts: OwnAccountRule[];
}

export const DEFAULT_SELF_NAMES = ["adgen sp"];

export type InternalVerdict =
  | { internal: false }
  | {
      internal: true;
      /** kategoria RW gdy przelew ma być kosztem (odłożone środki); brak → pomiń */
      category: string | null;
      reason: string; // co wykryło (etykieta konta / „nazwa własna w opisie")
    };

/** normalizacja jak w rw-categorize: małe litery, bez PL znaków, pojedyncze spacje */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l")
    .replace(/\s+/g, " ")
    .trim();
}

const digits = (s: string): string => s.replace(/\D/g, "");

/** dopasowanie numerów kont odporne na obcięcia (wspólny sufiks ≥10 cyfr) */
function accountsMatch(a: string, b: string): boolean {
  if (a.length < 10 || b.length < 10) return false;
  return a.includes(b) || b.includes(a) || a.slice(-10) === b.slice(-10);
}

// przelewy liczone jako koszt w momencie przelewu — słowa kluczowe opisu
const TRANSFER_CATEGORY_KEYWORDS: { test: RegExp; category: string }[] = [
  { test: /oszczedn/, category: "Środki przelane na oszczędności" },
  { test: /premi/, category: "Zaliczka na premie zespołu" },
  { test: /\bcit\b/, category: "Zaliczka na podatek CIT" },
];

/**
 * Klasyfikuje operację wyciągu: przelew własny czy zwykła operacja.
 * `ownNumbers` — numery własnych kont spoza configu (preambuły wgranych plików,
 * poprzednie importy). Kategoria zwracana tylko dla nogi WYCHODZĄCEJ (kwota < 0).
 */
export function classifyBankRow(
  row: Pick<BankRow, "description" | "account" | "amountGr">,
  config: InternalRulesConfig,
  ownNumbers: string[] = []
): InternalVerdict {
  const acct = digits(row.account ?? "");
  const nd = norm(row.description ?? "");

  let reason: string | null = null;
  let ruleCategory: string | null = null;

  // 1) kontrahent = własne konto (reguły configu mają pierwszeństwo — niosą kategorię)
  if (acct.length >= 10) {
    for (const rule of config.accounts) {
      if (accountsMatch(acct, digits(rule.match))) {
        reason = rule.name ? `konto: ${rule.name}` : "konto własne";
        ruleCategory = rule.transferCategory ?? null;
        break;
      }
    }
    if (!reason) {
      for (const num of ownNumbers) {
        if (accountsMatch(acct, digits(num))) {
          reason = "konto własne (z wyciągu)";
          break;
        }
      }
    }
  }

  // 2) nazwa własna firmy w opisie
  if (!reason) {
    for (const selfName of config.selfNames) {
      const n = norm(selfName);
      if (n !== "" && nd.includes(n)) {
        reason = "nazwa własna w opisie";
        break;
      }
    }
  }

  if (!reason) return { internal: false };

  // kategoria „odłożonych środków" — tylko wychodzące
  let category: string | null = null;
  if (row.amountGr < 0) {
    category = ruleCategory;
    if (!category) {
      for (const kw of TRANSFER_CATEGORY_KEYWORDS) {
        if (kw.test.test(nd)) {
          category = kw.category;
          break;
        }
      }
    }
  }

  return { internal: true, category, reason };
}

/** Wiersz po scaleniu plików — z nazwą pliku źródłowego (do przeglądu) */
export type MergedBankRow = BankRow & { sourceFile: string };

/**
 * Scala wyciągi z wielu plików i usuwa duplikaty MIĘDZY plikami (to samo konto
 * wgrane dwa razy, zachodzące zakresy dat). Pojedynczy wyciąg jest autorytatywny
 * — bank nie dubluje wierszy, a identyczne operacje w JEDNYM pliku (np. dwie
 * płatności Meta o tej samej kwocie tego samego dnia) są PRAWDZIWE. Dlatego dla
 * każdego klucza (dzień+kwota+opis) zachowujemy tyle wystąpień, ile ma plik
 * z ich największą liczbą; nadwyżka z innych plików = duplikaty.
 */
export function mergeBankFiles(
  files: { filename: string; rows: BankRow[]; accounts: BankAccount[] }[]
): { rows: MergedBankRow[]; duplicates: number; accounts: BankAccount[] } {
  // key → fileIdx → wiersze z tego pliku o tym kluczu
  const perKey = new Map<string, Map<number, MergedBankRow[]>>();
  for (let fi = 0; fi < files.length; fi++) {
    const f = files[fi];
    for (const r of f.rows) {
      const key = `${r.dateISO}|${r.amountGr}|${norm(r.description).slice(0, 80)}`;
      let byFile = perKey.get(key);
      if (!byFile) perKey.set(key, (byFile = new Map()));
      let list = byFile.get(fi);
      if (!list) byFile.set(fi, (list = []));
      list.push({ ...r, sourceFile: f.filename });
    }
  }

  const rows: MergedBankRow[] = [];
  let duplicates = 0;
  for (const byFile of perKey.values()) {
    let best: MergedBankRow[] = [];
    let total = 0;
    for (const list of byFile.values()) {
      total += list.length;
      if (list.length > best.length) best = list;
    }
    rows.push(...best);
    duplicates += total - best.length;
  }
  // stabilnie po dacie (pliki per konto mają rozłączne porządki)
  rows.sort((a, b) => (a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0));

  const byNumber = new Map<string, BankAccount>();
  for (const f of files) {
    for (const a of f.accounts) {
      const num = digits(a.number);
      if (num === "") continue;
      const prev = byNumber.get(num);
      if (!prev || (prev.name === "" && a.name !== "")) {
        byNumber.set(num, { name: a.name, number: num });
      }
    }
  }

  return { rows, duplicates, accounts: [...byNumber.values()] };
}
