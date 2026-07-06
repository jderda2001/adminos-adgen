// Obsługa filtra okresu (miesiąc / kwartał / rok / zakres dat).
// Zakresy są półotwarte: [from, to) — `to` to pierwszy dzień POZA okresem (północ UTC).

import { formatDate, formatMonth, dateFromInput, todayUTC } from "./format";

export type PeriodType = "miesiac" | "kwartal" | "rok" | "zakres";

export interface Period {
  type: PeriodType;
  from: Date; // włącznie
  to: Date; // wyłącznie
  label: string;
}

export interface PeriodSearchParams {
  okres?: string;
  od?: string;
  do?: string;
}

function utc(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m, d));
}

/** Parsuje searchParams filtra okresu; domyślnie bieżący miesiąc. */
export function resolvePeriod(params: PeriodSearchParams): Period {
  const today = todayUTC();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();

  switch (params.okres) {
    case "kwartal": {
      const q = Math.floor(m / 3);
      return {
        type: "kwartal",
        from: utc(y, q * 3, 1),
        to: utc(y, q * 3 + 3, 1),
        label: `${q + 1}. kwartał ${y}`,
      };
    }
    case "rok":
      return { type: "rok", from: utc(y, 0, 1), to: utc(y + 1, 0, 1), label: `Rok ${y}` };
    case "zakres": {
      const from = params.od ? dateFromInput(params.od) : null;
      const toInclusive = params.do ? dateFromInput(params.do) : null;
      if (from && toInclusive && from.getTime() <= toInclusive.getTime()) {
        const to = new Date(toInclusive.getTime() + 86_400_000);
        return {
          type: "zakres",
          from,
          to,
          label: `${formatDate(from)} – ${formatDate(toInclusive)}`,
        };
      }
      // niepoprawny zakres → bieżący miesiąc
      return currentMonthPeriod();
    }
    case "miesiac":
    default: {
      // opcjonalnie konkretny miesiąc ?od=RRRR-MM
      if (params.od && /^\d{4}-\d{2}$/.test(params.od)) {
        const [py, pm] = params.od.split("-").map(Number);
        return {
          type: "miesiac",
          from: utc(py, pm - 1, 1),
          to: utc(py, pm, 1),
          label: formatMonth(params.od),
        };
      }
      return currentMonthPeriod();
    }
  }
}

export function currentMonthPeriod(): Period {
  const today = todayUTC();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  const key = `${y}-${String(m + 1).padStart(2, "0")}`;
  return { type: "miesiac", from: utc(y, m, 1), to: utc(y, m + 1, 1), label: formatMonth(key) };
}

/** Klucz miesiąca "RRRR-MM" dla daty (UTC) */
export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Ostatnie n miesięcy (łącznie z bieżącym) jako klucze "RRRR-MM" rosnąco */
export function lastMonths(n: number): string[] {
  const today = todayUTC();
  const result: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1));
    result.push(monthKey(d));
  }
  return result;
}

/** Zakres [from, to) obejmujący ostatnie n miesięcy łącznie z bieżącym */
export function lastMonthsRange(n: number): { from: Date; to: Date } {
  const today = todayUTC();
  const y = today.getUTCFullYear();
  const m = today.getUTCMonth();
  return { from: utc(y, m - (n - 1), 1), to: utc(y, m + 1, 1) };
}

/** Pierwszy dzień miesiąca danego klucza "RRRR-MM" i miesiąca następnego */
export function monthBounds(key: string): { from: Date; to: Date } {
  const [y, m] = key.split("-").map(Number);
  return { from: utc(y, m - 1, 1), to: utc(y, m, 1) };
}
