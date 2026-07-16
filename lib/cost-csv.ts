// Parser CSV kosztów historycznych (backfill 2025/2026). Format kolumnowy:
//   Data ; Dostawca ; Kategoria ; Kwota netto [ ; VAT ]
// Separator wykrywany automatycznie (; lub ,). Daty w formatach PL:
//   RRRR-MM-DD, DD.MM.RRRR, DD-MM-RRRR, DD/MM/RRRR. Kwoty „1 234,56" / „1234.56".
// Kwota traktowana jako NETTO (magnituda). Rok/miesiąc z daty — jeden plik może
// obejmować wiele miesięcy i oba lata.

import { parseCsv, parseRwAmountGr } from "./rw-parse";

export interface CostCsvRow {
  line: number; // 1-indeksowana linia pliku
  dateISO: string; // "RRRR-MM-DD"
  year: number;
  month: number; // 1–12
  supplier: string;
  categoryText: string; // surowa nazwa kategorii z pliku (mapowana w przeglądzie)
  netGr: number; // grosze, dodatnie
  vatRate: string | null; // z opcjonalnej kolumny; null = brak
}
export interface CostCsvResult {
  rows: CostCsvRow[];
  errors: { line: number; reason: string }[];
  skippedEmpty: number;
}
export type CostCsvOutcome = CostCsvResult | { formatError: string };

const VALID_VAT = new Set(["23", "8", "5", "0", "ZW"]);

/** Parsuje datę PL na "RRRR-MM-DD" albo null. */
function parsePlDate(raw: string): { iso: string; year: number; month: number } | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let mt = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})$/);
  if (mt) {
    y = +mt[1];
    m = +mt[2];
    d = +mt[3];
  } else {
    mt = s.match(/^(\d{1,2})[-.\/](\d{1,2})[-.\/](\d{4})$/);
    if (!mt) return null;
    d = +mt[1];
    m = +mt[2];
    y = +mt[3];
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  return { iso, year: y, month: m };
}

function normHeader(cell: string): string {
  return cell.replace(/^#/, "").trim().toLowerCase();
}

/** Znajdź indeks kolumny po dopasowaniu nazwy (pierwsze trafienie). */
function findCol(header: string[], test: (h: string) => boolean): number {
  return header.findIndex((h) => test(h));
}

export function parseCostCsv(text: string): CostCsvOutcome {
  // wykryj separator z pierwszej niepustej linii
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return { formatError: "Pusty plik CSV." };

  // pierwszy niepusty wiersz = nagłówek
  const headerIdx = rows.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIdx === -1) return { formatError: "Pusty plik CSV." };
  const header = rows[headerIdx].map(normHeader);

  const idxDate = findCol(header, (h) => h.includes("data"));
  const idxSupplier = findCol(header, (h) => /dostawc|kontrahent|nazwa|firma|sprzedawc/.test(h));
  const idxCategory = findCol(header, (h) => h.includes("kategori"));
  // preferuj „netto"/„kwota netto", potem „kwota"
  let idxAmount = findCol(header, (h) => h.includes("netto"));
  if (idxAmount === -1) idxAmount = findCol(header, (h) => h.includes("kwota"));
  const idxVat = findCol(header, (h) => h.includes("vat") || h.includes("stawka"));

  if (idxDate === -1 || idxAmount === -1) {
    return {
      formatError:
        "Nierozpoznany plik — wymagane kolumny: Data i Kwota (netto). " +
        "Opcjonalne: Dostawca, Kategoria, VAT.",
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
    const date = parsePlDate(cell(cols, idxDate));
    if (!date) {
      errors.push({ line, reason: `zła data: „${cell(cols, idxDate).trim().slice(0, 20)}"` });
      continue;
    }
    const amtGr = parseRwAmountGr(cell(cols, idxAmount));
    if (amtGr === null || amtGr === 0) {
      errors.push({ line, reason: `zła/zerowa kwota: „${cell(cols, idxAmount).trim().slice(0, 20)}"` });
      continue;
    }
    let vatRate: string | null = null;
    if (idxVat >= 0) {
      const v = cell(cols, idxVat).trim().toUpperCase().replace("%", "").replace(/\s/g, "");
      if (VALID_VAT.has(v)) vatRate = v;
    }
    out.push({
      line,
      dateISO: date.iso,
      year: date.year,
      month: date.month,
      supplier: clean(cell(cols, idxSupplier)) || "—",
      categoryText: clean(cell(cols, idxCategory)),
      netGr: Math.abs(amtGr),
      vatRate,
    });
  }

  return { rows: out, errors, skippedEmpty };
}
