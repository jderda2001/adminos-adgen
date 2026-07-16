// Parser CSV kosztów historycznych (backfill 2025/2026). Elastyczny — dopasowany
// do realnych eksportów arkuszy (np. ClickUp): wiersz nagłówka WYSZUKIWANY (może
// go poprzedzać tytuł/grupa), kolumny rozpoznawane po nazwie. Obsługiwane kolumny:
//   Data (rozliczenia) — wymagana; „Faktura"/„Dostawca"/opis; Kategoria;
//   „Wartość netto" (wymagana), „Wartość Brutto" (opc.), VAT (opc., ignorowane —
//   liczymy z netto/brutto).
// Daty: numeryczne (RRRR-MM-DD, DD.MM.RRRR) LUB polskie „1 sierpnia" / „15 lipca"
//   (BEZ roku → rok z parametru `defaultYear`, np. z nazwy pliku/selektora).
// Separator ; lub , wykrywany; kwoty „1 234,56" / „607,0419".

import { parseCsv, parseRwAmountGr } from "./rw-parse";

export interface CostCsvRow {
  line: number;
  dateISO: string; // "RRRR-MM-DD"
  year: number;
  month: number; // 1–12
  supplier: string; // opis pozycji (kolumna „Faktura"/„Dostawca")
  categoryText: string;
  netGr: number; // dodatnie
  grossGr: number; // dodatnie (= netto gdy brak kolumny brutto)
  vatRate: string | null; // wyliczona stawka (23|8|5|0) na podstawie netto/brutto
}
export interface CostCsvResult {
  rows: CostCsvRow[];
  errors: { line: number; reason: string }[];
  skippedEmpty: number;
}
export type CostCsvOutcome = CostCsvResult | { formatError: string };

// polskie nazwy miesięcy (dopełniacz + mianownik + skróty) → numer
const PL_MONTHS: Record<string, number> = {
  stycznia: 1, styczen: 1, sty: 1,
  lutego: 2, luty: 2, lut: 2,
  marca: 3, marzec: 3, mar: 3,
  kwietnia: 4, kwiecien: 4, kwi: 4,
  maja: 5, maj: 5,
  czerwca: 6, czerwiec: 6, cze: 6,
  lipca: 7, lipiec: 7, lip: 7,
  sierpnia: 8, sierpien: 8, sie: 8,
  wrzesnia: 9, wrzesien: 9, wrz: 9,
  pazdziernika: 10, pazdziernik: 10, paz: 10,
  listopada: 11, listopad: 11, lis: 11,
  grudnia: 12, grudzien: 12, gru: 12,
};

function dePl(s: string): string {
  return s
    .toLowerCase()
    .replace(/ą/g, "a").replace(/ć/g, "c").replace(/ę/g, "e").replace(/ł/g, "l")
    .replace(/ń/g, "n").replace(/ó/g, "o").replace(/ś/g, "s").replace(/ż/g, "z").replace(/ź/g, "z");
}

/** Data → {iso, year, month}; rok brany z komórki lub `defaultYear`. */
function parseDate(raw: string, defaultYear: number): { iso: string; year: number; month: number } | null {
  const s = raw.trim();
  if (!s) return null;
  // numeryczne: RRRR-MM-DD
  let mt = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})$/);
  if (mt) return mkDate(+mt[1], +mt[2], +mt[3]);
  // numeryczne: DD.MM.RRRR
  mt = s.match(/^(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})$/);
  if (mt) return mkDate(+mt[3], +mt[2], +mt[1]);
  // polskie: „1 sierpnia" [ 2026 ]
  mt = dePl(s).match(/^(\d{1,2})\s+([a-z]+)\.?(?:\s+(\d{4}))?$/);
  if (mt) {
    const month = PL_MONTHS[mt[2]];
    if (month) return mkDate(mt[3] ? +mt[3] : defaultYear, month, +mt[1]);
  }
  // sam miesiąc słownie „sierpień" → dzień 1
  const monthOnly = PL_MONTHS[dePl(s).replace(/\.$/, "")];
  if (monthOnly) return mkDate(defaultYear, monthOnly, 1);
  return null;
}
function mkDate(y: number, m: number, d: number): { iso: string; year: number; month: number } | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return { iso: `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`, year: y, month: m };
}

