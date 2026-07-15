// Silnik Rachunku Wyników — czyste funkcje, bez dostępu do bazy.
// Odwzorowuje formuły arkusza „Rachunek wyników 2026 (adGen)":
//
//   Zysk po kosztach produkcyjnych = Przychody + Koszty produkcyjne (koszty ujemne)
//   Marża I  = zysk po kosztach produkcyjnych / przychody
//   Koszty (łącznie, bez odłożonych środków) = delivery + growth + overhead
//   Zysk     = Przychody + Koszty (łącznie)          ← bez odłożonych i bez CIT
//   Zysk po podatkach = Zysk + CIT
//   Marża II = Zysk / Przychody                       (cel: 10%)
//   % kosztów (per grupa)          = grupa / koszty łącznie
//   Koszty grupy jako % przychodu  = |grupa| / przychody
//   LIVE BOA — % przychodu na: oszczędności, wynagrodzenie właścicieli
//   (wypłaty + premie zarządu), wydatki operacyjne (koszty łącznie minus
//   wynagrodzenie właścicieli), zaliczkę CIT, podatek CIT
//   Odchylenie zysku = (realizacja − estymacja) / estymacja   (jak w arkuszu)
//   CAC = |koszty growth| / liczba nowych klientów (metryka ręczna)
//
// Wszystkie kwoty w groszach (Int): przychody dodatnie, koszty ujemne.
// ŚREDNIA liczona jako SUMA / liczba miesięcy z danymi (w arkuszu średnie
// były liczone niespójnie — tu definicja jest jawna i deterministyczna).

import {
  RW_CATEGORIES,
  rwCategoriesFor,
  type RwBucket,
  type RwKind,
} from "./rw-types";

// Kategorie składające się na linie „BOA" — sumowane po nazwach, żeby działały
// jednocześnie stare (dane 2026) i nowe nazwy kategorii.
const BOA_OSZCZEDNOSCI = ["Środki przelane na oszczędności", "Oszczędności"];
const BOA_WLASCICIELE = ["Wypłaty zarządu", "Premie zarządu", "Wypłaty | Zarząd"];
const BOA_ZALICZKA_CIT = ["Zaliczka na podatek CIT"];
// pozostałe pozycje podatkowo-odłożone doliczane do „podatki + zaliczki"
const BOA_PODATKI_EXTRA = [
  "Zaliczka na premie zespołu",
  "Zaliczki na CIT / premie",
  "VAT",
  "PIT",
];

export interface RwEntryLike {
  month: number; // 1–12
  kind: RwKind;
  category: string;
  amountGr: number;
}

export interface RwManualLike {
  month: number; // 1–12
  key: string;
  valueNum: number | null;
  valueText: string | null;
}

export type RwCostBucket = "DELIVERY" | "GROWTH" | "OVERHEAD";
const COST_BUCKETS: RwCostBucket[] = ["DELIVERY", "GROWTH", "OVERHEAD"];

export interface RwLiveBoa {
  /** udziały w przychodzie (ułamki); null gdy przychód = 0 */
  oszczednosci: number | null;
  wlasciciele: number | null;
  operacyjne: number | null;
  zaliczkaCit: number | null;
  cit: number | null;
  /** podatki (CIT) + wszystkie zaliczki (CIT + premie zespołu) jako udział w przychodzie */
  podatkiIZaliczki: number | null;
}

/**
 * Cele „BOA zaplanowane" — docelowy podział przychodu (jak arkusz).
 * Sumują się do 100%. Live vs plan pokazujemy w karcie BOA.
 */
export const RW_BOA_TARGETS = {
  oszczednosci: 0.09,
  wlasciciele: 0.23,
  operacyjne: 0.65,
  podatkiIZaliczki: 0.03,
} as const;

