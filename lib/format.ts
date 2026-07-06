// Formatowanie i parsowanie w polskich formatach.
// Daty przechowujemy jako DateTime o północy UTC danego dnia kalendarzowego —
// dlatego wszystkie operacje na częściach daty używają metod UTC (bez przesunięć strefy).

const plMoney = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const plNumber = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 1234567 (grosze) → "12 345,67 zł" */
export function formatMoney(grosze: number): string {
  return plMoney.format(grosze / 100);
}

/** 1234567 (grosze) → "12 345,67" (bez symbolu, np. do CSV) */
export function formatAmount(grosze: number): string {
  return plNumber.format(grosze / 100);
}

/** "12 345,67" / "12345.67" / "1 234" → grosze (int) lub null gdy niepoprawne */
export function parseMoneyToGr(input: string): number | null {
  const cleaned = input
    .replace(/\s/g, "")
    .replace(/zł/gi, "")
    .replace(",", ".");
  if (cleaned === "" || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** "1,5" / "1.5" / "0,25" (godziny) → minuty (int) lub null */
export function parseHoursToMinutes(input: string): number | null {
  const cleaned = input.replace(/\s/g, "").replace(",", ".");
  if (cleaned === "" || !/^\d+(\.\d{1,4})?$/.test(cleaned)) return null;
  const minutes = Math.round(parseFloat(cleaned) * 60);
  return minutes > 0 ? minutes : null;
}

/** 90 (minuty) → "1,5 h" */
export function formatHours(minutes: number): string {
  const h = minutes / 60;
  const str = new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(h);
  return `${str} h`;
}

/** Date (UTC-północ) → "03.07.2026" */
export function formatDate(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${d}.${m}.${date.getUTCFullYear()}`;
}

/** Date → "2026-07-03" (wartość dla <input type="date">) */
export function dateToInput(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${date.getUTCFullYear()}-${m}-${d}`;
}

/** "2026-07-03" → Date o północy UTC; null gdy niepoprawna */
export function dateFromInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return isNaN(date.getTime()) ? null : date;
}

/** Dzisiejsza data kalendarzowa (lokalna) jako Date o północy UTC — spójna z zapisem w bazie */
export function todayUTC(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  );
}

/** 0.2345 → "23,5%" (procent z jedną cyfrą po przecinku); null → "—" */
export function formatPercent(fraction: number | null): string {
  if (fraction === null || !isFinite(fraction)) return "—";
  return (
    new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(fraction * 100) + "%"
  );
}

const MONTH_NAMES_PL = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const MONTH_NAMES_PL_SHORT = [
  "sty", "lut", "mar", "kwi", "maj", "cze",
  "lip", "sie", "wrz", "paź", "lis", "gru",
];

/** "2026-07" → "lipiec 2026" */
export function formatMonth(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES_PL[m - 1]} ${y}`;
}

/** "2026-07" → "lip 26" (etykiety osi wykresów) */
export function formatMonthShort(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTH_NAMES_PL_SHORT[m - 1]} ’${String(y).slice(2)}`;
}

/** Liczba dni po terminie (ujemna = jeszcze przed terminem) */
export function daysOverdue(dueDate: Date, today: Date): number {
  return Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000);
}

/**
 * Polska odmiana liczebników: pluralPl(2, "faktura", "faktury", "faktur") → "faktury".
 * one: 1; few: 2–4 (poza 12–14); many: reszta.
 */
export function pluralPl(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  if (abs === 1) return one;
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
