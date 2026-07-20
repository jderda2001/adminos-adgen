// Wspólne parsowanie filtrów listy kosztów z parametrów URL —
// używane przez stronę Kosztów i eksport CSV (te same wyniki).

import type { Prisma } from "@prisma/client";
import { resolvePeriod, type Period } from "@/lib/periods";

export interface CostFilterParams {
  okres?: string;
  od?: string;
  do?: string;
  /** id kategorii kosztu; brak = wszystkie */
  kategoria?: string;
  /** "ogolny" = koszty ogólne (bez klienta), id klienta, brak = wszystkie */
  przypisanie?: string;
  /** "zaplacone" | "niezaplacone"; brak = wszystkie */
  platnosc?: string;
}

/**
 * Buduje warunek Prisma dla listy kosztów. Domyślnie bez kopii czekających na
 * zatwierdzenie (needsConfirmation). Z `plannedFrom` pokazuje też ZAPLANOWANE
 * kopie cykliczne z przyszłości (docDate ≥ plannedFrom) — do estymacji w tabeli
 * per miesiąc; kopie bieżącego miesiąca zostają w kolejce „Do potwierdzenia".
 */
export function buildCostFilters(
  params: CostFilterParams,
  opts?: { plannedFrom?: Date }
): {
  period: Period;
  where: Prisma.CostWhereInput;
} {
  const period = resolvePeriod(params);
  const where: Prisma.CostWhereInput = {
    docDate: { gte: period.from, lt: period.to },
  };
  if (opts?.plannedFrom) {
    where.OR = [
      { needsConfirmation: false },
      { needsConfirmation: true, docDate: { gte: opts.plannedFrom } },
    ];
  } else {
    where.needsConfirmation = false;
  }
  if (params.kategoria) where.categoryId = params.kategoria;
  if (params.przypisanie === "ogolny") where.clientId = null;
  else if (params.przypisanie) where.clientId = params.przypisanie;
  if (params.platnosc === "zaplacone") where.paid = true;
  else if (params.platnosc === "niezaplacone") where.paid = false;
  return { period, where };
}
