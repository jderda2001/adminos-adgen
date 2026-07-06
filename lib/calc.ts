// Czyste funkcje wyliczeń finansowych — bez dostępu do bazy, testowane jednostkowo.
//
// Zasady:
// - wszystkie kwoty w groszach (int), agregaty na kwotach NETTO, VAT osobno
// - przychód liczony po dacie sprzedaży, koszt po dacie dokumentu
// - szkice faktur (DRAFT) nie liczą się do przychodów ani VAT
// - koszty cykliczne czekające na zatwierdzenie (needsConfirmation) nie liczą się do agregatów
//
// Zgodność w pionie (rentowność ↔ dashboard):
// Stawki godzinowe pracowników reprezentują koszt wynagrodzeń, dlatego kategoria
// "wynagrodzenia" jest wyłączona z puli alokacji kosztów ogólnych (inaczej liczylibyśmy
// pensje podwójnie: raz jako koszt pracy z godzin, drugi raz w alokacji).
// Zachodzi tożsamość:
//   suma zysków klientów
//     − koszty ogólne niealokowane (pula pozapłacowa minus alokacja)
//     − wynagrodzenia niepokryte godzinami (koszty wynagrodzeń − koszt pracy z godzin)
//   = zysk firmy (przychody − wszystkie koszty)

import { VAT_RATE_FRACTIONS, type VatRate } from "./types";

// ── Kwoty pozycji i dokumentów ───────────────────────────────────────

export interface Amounts {
  netGr: number;
  vatGr: number;
  grossGr: number;
}

/** Kwoty pozycji faktury: netto = zaokr(ilość × cena jedn.), VAT = zaokr(netto × stawka) */
export function computeItemAmounts(
  quantity: number,
  unitNetGr: number,
  vatRate: VatRate
): Amounts {
  const netGr = Math.round(quantity * unitNetGr);
  const vatGr = Math.round(netGr * VAT_RATE_FRACTIONS[vatRate]);
  return { netGr, vatGr, grossGr: netGr + vatGr };
}

/** VAT i brutto od kwoty netto (koszty) */
export function computeVatFromNet(netGr: number, vatRate: VatRate): Amounts {
  const vatGr = Math.round(netGr * VAT_RATE_FRACTIONS[vatRate]);
  return { netGr, vatGr, grossGr: netGr + vatGr };
}

/** Suma pozycji faktury */
export function sumAmounts(items: Amounts[]): Amounts {
  return items.reduce(
    (acc, i) => ({
      netGr: acc.netGr + i.netGr,
      vatGr: acc.vatGr + i.vatGr,
      grossGr: acc.grossGr + i.grossGr,
    }),
    { netGr: 0, vatGr: 0, grossGr: 0 }
  );
}

// ── Stawki i koszt pracy ─────────────────────────────────────────────

export interface RateRecord {
  ratePerHourGr: number;
  validFrom: Date;
}

/**
 * Stawka obowiązująca w danym dniu = najnowsza stawka z validFrom <= data.
 * Zwraca 0, gdy pracownik nie miał jeszcze żadnej stawki w tym dniu.
 */
export function effectiveRateGr(rates: RateRecord[], date: Date): number {
  let best: RateRecord | null = null;
  for (const r of rates) {
    if (r.validFrom.getTime() <= date.getTime()) {
      if (!best || r.validFrom.getTime() > best.validFrom.getTime()) best = r;
    }
  }
  return best?.ratePerHourGr ?? 0;
}

/** Koszt pracy wpisu: zaokr(minuty × stawka / 60) */
export function laborCostGr(minutes: number, ratePerHourGr: number): number {
  return Math.round((minutes * ratePerHourGr) / 60);
}

// ── Rentowność klientów i zgodność w pionie ─────────────────────────

export interface RevenueByClient {
  clientId: string;
  netGr: number;
}

export interface CostRecord {
  clientId: string | null; // null = koszt ogólny
  categoryId: string;
  netGr: number;
}

export interface LaborByClient {
  clientId: string;
  minutes: number;
  laborGr: number;
}

export interface ClientProfitRow {
  clientId: string;
  revenueGr: number;
  directCostsGr: number;
  laborGr: number;
  minutes: number;
  allocationGr: number;
  profitGr: number;
  /** zysk / przychody; null gdy przychody = 0 */
  marginFraction: number | null;
  /** przychody / godziny (gr/h); null gdy brak godzin */
  effectiveRateGr: number | null;
}

export interface ProfitabilityResult {
  rows: ClientProfitRow[];
  /** pula alokacji: koszty ogólne bez kategorii wynagrodzeń */
  generalPoolGr: number;
  /** suma alokacji przypisanej klientom */
  allocatedGr: number;
  /** koszty ogólne niealokowane (pula − alokacja; cała pula gdy alokacja wyłączona) */
  unallocatedGeneralGr: number;
  /** koszty z kategorii "wynagrodzenia" (ogólne i przypisane do klientów) */
  salaryCostsGr: number;
  /** łączny koszt pracy z godzin */
  laborTotalGr: number;
  /** wynagrodzenia niepokryte godzinami: salaryCostsGr − laborTotalGr */
  salariesNotCoveredGr: number;
  /** zysk firmy: przychody − wszystkie koszty (jak na Dashboardzie) */
  companyProfitGr: number;
  /** suma zysków klientów */
  clientProfitSumGr: number;
}

