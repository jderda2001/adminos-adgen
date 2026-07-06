// Wspólne stałe i typy wykresów Dashboardu.
// Kolory pochodzą z tokenów motywu (--chart-1..5 z app/globals.css) — spójnie
// z resztą UI. Przypisanie: przychody = zieleń (chart-2), koszty = czerwień
// (chart-4), zysk = indygo/marka (chart-1), marża = fiolet (chart-5).

export const CHART_COLORS = {
  revenue: "var(--chart-2)", // zieleń
  costs: "var(--chart-4)", // czerwień
  profit: "var(--chart-1)", // indygo (marka)
  margin: "var(--chart-5)", // fiolet
} as const;

// Paleta donuta struktury kosztów — cykl 5 tonów motywu.
export const PIE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

/** Punkt serii miesięcznej — kopia strukturalna MonthlyPoint z lib/reports
 *  (nie importujemy z lib/reports w komponentach klienckich — moduł jest server-only). */
export interface MonthlyChartPoint {
  month: string; // "RRRR-MM"
  revenueGr: number;
  costsGr: number;
  profitGr: number;
  marginFraction: number | null;
}

const axisNumber = new Intl.NumberFormat("pl-PL", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Wartość osi w złotych → kompaktowy zapis PL, np. 12500 → "12,5 tys." */
export function formatAxisZl(value: number): string {
  return axisNumber.format(value);
}
