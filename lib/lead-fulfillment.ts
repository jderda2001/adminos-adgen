// Realizacja kontraktów leadowych (czysty silnik, testowany).
//
// Kontrakt = liczba leadów sprzedana klientowi na fakturze „PAKIETY LEADÓW"
// (leadsQty) w danym miesiącu, per klient × wertykal. Dostarczone = LeadDelivery.
// Zaległości PRZENOSZĄ się na kolejne miesiące (auto): bieżące zobowiązanie =
// nierozliczony bilans z przeszłości + kontrakt tego miesiąca; nadwyżka (dowieziono
// więcej) zmniejsza dług. Bilans liczymy narastająco z całej historii, więc
// nie trzeba go nigdzie zapisywać.
//
// Na tej bazie estymujemy: ile jeszcze trzeba wydać w Mecie (brakujące leady ×
// CPL z ostatniego okresu) i o ile zwiększyć budżet per wertykal.

export interface InvoiceLeadLine {
  clientId: string;
  vertical: string;
  period: string; // "RRRR-MM"
  leadsQty: number;
}

export interface DeliveryLine {
  clientId: string;
  vertical: string;
  period: string; // "RRRR-MM"
  leadsCount: number;
}

export interface ClientVerticalStatus {
  clientId: string;
  vertical: string;
  contractedThisMonth: number; // leadów zakontraktowanych (z faktur) w tym miesiącu
  deliveredThisMonth: number; // leadów dostarczonych w tym miesiącu
  carriedIn: number; // dług przeniesiony z poprzednich miesięcy (może być ujemny = nadwyżka)
  owed: number; // carriedIn + contractedThisMonth (łączne zobowiązanie na ten miesiąc)
  balance: number; // owed − deliveredThisMonth (>0 dług, <0 nadwyżka)
}

const keyOf = (clientId: string, vertical: string) => `${clientId}|${vertical}`;

/**
 * Status realizacji per klient × wertykal dla danego miesiąca, z uwzględnieniem
 * przeniesionego długu. Bierze pod uwagę wszystkie faktury i dostawy (również
 * z wcześniejszych miesięcy) — miesiące > `month` są ignorowane.
 */
export function buildDeliveryStatus(
  month: string,
  invoices: readonly InvoiceLeadLine[],
  deliveries: readonly DeliveryLine[]
): ClientVerticalStatus[] {
  const acc = new Map<
    string,
    {
      clientId: string;
      vertical: string;
      contractedThisMonth: number;
      deliveredThisMonth: number;
      contractedBefore: number;
      deliveredBefore: number;
    }
  >();
  const get = (clientId: string, vertical: string) => {
    const k = keyOf(clientId, vertical);
    let v = acc.get(k);
    if (!v) {
      v = {
        clientId,
        vertical,
        contractedThisMonth: 0,
        deliveredThisMonth: 0,
        contractedBefore: 0,
        deliveredBefore: 0,
      };
      acc.set(k, v);
    }
    return v;
  };

  for (const inv of invoices) {
    if (inv.period > month) continue;
    const v = get(inv.clientId, inv.vertical);
    if (inv.period === month) v.contractedThisMonth += inv.leadsQty;
    else v.contractedBefore += inv.leadsQty;
  }
  for (const d of deliveries) {
    if (d.period > month) continue;
    const v = get(d.clientId, d.vertical);
    if (d.period === month) v.deliveredThisMonth += d.leadsCount;
    else v.deliveredBefore += d.leadsCount;
  }

  return [...acc.values()]
    .map((v) => {
      const carriedIn = v.contractedBefore - v.deliveredBefore;
      const owed = carriedIn + v.contractedThisMonth;
      return {
        clientId: v.clientId,
        vertical: v.vertical,
        contractedThisMonth: v.contractedThisMonth,
        deliveredThisMonth: v.deliveredThisMonth,
        carriedIn,
        owed,
        balance: owed - v.deliveredThisMonth,
      };
    })
    // pokazujemy tylko pary, które kiedykolwiek miały kontrakt lub dostawę w tym
    // miesiącu (albo mają otwarty bilans) — puste pomijamy
    .filter(
      (s) =>
        s.contractedThisMonth !== 0 || s.deliveredThisMonth !== 0 || s.balance !== 0
    );
}

export interface VerticalPlan {
  vertical: string;
  remaining: number; // brakujące leady do dowiezienia (suma dodatnich bilansów)
  cplGr: number | null; // CPL z ostatniego okresu (per wertykal)
  neededSpendGr: number; // remaining × CPL — ile DOŁOŻYĆ, by dowieźć brakujące
  spentGr: number; // już wydane w tym miesiącu (Meta) na ten wertykal (kontekst)
  budgetIncreaseGr: number; // = neededSpendGr (brakujące leady są PONAD dostarczone)
}

export interface FulfillmentPlan {
  verticals: VerticalPlan[];
  totalRemaining: number;
  totalNeededSpendGr: number;
  totalSpentGr: number;
  totalBudgetIncreaseGr: number;
}

/**
 * Plan dowiezienia: dla każdego wertykalu bierze brakujące leady (suma dodatnich
 * bilansów klientów) i mnoży przez CPL z ostatniego okresu → ile trzeba wydać.
 * Wzrost budżetu = ile jeszcze ponad już wydane w tym miesiącu.
 */
export function buildFulfillmentPlan(
  statuses: readonly ClientVerticalStatus[],
  cplByVertical: Readonly<Record<string, number | null>>,
  spentByVertical: Readonly<Record<string, number>>
): FulfillmentPlan {
  const remainingByVertical = new Map<string, number>();
  for (const s of statuses) {
    if (s.balance > 0) {
      remainingByVertical.set(s.vertical, (remainingByVertical.get(s.vertical) ?? 0) + s.balance);
    }
  }
  // uwzględnij też wertykały, na które coś wydano, choć nic nie zalegają (spent>0)
  for (const v of Object.keys(spentByVertical)) {
    if (!remainingByVertical.has(v)) remainingByVertical.set(v, 0);
  }

  const verticals: VerticalPlan[] = [...remainingByVertical.entries()]
    .map(([vertical, remaining]) => {
      const cplGr = cplByVertical[vertical] ?? null;
      const neededSpendGr = cplGr !== null ? Math.round(remaining * cplGr) : 0;
      const spentGr = spentByVertical[vertical] ?? 0;
      return {
        vertical,
        remaining,
        cplGr,
        neededSpendGr,
        spentGr,
        // brakujące leady są PONAD już dostarczone → dokładamy pełny koszt ich
        // wygenerowania (nie odejmujemy dotychczasowego spendu)
        budgetIncreaseGr: neededSpendGr,
      };
    })
    .sort((a, b) => b.budgetIncreaseGr - a.budgetIncreaseGr || b.remaining - a.remaining);

  return {
    verticals,
    totalRemaining: verticals.reduce((s, v) => s + v.remaining, 0),
    totalNeededSpendGr: verticals.reduce((s, v) => s + v.neededSpendGr, 0),
    totalSpentGr: verticals.reduce((s, v) => s + v.spentGr, 0),
    totalBudgetIncreaseGr: verticals.reduce((s, v) => s + v.budgetIncreaseGr, 0),
  };
}