/** Wylicza stawkę VAT (string) z netto i brutto — najbliższa standardowa. */
function deriveVatRate(netGr: number, grossGr: number): string {
  if (grossGr <= netGr) return "0";
  const ratio = grossGr / netGr;
  const candidates: [number, string][] = [[1.23, "23"], [1.08, "8"], [1.05, "5"]];
  let best = "0";
  let bestDiff = Math.abs(ratio - 1);
  for (const [r, label] of candidates) {
    const diff = Math.abs(ratio - r);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = label;
    }
  }
  return best;
}

const norm = (cell: string) => dePl(cell.replace(/^#/, "").trim());

export function parseCostCsv(text: string, defaultYear: number): CostCsvOutcome {
  // separator z próbki wielu linii (nie z ewentualnego wiersza tytułowego bez
  // separatorów); przy polskich kwotach „493,53" średniki i tak przeważą w pliku ;
  const sample = text.split(/\r?\n/).slice(0, 20).join("\n");
  const semi = sample.match(/;/g)?.length ?? 0;
  const comma = sample.match(/,/g)?.length ?? 0;
  const delimiter = semi > comma ? ";" : ",";
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return { formatError: "Pusty plik CSV." };

  // wyszukaj wiersz nagłówka: zawiera kolumnę „data" ORAZ kolumnę kwoty
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const h = rows[i].map(norm);
    const hasDate = h.some((c) => c.includes("data"));
    const hasAmount = h.some((c) => c.includes("netto") || c.includes("kwota") || c.includes("wartosc") || c.includes("brutto"));
    if (hasDate && hasAmount) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) {
    return {
      formatError:
        "Nie znaleziono nagłówka — potrzebne kolumny z datą i kwotą " +
        "(np. Data rozliczenia oraz Wartość netto).",
    };
  }
  const header = rows[headerIdx].map(norm);
  const find = (test: (h: string) => boolean) => header.findIndex(test);

  const idxDate = find((h) => h.includes("data"));
  const idxDesc = find((h) => /faktura|dostawc|kontrahent|opis|nazwa|pozycj|tytu/.test(h));
  const idxCategory = find((h) => h.includes("kategori"));
  const idxNet = find((h) => h.includes("netto")) >= 0 ? find((h) => h.includes("netto")) : find((h) => h.includes("kwota"));
  const idxGross = find((h) => h.includes("brutto"));

  if (idxDate === -1 || (idxNet === -1 && idxGross === -1)) {
    return {
      formatError:
        "Brak wymaganych kolumn: Data i kwota (netto lub brutto). " +
        "Rozpoznawane: Data, Faktura/Dostawca, Kategoria, Wartość netto, Wartość Brutto.",
    };
  }

  const out: CostCsvRow[] = [];
  const errors: { line: number; reason: string }[] = [];
  let skippedEmpty = 0;
  const cell = (cols: string[], i: number) => (i >= 0 ? (cols[i] ?? "") : "");
  const clean = (s: string) => s.replace(/\s+/g, " ").trim();

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const line = r + 1;
    const cols = rows[r];
    if (cols.every((c) => c.trim() === "")) {
      skippedEmpty++;
      continue;
    }
    const date = parseDate(cell(cols, idxDate), defaultYear);
    if (!date) {
      errors.push({ line, reason: `zła/pusta data: „${cell(cols, idxDate).trim().slice(0, 24)}"` });
      continue;
    }
    const netRaw = idxNet >= 0 ? parseRwAmountGr(cell(cols, idxNet)) : null;
    const grossRaw = idxGross >= 0 ? parseRwAmountGr(cell(cols, idxGross)) : null;
    // kwota netto = z kolumny netto; gdy brak → z brutto
    const netGr = netRaw !== null && netRaw !== 0 ? Math.abs(netRaw) : grossRaw !== null ? Math.abs(grossRaw) : null;
    if (netGr === null || netGr === 0) {
      errors.push({ line, reason: `brak/zerowa kwota` });
      continue;
    }
    const grossGr = grossRaw !== null && grossRaw !== 0 ? Math.abs(grossRaw) : netGr;
    out.push({
      line,
      dateISO: date.iso,
      year: date.year,
      month: date.month,
      supplier: clean(cell(cols, idxDesc)) || "—",
      categoryText: clean(cell(cols, idxCategory)),
      netGr,
      grossGr,
      vatRate: deriveVatRate(netGr, grossGr),
    });
  }

  return { rows: out, errors, skippedEmpty };
}

/** Rok wykryty z nazwy pliku („Sierpień 2026 …" → 2026) albo null. */
export function yearFromFilename(name: string): number | null {
  const m = name.match(/(20\d{2})/);
  if (!m) return null;
  const y = +m[1];
  return y >= 2000 && y <= 2100 ? y : null;
}
