// Silnik prognozy finansowej (moduł „Estymacje") — CZYSTE funkcje, bez bazy/API.
// Odpowiada na pytanie „jest lipiec — ile pieniędzy będziemy mieć we wrześniu?".
//
// Wejście/wyjście: kwoty w groszach (Int), daty jako ISO "RRRR-MM-DD", okresy
// "RRRR-MM". `todayIso` podawane z zewnątrz (determinizm testów — brak todayUTC()
// w silniku). Wzorzec czystego silnika jak lib/rw.ts.
//
// Model (świadome decyzje — patrz komentarze przy funkcjach):
// • P&L (memoriałowo, NETTO) = model „typowego miesiąca": szablony cykliczne +
//   rezydualna baza historyczna kategorii operacyjnych. Jednolity dla m0..
// • Cash flow (kasowo, BRUTTO) = model „timingowy" zakotwiczony w ręcznym
//   stanie kont (CashSnapshot):
//     – bieżący miesiąc (m0) liczymy z rzeczy ZNANYCH (otwarte faktury/koszty,
//       podatki, zdarzenia) — nie doklejamy bazy historycznej, żeby nie liczyć
//       podwójnie tego, co już wiemy o tym miesiącu;
//     – przyszłe miesiące (m1..) = prognoza (MRR/run-rate wpływy − projekcja
//       szablonów − rezydua kategorii − podatki − zdarzenia).
// • Dedup szablon↔historia: rezydua = max(0, śr.3M kategorii RW − Σ szablonów
//   zmapowanych do tej kategorii). Rata z endPeriod znika po końcu bez podwójnego
//   liczenia (szablon przestaje płacić, rezydua stałe).
//
// Znany bias: świeży szablon bez śladu w 3M historii chwilowo zaniża rezydua
// (samokorekta po 3M); podatki modelujemy poziomem z historii, timingiem po dniach
// ustawowych (VAT 25., PIT/CIT 20.) — model VAT-od-przychodu to potencjalne v2.

import { computeVatFromNet } from "./calc";
import { isVatRate, type VatRate } from "./types";
import { DEPRECATED_COST_MAP } from "./rw-types";

// ── Stałe domeny ─────────────────────────────────────────────────────

/** Kategorie operacyjne RW, dla których liczymy rezydualną bazę historyczną. */
export const FORECAST_BASELINE_CATEGORIES = [
  "Wypłaty | Zespół",
  "Wypłaty | UGC",
  "Wypłaty | Zarząd",
  "Budżet reklamowy",
  "Networking",
  "Abonamenty",
  "Samochody",
  "Niespodziewane / Obiady zarządu",
  "Pozostałe wydatki operacyjne",
] as const;

/** Podatki — osobne linie (mocna kadencja ustawowa), dzień płatności w miesiącu. */
export const FORECAST_TAX_CATEGORIES: { category: string; payDay: number }[] = [
  { category: "VAT", payDay: 25 },
  { category: "PIT", payDay: 20 },
  { category: "Zaliczki na CIT / premie", payDay: 20 },
  { category: "CIT", payDay: 20 },
];

/** Dzień płatności rezyduów operacyjnych: wynagrodzenia 10., reszta 15. */
function baselinePayDay(rwCategory: string): number {
  return rwCategory.startsWith("Wypłaty") ? 10 : 15;
}

/** Mapowanie nazw kategorii kosztowych (moduł Koszty) → kategorie RW (do dedupu). */
export const FORECAST_COST_CATEGORY_TO_RW: Record<string, string> = {
  Abonamenty: "Abonamenty",
  "Pozostałe wydatki operacyjne": "Pozostałe wydatki operacyjne",
  "Wypłaty | Zarząd": "Wypłaty | Zarząd",
  "Wypłaty | Zespół": "Wypłaty | Zespół",
  Podwykonawcy: "Wypłaty | UGC",
  Inne: "Pozostałe wydatki operacyjne",
  // „Oszczędności" celowo pominięte — wykluczone z prognozy (przepływ wewnętrzny)
};

export const PLAN_EVENT_KINDS = ["INFLOW", "OUTFLOW"] as const;
export const PLAN_EVENT_LABELS: Record<string, string> = {
  INFLOW: "Wpływ",
  OUTFLOW: "Wydatek",
};

const MIN_DELAY_SAMPLE = 3; // < tylu opłaconych faktur → mediana globalna
const DOUBTFUL_DAYS = 90; // faktura > tylu dni po terminie → „wątpliwa", poza baseline
const SNAPSHOT_STALE_DAYS = 14; // starszy snapshot → warning
const DEFAULT_GROSS_MULTIPLIER = 1.23; // fallback netto→brutto (23% VAT)