/**
 * Rentowność per klient + uzgodnienie z zyskiem firmy.
 *
 * Koszty bezpośrednie klienta = koszty z przypisanym clientId, NIEZALEŻNIE od kategorii,
 * z wyjątkiem kategorii wynagrodzeń (pensje rozliczane są wyłącznie kosztem pracy z godzin).
 * Kategorii wynagrodzeń może być kilka (np. "Wypłaty | Zarząd" i "Wypłaty | Zespół").
 * Alokacja: pula kosztów ogólnych (bez wynagrodzeń) × udział klienta w przychodach okresu.
 */
export function computeProfitability(input: {
  revenues: RevenueByClient[];
  costs: CostRecord[];
  labor: LaborByClient[];
  salaryCategoryIds: ReadonlySet<string>;
  allocationEnabled: boolean;
}): ProfitabilityResult {
  const { revenues, costs, labor, salaryCategoryIds, allocationEnabled } = input;

  const revenueMap = new Map<string, number>();
  for (const r of revenues) {
    revenueMap.set(r.clientId, (revenueMap.get(r.clientId) ?? 0) + r.netGr);
  }

  let salaryCostsGr = 0;
  let generalPoolGr = 0;
  const directMap = new Map<string, number>();
  let totalCostsGr = 0;

  for (const c of costs) {
    totalCostsGr += c.netGr;
    if (salaryCategoryIds.has(c.categoryId)) {
      salaryCostsGr += c.netGr;
      continue; // wynagrodzenia: nie wchodzą ani do kosztów bezpośrednich, ani do puli alokacji
    }
    if (c.clientId === null) {
      generalPoolGr += c.netGr;
    } else {
      directMap.set(c.clientId, (directMap.get(c.clientId) ?? 0) + c.netGr);
    }
  }

  const laborMap = new Map<string, { minutes: number; laborGr: number }>();
  let laborTotalGr = 0;
  for (const l of labor) {
    const prev = laborMap.get(l.clientId) ?? { minutes: 0, laborGr: 0 };
    laborMap.set(l.clientId, {
      minutes: prev.minutes + l.minutes,
      laborGr: prev.laborGr + l.laborGr,
    });
    laborTotalGr += l.laborGr;
  }

  const clientIds = new Set<string>([
    ...revenueMap.keys(),
    ...directMap.keys(),
    ...laborMap.keys(),
  ]);

  const totalRevenueGr = [...revenueMap.values()].reduce((a, b) => a + b, 0);

  let allocatedGr = 0;
  const rows: ClientProfitRow[] = [];
  for (const clientId of clientIds) {
    const revenueGr = revenueMap.get(clientId) ?? 0;
    const directCostsGr = directMap.get(clientId) ?? 0;
    const laborEntry = laborMap.get(clientId) ?? { minutes: 0, laborGr: 0 };

    let allocationGr = 0;
    if (allocationEnabled && totalRevenueGr > 0 && revenueGr > 0) {
      allocationGr = Math.round((generalPoolGr * revenueGr) / totalRevenueGr);
    }
    allocatedGr += allocationGr;

    const profitGr =
      revenueGr - directCostsGr - laborEntry.laborGr - allocationGr;

    rows.push({
      clientId,
      revenueGr,
      directCostsGr,
      laborGr: laborEntry.laborGr,
      minutes: laborEntry.minutes,
      allocationGr,
      profitGr,
      marginFraction: revenueGr > 0 ? profitGr / revenueGr : null,
      effectiveRateGr:
        laborEntry.minutes > 0
          ? Math.round(revenueGr / (laborEntry.minutes / 60))
          : null,
    });
  }

  rows.sort((a, b) => b.profitGr - a.profitGr);

  // niealokowana reszta liczona różnicą — pochłania grosze z zaokrągleń,
  // dzięki czemu tożsamość pionowa zachodzi co do grosza
  const unallocatedGeneralGr = generalPoolGr - allocatedGr;
  const salariesNotCoveredGr = salaryCostsGr - laborTotalGr;
  const companyProfitGr = totalRevenueGr - totalCostsGr;
  const clientProfitSumGr = rows.reduce((a, r) => a + r.profitGr, 0);

  return {
    rows,
    generalPoolGr,
    allocatedGr,
    unallocatedGeneralGr,
    salaryCostsGr,
    laborTotalGr,
    salariesNotCoveredGr,
    companyProfitGr,
    clientProfitSumGr,
  };
}

// ── P&L firmy, VAT, należności ───────────────────────────────────────

export interface PnL {
  revenueNetGr: number;
  costsNetGr: number;
  profitGr: number;
  /** zysk / przychody; null gdy przychody = 0 */
  marginFraction: number | null;
}

export function computePnL(revenueNetGr: number, costsNetGr: number): PnL {
  const profitGr = revenueNetGr - costsNetGr;
  return {
    revenueNetGr,
    costsNetGr,
    profitGr,
    marginFraction: revenueNetGr > 0 ? profitGr / revenueNetGr : null,
  };
}

export interface VatSummary {
  outputVatGr: number; // VAT należny (sprzedaż)
  inputVatGr: number; // VAT naliczony (koszty)
  dueGr: number; // do zapłaty (może być ujemny = nadwyżka naliczonego)
}

export function computeVatSummary(
  outputVatGr: number,
  inputVatGr: number
): VatSummary {
  return { outputVatGr, inputVatGr, dueGr: outputVatGr - inputVatGr };
}