export interface RwMonth {
  month: number; // 1–12
  /** czy w miesiącu są jakiekolwiek wpisy (import/manual) */
  hasData: boolean;
  revenueByCategory: Record<string, number>;
  revenueTotalGr: number;
  costByCategory: Record<string, number>;
  bucketTotalsGr: Record<RwBucket, number>;
  /** delivery + growth + overhead (ujemne) — „Koszty (bez odłożonych środków)" */
  costsTotalGr: number;
  zyskPoProdukcjiGr: number;
  marza1: number | null;
  zyskGr: number;
  citGr: number;
  zyskPoPodatkachGr: number;
  marza2: number | null;
  /** udział grupy w kosztach łącznych (ułamek); null gdy koszty = 0 */
  bucketShareOfCosts: Record<RwCostBucket, number | null>;
  /** koszty grupy jako % przychodu (ułamek); null gdy przychód = 0 */
  bucketShareOfRevenue: Record<RwCostBucket, number | null>;
  liveBoa: RwLiveBoa;
  estymacjaGr: number | null;
  /** (realizacja − estymacja) / estymacja; null gdy brak estymacji */
  odchylenie: number | null;
  /** koszt pozyskania klienta w groszach; null gdy brak danych */
  cacGr: number | null;
  manual: Record<string, { num: number | null; text: string | null }>;
}

export interface RwTotals {
  revenueByCategory: Record<string, number>;
  revenueTotalGr: number;
  costByCategory: Record<string, number>;
  bucketTotalsGr: Record<RwBucket, number>;
  costsTotalGr: number;
  zyskPoProdukcjiGr: number;
  marza1: number | null;
  zyskGr: number;
  citGr: number;
  zyskPoPodatkachGr: number;
  marza2: number | null;
}

export interface RwReport {
  year: number;
  months: RwMonth[]; // zawsze 12, indeks = month-1
  monthsWithData: number[];
  suma: RwTotals;
  /** SUMA / liczba miesięcy z danymi; null gdy brak danych */
  srednia: RwTotals | null;
  /** kategorie wpisów spoza taksonomii (defensywnie — nie liczone) */
  unknownCategories: string[];
}

function zeroBuckets(): Record<RwBucket, number> {
  return { PRZYCHODY: 0, DELIVERY: 0, GROWTH: 0, OVERHEAD: 0, ODLOZONE: 0, CIT: 0 };
}

function ratio(num: number, den: number): number | null {
  if (den === 0) return null;
  const r = num / den;
  return r === 0 ? 0 : r; // normalizacja -0 → 0
}

const CATEGORY_BUCKET = new Map<string, RwBucket>(
  RW_CATEGORIES.map((c) => [`${c.kind}::${c.name}`, c.bucket])
);

function computeTotals(
  revenueByCategory: Record<string, number>,
  costByCategory: Record<string, number>,
  bucketTotalsGr: Record<RwBucket, number>
): RwTotals {
  const revenueTotalGr = Object.values(revenueByCategory).reduce((a, b) => a + b, 0);
  const costsTotalGr =
    bucketTotalsGr.DELIVERY + bucketTotalsGr.GROWTH + bucketTotalsGr.OVERHEAD;
  const zyskPoProdukcjiGr = revenueTotalGr + bucketTotalsGr.DELIVERY;
  const zyskGr = revenueTotalGr + costsTotalGr;
  const citGr = bucketTotalsGr.CIT;
  return {
    revenueByCategory,
    revenueTotalGr,
    costByCategory,
    bucketTotalsGr,
    costsTotalGr,
    zyskPoProdukcjiGr,
    marza1: ratio(zyskPoProdukcjiGr, revenueTotalGr),
    zyskGr,
    citGr,
    zyskPoPodatkachGr: zyskGr + citGr,
    marza2: ratio(zyskGr, revenueTotalGr),
  };
}

/** Suma wybranej kategorii kosztowej (0 gdy brak) */
function cost(costByCategory: Record<string, number>, name: string): number {
  return costByCategory[name] ?? 0;
}