export const DEFAULT_BILLING_PATTERN: ClientBillingPattern = {
  issueDay: 5,
  termDays: 14,
  grossMultiplier: DEFAULT_GROSS_MULTIPLIER,
};

// ── Helpery dat/okresów (UTC, prywatne) ──────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function toUtc(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function isoOf(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}
function addDaysIso(iso: string, days: number): string {
  const d = toUtc(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return isoOf(d);
}
/** Różnica a − b w pełnych dniach (a, b ISO). */
function dayDiff(aIso: string, bIso: string): number {
  return Math.round((toUtc(aIso).getTime() - toUtc(bIso).getTime()) / 86_400_000);
}
function periodOf(iso: string): string {
  return iso.slice(0, 7);
}
function addMonthsToPeriod(period: string, n: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}
function lastDayOfPeriod(period: string): number {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
/** ISO daty w okresie na wskazany dzień (przycięty do końca miesiąca). */
function periodDayIso(period: string, day: number): string {
  return `${period}-${pad2(Math.min(day, lastDayOfPeriod(period)))}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Statystyki płatności ─────────────────────────────────────────────

export interface PaidInvoiceLike {
  clientId: string;
  dueDate: string; // ISO
  paidDate: string; // ISO
}
export interface ClientPaymentStats {
  clientId: string;
  sampleCount: number;
  medianDelayDays: number; // może być ujemna (płaci przed terminem)
  meanDelayDays: number;
  onTimeFraction: number; // udział faktur z opóźnieniem ≤ 0
  maxDelayDays: number;
}
export interface PaymentStats {
  byClient: Record<string, ClientPaymentStats>;
  global: Omit<ClientPaymentStats, "clientId">;
}

/** Statystyki punktualności z opłaconych faktur (paidDate − dueDate). */
export function computePaymentStats(paid: PaidInvoiceLike[]): PaymentStats {
  const groups = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of paid) {
    const delay = dayDiff(p.paidDate, p.dueDate);
    all.push(delay);
    const arr = groups.get(p.clientId) ?? [];
    arr.push(delay);
    groups.set(p.clientId, arr);
  }
  const summarize = (delays: number[]): Omit<ClientPaymentStats, "clientId"> => ({
    sampleCount: delays.length,
    medianDelayDays: median(delays),
    meanDelayDays:
      delays.length === 0
        ? 0
        : Math.round(delays.reduce((a, b) => a + b, 0) / delays.length),
    onTimeFraction:
      delays.length === 0 ? 0 : delays.filter((d) => d <= 0).length / delays.length,
    maxDelayDays: delays.length === 0 ? 0 : Math.max(...delays),
  });
  const byClient: Record<string, ClientPaymentStats> = {};
  for (const [clientId, delays] of groups) {
    byClient[clientId] = { clientId, ...summarize(delays) };
  }
  return { byClient, global: summarize(all) };
}

/**
 * Opóźnienie do TIMINGU prognozy: mediana klienta (≥ MIN_DELAY_SAMPLE próbek),
 * inaczej mediana globalna; podłoga 0 — nigdy nie zakładamy płatności przed
 * terminem (konserwatywnie, narzędzie do bezpieczeństwa gotówki).
 */
export function effectiveDelayDays(stats: PaymentStats, clientId: string | null): number {
  const c = clientId ? stats.byClient[clientId] : undefined;
  const raw =
    c && c.sampleCount >= MIN_DELAY_SAMPLE ? c.medianDelayDays : stats.global.medianDelayDays;
  return Math.max(0, raw);
}

// ── Wzorce fakturowania (do timingu prognozowanych wpływów) ──────────

export interface HistoryInvoiceLike {
  clientId: string;
  netGr: number;
  grossGr: number;
  issueDate: string; // ISO
  dueDate: string; // ISO
  saleDate: string; // ISO
}
export interface ClientBillingPattern {
  issueDay: number; // mediana dnia wystawienia
  termDays: number; // mediana (dueDate − issueDate)
  grossMultiplier: number; // Σgross/Σnet, clamp [1.0, 1.23]
}

/** Per klient: dzień wystawienia, termin, mnożnik brutto — z 12M historii (≠DRAFT). */
export function computeBillingPatterns(
  history: HistoryInvoiceLike[]
): Record<string, ClientBillingPattern> {
  const groups = new Map<string, HistoryInvoiceLike[]>();
  for (const inv of history) {
    const arr = groups.get(inv.clientId) ?? [];
    arr.push(inv);
    groups.set(inv.clientId, arr);
  }
  const out: Record<string, ClientBillingPattern> = {};
  for (const [clientId, invs] of groups) {
    const issueDays = invs.map((i) => toUtc(i.issueDate).getUTCDate());
    const terms = invs.map((i) => Math.max(0, dayDiff(i.dueDate, i.issueDate)));
    const sumNet = invs.reduce((a, i) => a + i.netGr, 0);
    const sumGross = invs.reduce((a, i) => a + i.grossGr, 0);
    out[clientId] = {
      issueDay: clamp(median(issueDays) || DEFAULT_BILLING_PATTERN.issueDay, 1, 28),
      termDays: median(terms) || DEFAULT_BILLING_PATTERN.termDays,
      grossMultiplier: sumNet > 0 ? clamp(sumGross / sumNet, 1.0, 1.23) : DEFAULT_GROSS_MULTIPLIER,
    };
  }
  return out;
}

// ── Typy wejścia silnika ─────────────────────────────────────────────

export interface ForecastClientLike {
  id: string;
  name: string;
  billingModel: string; // ABONAMENT | PROJEKT | SUCCESS_FEE | PAKIETY_LEADOW
  status: string; // ACTIVE | ENDED
  monthlyRetainerGr: number | null;
  startDate: string | null;
  endDate: string | null;
  noticeMonths: number | null;
}
export interface OpenInvoiceLike {
  id: string;
  clientId: string;
  grossGr: number;
  dueDate: string; // ISO
  status: string; // ISSUED | OVERDUE
}
export interface PaidAfterSnapshotInvoiceLike {
  clientId: string;
  grossGr: number;
  paidDate: string; // ISO
}
export interface ForecastCostLike {
  id: string;
  grossGr: number;
  netGr: number;
  dueDate: string | null; // ISO
  docDate: string; // ISO
  paidDate: string | null; // ISO (gdy opłacony po snapshocie)
  supplierName: string;
  categoryName: string;
  recurringCostId: string | null;
}
export interface ForecastRecurringLike {
  id: string;
  supplierName: string;
  netGr: number;
  vatRate: string;
  dueDayOfMonth: number;
  active: boolean;
  endPeriod: string | null; // "RRRR-MM"
  lastGeneratedPeriod: string | null;
  categoryName: string;
}
export interface RwHistoryLike {
  period: string; // "RRRR-MM"
  kind: "PRZYCHOD" | "KOSZT";
  category: string;
  amountGr: number; // NET, znak (koszt ujemny)
  grossGr: number | null;
}
export interface PlanEventLike {
  id: string;
  period: string; // "RRRR-MM"
  kind: string; // INFLOW | OUTFLOW
  label: string;
  amountGr: number; // BRUTTO dodatnia
}
export interface ForecastAssumptions {
  newBusinessMonthlyGr: number; // NETTO/mies.
}
export interface ForecastInput {
  todayIso: string;
  horizonMonths: 3 | 6 | 12;
  snapshot: { dateIso: string; balanceGr: number } | null;
  clients: ForecastClientLike[];
  openInvoices: OpenInvoiceLike[];
  paidAfterSnapshotInvoices: PaidAfterSnapshotInvoiceLike[];
  historyInvoices: HistoryInvoiceLike[]; // 12M ≠ DRAFT
  paidInvoices: PaidInvoiceLike[]; // 12M PAID (statystyki)
  openCosts: ForecastCostLike[];
  recurring: ForecastRecurringLike[];
  rwHistory: RwHistoryLike[]; // ≥ 6 pełnych miesięcy, kind=KOSZT
  events: PlanEventLike[];
  assumptions: ForecastAssumptions;
}

// ── Typy wyjścia ─────────────────────────────────────────────────────

export type CashEventSource =
  | "FAKTURA_OTWARTA"
  | "FAKTURA_OPLACONA_PO_SNAPSHOT"
  | "PROGNOZA_MRR"
  | "PROGNOZA_RUNRATE"
  | "NOWY_BIZNES"
  | "ZDARZENIE"
  | "KOSZT_CYKLICZNY"
  | "KOSZT_JEDNORAZOWY"
  | "BASELINE_RW"
  | "PODATKI";

export interface CashEvent {
  dateIso: string;
  period: string;
  amountGr: number; // + wpływ, − wydatek (BRUTTO)
  source: CashEventSource;
  label: string;
  clientId: string | null;
  assumed: boolean; // true = składnik modelowy (skalowalny przez AI); false = znany/umowny
}
export interface CashMonth {
  period: string;
  openingGr: number;
  inflowsGr: number;
  outflowsGr: number;
  closingGr: number;
  minBalanceGr: number;
  minBalanceDateIso: string;
  events: CashEvent[];
}
export interface PnlRevenueLine {
  clientId: string | null;
  label: string;
  source: "ABONAMENT" | "RUN_RATE" | "NOWY_BIZNES";
  netGr: number;
  contracted: boolean;
}
export interface PnlCostLine {
  label: string;
  source: "CYKLICZNY" | "BASELINE_RW";
  netGr: number;
}
export interface PnlMonth {
  period: string;
  revenueNetGr: number;
  contractedNetGr: number;
  assumedNetGr: number;
  invoicedToDateNetGr: number | null; // ≠ null tylko dla m0
  costsNetGr: number;
  profitGr: number;
  marginFraction: number | null;
  revenueLines: PnlRevenueLine[];
  costLines: PnlCostLine[];
}
export interface ForecastWarning {
  code: string;
  message: string;
}
export interface ForecastKpis {
  closingEndGr: number | null;
  minBalanceGr: number | null;
  minBalanceDateIso: string | null;
  firstNegativePeriod: string | null;
  overdueBacklogGr: number;
  doubtfulGr: number;
}
export interface ForecastResult {
  periods: string[];
  pnl: PnlMonth[];
  cash: CashMonth[] | null;
  kpis: ForecastKpis;
  paymentStats: PaymentStats;
  warnings: ForecastWarning[];
  /** data stanu kont kotwiczącego prognozę (do rekomputacji scenariusza AI) */
  snapshotDateIso: string | null;
}

// ── Montaż miesięcy cash + KPI (współdzielone z applyAiAdjustments) ──

function compareIso(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Buduje miesiące cash z listy zdarzeń (już przefiltrowanych do horyzontu). */
function assembleCashMonths(
  liveEvents: CashEvent[],
  periods: string[],
  openingStart: number,
  m0: string,
  snapshotIso: string
): CashMonth[] {
  const byPeriod = new Map<string, CashEvent[]>();
  for (const e of liveEvents) {
    const arr = byPeriod.get(e.period) ?? [];
    arr.push(e);
    byPeriod.set(e.period, arr);
  }
  let balance = openingStart;
  const out: CashMonth[] = [];
  for (const period of periods) {
    const opening = balance;
    const evs = (byPeriod.get(period) ?? []).sort((a, b) => compareIso(a.dateIso, b.dateIso));
    let inflows = 0;
    let outflows = 0;
    let minBalance = opening;
    let minDate = period === m0 ? snapshotIso : `${period}-01`;
    for (const e of evs) {
      balance += e.amountGr;
      if (e.amountGr >= 0) inflows += e.amountGr;
      else outflows += -e.amountGr;
      if (balance < minBalance) {
        minBalance = balance;
        minDate = e.dateIso;
      }
    }
    out.push({
      period,
      openingGr: opening,
      inflowsGr: inflows,
      outflowsGr: outflows,
      closingGr: balance,
      minBalanceGr: minBalance,
      minBalanceDateIso: minDate,
      events: evs,
    });
  }
  return out;
}

/** KPI gotówkowe z miesięcy cash (globalne minimum, pierwszy miesiąc pod kreską). */
function cashKpisFrom(cash: CashMonth[]): {
  closingEndGr: number;
  minBalanceGr: number;
  minBalanceDateIso: string;
  firstNegativePeriod: string | null;
} {
  let minBalanceGr = cash[0]?.minBalanceGr ?? 0;
  let minBalanceDateIso = cash[0]?.minBalanceDateIso ?? "";
  let firstNegativePeriod: string | null = null;
  for (const m of cash) {
    if (m.minBalanceGr < minBalanceGr) {
      minBalanceGr = m.minBalanceGr;
      minBalanceDateIso = m.minBalanceDateIso;
    }
    if (firstNegativePeriod === null && m.minBalanceGr < 0) firstNegativePeriod = m.period;
  }
  return {
    closingEndGr: cash[cash.length - 1]?.closingGr ?? 0,
    minBalanceGr,
    minBalanceDateIso,
    firstNegativePeriod,
  };
}

// ── Główna funkcja ───────────────────────────────────────────────────

export function buildForecast(input: ForecastInput): ForecastResult {
  const warnings: ForecastWarning[] = [];
  const currentPeriod = periodOf(input.todayIso);
  const periods: string[] = [];
  for (let i = 0; i < input.horizonMonths; i++) periods.push(addMonthsToPeriod(currentPeriod, i));
  const periodSet = new Set(periods);
  const m0 = currentPeriod;

  const paymentStats = computePaymentStats(input.paidInvoices);
  const patterns = computeBillingPatterns(input.historyInvoices);
  const patternOf = (clientId: string) => patterns[clientId] ?? DEFAULT_BILLING_PATTERN;

  // klienci już zafakturowani w danym okresie (dedup m0 wpływów prognozy)
  const invoicedPeriods = new Map<string, Set<string>>(); // clientId → set periodów
  const invoicedNetInM0 = new Map<string, number>();
  for (const inv of input.historyInvoices) {
    const p = periodOf(inv.saleDate);
    const set = invoicedPeriods.get(inv.clientId) ?? new Set<string>();
    set.add(p);
    invoicedPeriods.set(inv.clientId, set);
    if (p === m0) invoicedNetInM0.set(inv.clientId, (invoicedNetInM0.get(inv.clientId) ?? 0) + inv.netGr);
  }

  // ── Rezydualna baza historyczna (śr. 3 pełne mies.) per kategoria RW ──
  const window3 = [
    addMonthsToPeriod(currentPeriod, -3),
    addMonthsToPeriod(currentPeriod, -2),
    addMonthsToPeriod(currentPeriod, -1),
  ];
  const windowSet = new Set(window3);
  const histCostRows = input.rwHistory.filter((r) => r.kind === "KOSZT" && windowSet.has(r.period));
  const dataMonths = new Set(histCostRows.map((r) => r.period));
  const divisor = Math.max(1, dataMonths.size);
  if (dataMonths.size === 0) {
    warnings.push({ code: "BRAK_HISTORII_RW", message: "Brak historii kosztów RW z ostatnich 3 miesięcy — baza kosztów operacyjnych = 0." });
  }
  const histNet = new Map<string, number>();
  const histGross = new Map<string, number>();
  for (const r of histCostRows) {
    const cat = DEPRECATED_COST_MAP[r.category] ?? r.category;
    histNet.set(cat, (histNet.get(cat) ?? 0) + Math.abs(r.amountGr));
    histGross.set(cat, (histGross.get(cat) ?? 0) + Math.abs(r.grossGr ?? r.amountGr));
  }

  // suma aktywnych szablonów per kategoria RW (do odjęcia od bazy)
  const tplNetByRw = new Map<string, number>();
  const tplGrossByRw = new Map<string, number>();
  const activeTemplates = input.recurring.filter((t) => t.active);
  for (const t of activeTemplates) {
    const rw = FORECAST_COST_CATEGORY_TO_RW[t.categoryName] ?? t.categoryName;
    const { grossGr } = computeVatFromNet(t.netGr, isVatRate(t.vatRate) ? (t.vatRate as VatRate) : "23");
    tplNetByRw.set(rw, (tplNetByRw.get(rw) ?? 0) + t.netGr);
    tplGrossByRw.set(rw, (tplGrossByRw.get(rw) ?? 0) + grossGr);
  }

  const residualNet = new Map<string, number>();
  const residualGross = new Map<string, number>();
  for (const cat of FORECAST_BASELINE_CATEGORIES) {
    const avgNet = Math.round((histNet.get(cat) ?? 0) / divisor);
    const avgGross = Math.round((histGross.get(cat) ?? 0) / divisor);
    residualNet.set(cat, Math.max(0, avgNet - (tplNetByRw.get(cat) ?? 0)));
    residualGross.set(cat, Math.max(0, avgGross - (tplGrossByRw.get(cat) ?? 0)));
  }
  // podatki: średnia 3M (bez odejmowania szablonów)
  const taxAvgGross = new Map<string, number>();
  for (const { category } of FORECAST_TAX_CATEGORIES) {
    taxAvgGross.set(category, Math.round((histGross.get(category) ?? 0) / divisor));
  }

  // ── run-rate (śr. 3 pełne mies. netto zafakturowane) per klient ──
  // dzielimy przez PEŁNĄ liczbę miesięcy okna (3) — miesiąc bez faktury to realne
  // zero, nie brak danych (inaczej niż baza kosztów RW, która bywa rzadka)
  const runRateNet = new Map<string, number>();
  {
    const perClient = new Map<string, number>();
    for (const inv of input.historyInvoices) {
      if (windowSet.has(periodOf(inv.saleDate))) {
        perClient.set(inv.clientId, (perClient.get(inv.clientId) ?? 0) + inv.netGr);
      }
    }
    for (const [clientId, sum] of perClient) runRateNet.set(clientId, Math.round(sum / window3.length));
  }

  // contracted-through per klient: max(endDate, current + noticeMonths)
  const contractedThrough = (c: ForecastClientLike): string => {
    const byNotice = addMonthsToPeriod(currentPeriod, c.noticeMonths ?? 0);
    const byEnd = c.endDate ? periodOf(c.endDate) : null;
    return byEnd && byEnd > byNotice ? byEnd : byNotice;
  };

  // ── P&L per miesiąc + zebranie prognozowanych wpływów do cash ──
  const pnl: PnlMonth[] = [];
  const forecastInflowEvents: CashEvent[] = [];

  for (const period of periods) {
    const revenueLines: PnlRevenueLine[] = [];
    let contractedNet = 0;
    let assumedNet = 0;

    for (const c of input.clients) {
      if (c.status !== "ACTIVE") continue;
      const startOk = !c.startDate || periodOf(c.startDate) <= period;
      const endOk = !c.endDate || period <= periodOf(c.endDate);
      if (!startOk || !endOk) continue;

      const hasRetainer = c.billingModel === "ABONAMENT" && (c.monthlyRetainerGr ?? 0) > 0;
      let netGr = 0;
      let source: PnlRevenueLine["source"] = "RUN_RATE";
      if (hasRetainer) {
        netGr = c.monthlyRetainerGr as number;
        source = "ABONAMENT";
      } else {
        netGr = runRateNet.get(c.id) ?? 0;
        source = "RUN_RATE";
        if (c.billingModel === "ABONAMENT" && period === m0) {
          warnings.push({ code: "ABONAMENT_BEZ_RETAINERA", message: `Klient „${c.name}" ma model ABONAMENT bez kwoty MRR — użyto średniej z faktur.` });
        }
      }
      if (netGr <= 0) continue;

      const contracted = period <= contractedThrough(c);
      // P&L m0: nie zaniżaj, gdy klient już częściowo zafakturował więcej niż model
      const invoicedNet = period === m0 ? invoicedNetInM0.get(c.id) ?? 0 : 0;
      const effNet = period === m0 ? Math.max(netGr, invoicedNet) : netGr;

      revenueLines.push({ clientId: c.id, label: c.name, source, netGr: effNet, contracted });
      if (contracted) contractedNet += effNet;
      else assumedNet += effNet;

      // wpływ do cash — pomiń, gdy klient już zafakturowany w tym okresie
      // (wpływ niesie otwarta faktura); dotyczy praktycznie tylko m0
      const alreadyInvoiced = invoicedPeriods.get(c.id)?.has(period) ?? false;
      if (!alreadyInvoiced) {
        const pat = patternOf(c.id);
        const issueIso = periodDayIso(period, pat.issueDay);
        const dateIso = addDaysIso(issueIso, pat.termDays + effectiveDelayDays(paymentStats, c.id));
        forecastInflowEvents.push({
          dateIso,
          period: periodOf(dateIso),
          amountGr: Math.round(netGr * pat.grossMultiplier),
          source: source === "ABONAMENT" ? "PROGNOZA_MRR" : "PROGNOZA_RUNRATE",
          label: `Prognoza: ${c.name}`,
          clientId: c.id,
          assumed: !contracted,
        });
      }
    }

    // nowy biznes — od m1
    if (period !== m0 && input.assumptions.newBusinessMonthlyGr > 0) {
      const nb = input.assumptions.newBusinessMonthlyGr;
      revenueLines.push({ clientId: null, label: "Nowy biznes (założenie)", source: "NOWY_BIZNES", netGr: nb, contracted: false });
      assumedNet += nb;
      const pat = DEFAULT_BILLING_PATTERN;
      const issueIso = periodDayIso(period, pat.issueDay);
      const dateIso = addDaysIso(issueIso, pat.termDays + effectiveDelayDays(paymentStats, null));
      forecastInflowEvents.push({
        dateIso,
        period: periodOf(dateIso),
        amountGr: Math.round(nb * pat.grossMultiplier),
        source: "NOWY_BIZNES",
        label: "Nowy biznes (założenie)",
        clientId: null,
        assumed: true,
      });
    }

    // koszty P&L (netto) — jednolity model: szablony żywe w m + rezydua operacyjne
    const costLines: PnlCostLine[] = [];
    for (const t of activeTemplates) {
      if (t.endPeriod !== null && period > t.endPeriod) continue;
      costLines.push({ label: `Cykliczny: ${t.supplierName}`, source: "CYKLICZNY", netGr: t.netGr });
    }
    for (const cat of FORECAST_BASELINE_CATEGORIES) {
      const net = residualNet.get(cat) ?? 0;
      if (net > 0) costLines.push({ label: cat, source: "BASELINE_RW", netGr: net });
    }
    const costsNetGr = costLines.reduce((a, l) => a + l.netGr, 0);
    const revenueNetGr = contractedNet + assumedNet;

    pnl.push({
      period,
      revenueNetGr,
      contractedNetGr: contractedNet,
      assumedNetGr: assumedNet,
      invoicedToDateNetGr: period === m0 ? sumMapForClients(invoicedNetInM0) : null,
      costsNetGr,
      profitGr: revenueNetGr - costsNetGr,
      marginFraction: revenueNetGr > 0 ? (revenueNetGr - costsNetGr) / revenueNetGr : null,
      revenueLines,
      costLines,
    });
  }

  // ── Cash flow ──
  let cash: CashMonth[] | null = null;
  let overdueBacklogGr = 0;
  let doubtfulGr = 0;

  // zaległości / wątpliwe liczone niezależnie od snapshotu (KPI)
  for (const inv of input.openInvoices) {
    const daysPastDue = dayDiff(input.todayIso, inv.dueDate);
    if (daysPastDue > DOUBTFUL_DAYS) doubtfulGr += inv.grossGr;
    else if (daysPastDue > 0) overdueBacklogGr += inv.grossGr;
  }

  if (!input.snapshot) {
    warnings.push({ code: "BRAK_SNAPSHOTU", message: "Brak stanu kont — cash flow niedostępny. Wpisz aktualny stan kont, aby prognozować gotówkę." });
  } else {
    const snapIso = input.snapshot.dateIso;
    if (dayDiff(input.todayIso, snapIso) > SNAPSHOT_STALE_DAYS) {
      warnings.push({ code: "SNAPSHOT_NIEAKTUALNY", message: `Stan kont sprzed ponad ${SNAPSHOT_STALE_DAYS} dni — zaktualizuj dla wiarygodnej prognozy.` });
    }
    const events: CashEvent[] = [...forecastInflowEvents];

    // otwarte faktury (należności) — brutto, timing due + opóźnienie; > 90 dni → wątpliwe (pomiń)
    for (const inv of input.openInvoices) {
      const daysPastDue = dayDiff(input.todayIso, inv.dueDate);
      if (daysPastDue > DOUBTFUL_DAYS) continue;
      const paidIso = addDaysIso(inv.dueDate, effectiveDelayDays(paymentStats, inv.clientId));
      const dateIso = paidIso < snapIso ? snapIso : paidIso;
      events.push({ dateIso, period: periodOf(dateIso), amountGr: inv.grossGr, source: "FAKTURA_OTWARTA", label: "Otwarta faktura", clientId: inv.clientId, assumed: false });
    }
    // faktury opłacone PO snapshocie
    for (const inv of input.paidAfterSnapshotInvoices) {
      events.push({ dateIso: inv.paidDate, period: periodOf(inv.paidDate), amountGr: inv.grossGr, source: "FAKTURA_OPLACONA_PO_SNAPSHOT", label: "Wpłata (po stanie kont)", clientId: inv.clientId, assumed: false });
    }
    // otwarte koszty (płatności) — brutto ujemne; opłacone po snapshocie → paidDate
    for (const c of input.openCosts) {
      const baseDue = c.dueDate ?? addDaysIso(c.docDate, 14);
      let dateIso: string;
      if (c.paidDate) dateIso = c.paidDate;
      else dateIso = baseDue < snapIso ? snapIso : baseDue;
      events.push({
        dateIso,
        period: periodOf(dateIso),
        amountGr: -c.grossGr,
        source: c.recurringCostId ? "KOSZT_CYKLICZNY" : "KOSZT_JEDNORAZOWY",
        label: c.supplierName,
        clientId: null,
        assumed: false,
      });
    }
    // projekcja szablonów — tylko miesiące jeszcze niezmaterializowane (> lastGeneratedPeriod)
    for (const t of activeTemplates) {
      const { grossGr } = computeVatFromNet(t.netGr, isVatRate(t.vatRate) ? (t.vatRate as VatRate) : "23");
      for (const period of periods) {
        if (t.lastGeneratedPeriod !== null && period <= t.lastGeneratedPeriod) continue;
        if (t.endPeriod !== null && period > t.endPeriod) continue;
        const dateIso = periodDayIso(period, t.dueDayOfMonth);
        events.push({ dateIso, period, amountGr: -grossGr, source: "KOSZT_CYKLICZNY", label: `Cykliczny: ${t.supplierName}`, clientId: null, assumed: false });
      }
    }
    // rezydua kategorii operacyjnych — tylko PRZYSZŁE miesiące (m0 pokryty znanymi kosztami)
    for (const period of periods) {
      if (period === m0) continue;
      for (const cat of FORECAST_BASELINE_CATEGORIES) {
        const gross = residualGross.get(cat) ?? 0;
        if (gross <= 0) continue;
        const dateIso = periodDayIso(period, baselinePayDay(cat));
        events.push({ dateIso, period, amountGr: -gross, source: "BASELINE_RW", label: cat, clientId: null, assumed: true });
      }
    }
    // podatki — wszystkie miesiące, dzień ustawowy; filtr daty odetnie już zapłacone w m0
    for (const period of periods) {
      for (const { category, payDay } of FORECAST_TAX_CATEGORIES) {
        const gross = taxAvgGross.get(category) ?? 0;
        if (gross <= 0) continue;
        const dateIso = periodDayIso(period, payDay);
        events.push({ dateIso, period, amountGr: -gross, source: "PODATKI", label: category, clientId: null, assumed: true });
      }
    }
    // zdarzenia jednorazowe (dzień 15.)
    for (const e of input.events) {
      if (!periodSet.has(e.period)) {
        if (e.period < m0) warnings.push({ code: "ZDARZENIE_W_PRZESZLOSCI", message: `Zdarzenie „${e.label}" (${e.period}) jest w przeszłości — pominięte.` });
        continue;
      }
      const dateIso = periodDayIso(e.period, 15);
      const signed = e.kind === "OUTFLOW" ? -e.amountGr : e.amountGr;
      events.push({ dateIso, period: e.period, amountGr: signed, source: "ZDARZENIE", label: e.label, clientId: null, assumed: false });
    }

    // filtr: tylko od dnia snapshotu i w horyzoncie
    const live = events.filter((e) => e.dateIso >= snapIso && periodSet.has(e.period));
    cash = assembleCashMonths(live, periods, input.snapshot.balanceGr, m0, snapIso);
  }

  // ── KPI ──
  const cashKpis = cash
    ? cashKpisFrom(cash)
    : {
        closingEndGr: null as number | null,
        minBalanceGr: null as number | null,
        minBalanceDateIso: null as string | null,
        firstNegativePeriod: null as string | null,
      };

  return {
    periods,
    pnl,
    cash,
    kpis: { ...cashKpis, overdueBacklogGr, doubtfulGr },
    paymentStats,
    warnings,
    snapshotDateIso: input.snapshot ? input.snapshot.dateIso : null,
  };
}