/** Suma wielu kategorii kosztowych (po nazwach — stare + nowe) */
function costSum(costByCategory: Record<string, number>, names: string[]): number {
  return names.reduce((s, n) => s + (costByCategory[n] ?? 0), 0);
}

export function buildRwReport(
  year: number,
  entries: RwEntryLike[],
  manual: RwManualLike[]
): RwReport {
  const unknown = new Set<string>();

  // inicjalizacja pełnych map kategorii (0), żeby UI zawsze miał wszystkie wiersze
  const emptyRevenue = () =>
    Object.fromEntries(rwCategoriesFor("PRZYCHOD").map((c) => [c.name, 0]));
  // seed WSZYSTKICH kategorii (też zdeprecjonowanych) — spójne klucze we
  // wszystkich miesiącach (brak NaN przy odczycie); tabela sama ukrywa
  // zdeprecjonowane wiersze o zerowej sumie rocznej
  const emptyCost = () =>
    Object.fromEntries(rwCategoriesFor("KOSZT").map((c) => [c.name, 0]));

  const perMonthRevenue: Record<string, number>[] = Array.from({ length: 12 }, emptyRevenue);
  const perMonthCost: Record<string, number>[] = Array.from({ length: 12 }, emptyCost);
  const perMonthBuckets: Record<RwBucket, number>[] = Array.from({ length: 12 }, zeroBuckets);
  const monthHasEntries = new Array<boolean>(12).fill(false);

  for (const e of entries) {
    if (e.month < 1 || e.month > 12) continue;
    const bucket = CATEGORY_BUCKET.get(`${e.kind}::${e.category}`);
    if (!bucket) {
      unknown.add(`${e.kind}: ${e.category}`);
      continue;
    }
    const idx = e.month - 1;
    monthHasEntries[idx] = true;
    perMonthBuckets[idx][bucket] += e.amountGr;
    if (e.kind === "PRZYCHOD") {
      perMonthRevenue[idx][e.category] = (perMonthRevenue[idx][e.category] ?? 0) + e.amountGr;
    } else {
      perMonthCost[idx][e.category] = (perMonthCost[idx][e.category] ?? 0) + e.amountGr;
    }
  }

  // metryki ręczne per miesiąc
  const manualByMonth: Record<string, { num: number | null; text: string | null }>[] =
    Array.from({ length: 12 }, () => ({}));
  for (const m of manual) {
    if (m.month < 1 || m.month > 12) continue;
    manualByMonth[m.month - 1][m.key] = { num: m.valueNum, text: m.valueText };
  }

  const months: RwMonth[] = [];
  for (let i = 0; i < 12; i++) {
    const totals = computeTotals(perMonthRevenue[i], perMonthCost[i], perMonthBuckets[i]);
    const m = manualByMonth[i];

    const wlascicieleGr = costSum(totals.costByCategory, BOA_WLASCICIELE);
    const oszczednosciGr = costSum(totals.costByCategory, BOA_OSZCZEDNOSCI);
    const zaliczkaCitGr = costSum(totals.costByCategory, BOA_ZALICZKA_CIT);
    // podatki + zaliczki: CIT (wiersz wyniku) + zaliczka CIT + pozostałe pozycje
    // podatkowo-odłożone (zaliczka premie, „Zaliczki na CIT / premie", VAT, PIT)
    const podatkiIZaliczkiGr =
      totals.citGr + zaliczkaCitGr + costSum(totals.costByCategory, BOA_PODATKI_EXTRA);

    const liveBoa: RwLiveBoa = {
      oszczednosci: ratio(-oszczednosciGr, totals.revenueTotalGr),
      wlasciciele: ratio(-wlascicieleGr, totals.revenueTotalGr),
      operacyjne: ratio(-(totals.costsTotalGr - wlascicieleGr), totals.revenueTotalGr),
      zaliczkaCit: ratio(-zaliczkaCitGr, totals.revenueTotalGr),
      cit: ratio(-totals.citGr, totals.revenueTotalGr),
      podatkiIZaliczki: ratio(-podatkiIZaliczkiGr, totals.revenueTotalGr),
    };

    // estymacja zysku w zł (metryka ręczna) → grosze
    const estNum = m["zysk_estymacja"]?.num ?? null;
    const estymacjaGr = estNum !== null ? Math.round(estNum * 100) : null;
    // odchylenie/CAC liczone TYLKO dla miesięcy z danymi — estymacja wpisana
    // na przyszły miesiąc nie ma jeszcze realizacji do porównania
    const rawOdchylenie =
      monthHasEntries[i] && estymacjaGr !== null && estymacjaGr !== 0
        ? (totals.zyskGr - estymacjaGr) / estymacjaGr
        : null;
    const odchylenie = rawOdchylenie === 0 ? 0 : rawOdchylenie; // -0 → 0

    const nowiKlienci = m["nowi_klienci"]?.num ?? null;
    const cacGr =
      monthHasEntries[i] && nowiKlienci !== null && nowiKlienci > 0
        ? Math.round(-perMonthBuckets[i].GROWTH / nowiKlienci)
        : null;

    months.push({
      month: i + 1,
      hasData: monthHasEntries[i],
      revenueByCategory: totals.revenueByCategory,
      revenueTotalGr: totals.revenueTotalGr,
      costByCategory: totals.costByCategory,
      bucketTotalsGr: perMonthBuckets[i],
      costsTotalGr: totals.costsTotalGr,
      zyskPoProdukcjiGr: totals.zyskPoProdukcjiGr,
      marza1: totals.marza1,
      zyskGr: totals.zyskGr,
      citGr: totals.citGr,
      zyskPoPodatkachGr: totals.zyskPoPodatkachGr,
      marza2: totals.marza2,
      bucketShareOfCosts: Object.fromEntries(
        COST_BUCKETS.map((b) => [b, ratio(perMonthBuckets[i][b], totals.costsTotalGr)])
      ) as Record<RwCostBucket, number | null>,
      bucketShareOfRevenue: Object.fromEntries(
        COST_BUCKETS.map((b) => [b, ratio(-perMonthBuckets[i][b], totals.revenueTotalGr)])
      ) as Record<RwCostBucket, number | null>,
      liveBoa,
      estymacjaGr,
      odchylenie,
      cacGr,
      manual: m,
    });
  }

  // SUMA (rok)
  const sumRevenue = emptyRevenue();
  const sumCost = emptyCost();
  const sumBuckets = zeroBuckets();
  for (let i = 0; i < 12; i++) {
    for (const [k, v] of Object.entries(perMonthRevenue[i])) sumRevenue[k] += v;
    for (const [k, v] of Object.entries(perMonthCost[i])) sumCost[k] += v;
    for (const b of Object.keys(sumBuckets) as RwBucket[]) {
      sumBuckets[b] += perMonthBuckets[i][b];
    }
  }
  const suma = computeTotals(sumRevenue, sumCost, sumBuckets);

  const monthsWithData = months.filter((m) => m.hasData).map((m) => m.month);
  const n = monthsWithData.length;

  let srednia: RwTotals | null = null;
  if (n > 0) {
    const avg = (v: number) => Math.round(v / n);
    const avgMap = (map: Record<string, number>) =>
      Object.fromEntries(Object.entries(map).map(([k, v]) => [k, avg(v)]));
    const avgBuckets = Object.fromEntries(
      Object.entries(sumBuckets).map(([k, v]) => [k, avg(v)])
    ) as Record<RwBucket, number>;
    srednia = computeTotals(avgMap(sumRevenue), avgMap(sumCost), avgBuckets);
  }

  return {
    year,
    months,
    monthsWithData,
    suma,
    srednia,
    unknownCategories: [...unknown].sort(),
  };
}