function sumMapForClients(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

// ── Scenariusz AI (czysta transformacja baseline'u) ──────────────────

export interface AiMonthAdjustment {
  period: string;
  revenueAdjPct: number; // korekta % przychodów ZAKŁADANYCH (nie umownych)
  costAdjPct: number; // korekta % kosztów bazowych (BASELINE_RW)
  note: string;
}

/** Wynik analizy AI (typ współdzielony klient↔serwer; kalkulacja w lib/forecast-ai). */
export interface ForecastAiReview {
  adjustments: AiMonthAdjustment[];
  risks: string[];
  narrative: string;
  confidence: "high" | "medium" | "low";
}

/**
 * Nakłada korekty AI na baseline — skaluje WYŁĄCZNIE składniki zakładane
 * (assumed): przychody nie-umowne i koszty bazowe (BASELINE_RW). Znane faktury,
 * szablony, podatki i zdarzenia pozostają nietknięte. Przelicza P&L, cash
 * (łańcuch salda) i KPI. Funkcja czysta — używana po stronie klienta do
 * przełączania scenariusza baseline ↔ AI (bez ponownego wywołania modelu).
 */
export function applyAiAdjustments(
  base: ForecastResult,
  adjustments: AiMonthAdjustment[]
): ForecastResult {
  const byPeriod = new Map(adjustments.map((a) => [a.period, a]));

  const pnl = base.pnl.map((m) => {
    const adj = byPeriod.get(m.period);
    if (!adj) return m;
    const revF = 1 + adj.revenueAdjPct / 100;
    const costF = 1 + adj.costAdjPct / 100;
    const assumedNetGr = Math.round(m.assumedNetGr * revF);
    const revenueNetGr = m.contractedNetGr + assumedNetGr;
    const revenueLines = m.revenueLines.map((l) =>
      l.contracted ? l : { ...l, netGr: Math.round(l.netGr * revF) }
    );
    const costLines = m.costLines.map((l) =>
      l.source === "BASELINE_RW" ? { ...l, netGr: Math.round(l.netGr * costF) } : l
    );
    const costsNetGr = costLines.reduce((a, l) => a + l.netGr, 0);
    return {
      ...m,
      assumedNetGr,
      revenueNetGr,
      revenueLines,
      costLines,
      costsNetGr,
      profitGr: revenueNetGr - costsNetGr,
      marginFraction: revenueNetGr > 0 ? (revenueNetGr - costsNetGr) / revenueNetGr : null,
    };
  });

  let cash = base.cash;
  let kpis = base.kpis;
  if (base.cash && base.snapshotDateIso) {
    const m0 = base.periods[0];
    const scaled: CashEvent[] = [];
    for (const mo of base.cash) {
      const adj = byPeriod.get(mo.period);
      for (const e of mo.events) {
        if (!adj || !e.assumed) {
          scaled.push(e);
          continue;
        }
        const f = e.amountGr >= 0 ? 1 + adj.revenueAdjPct / 100 : 1 + adj.costAdjPct / 100;
        scaled.push({ ...e, amountGr: Math.round(e.amountGr * f) });
      }
    }
    const opening = base.cash[0].openingGr;
    cash = assembleCashMonths(scaled, base.periods, opening, m0, base.snapshotDateIso);
    kpis = {
      ...cashKpisFrom(cash),
      overdueBacklogGr: base.kpis.overdueBacklogGr,
      doubtfulGr: base.kpis.doubtfulGr,
    };
  }

  return { ...base, pnl, cash, kpis };
}
