// Ekonomika marek wewnętrznych (czysta, testowana): ile leadów wygenerowała
// marka w miesiącu, za ile, jaki przychód z dostarczonych leadów (ceny
// jednostkowe z faktur), marża oraz budżet plan vs wydane.
//
// Przychód wyceniamy per dostawa: cena (klient × wertykal) → fallback średnia
// cena wertykalu → lead bez ceny liczony do `unpricedLeads` (nie zaniżamy
// marży cicho). Dostawy „mix marek" (brandId=null) nie wchodzą do kart marek.

export interface BrandLike {
  id: string;
  name: string;
}

export interface BrandCampaignMonthLike {
  brandId: string;
  vertical: string;
  spendGr: number;
  leadsCount: number;
}

export interface BrandVerticalStat {
  vertical: string;
  leadsCount: number;
  spendGr: number;
  cplGr: number | null;
}

export interface BrandDeliveryLike {
  brandId: string | null;
  clientId: string;
  vertical: string;
  leadsCount: number;
}

export interface BrandAccountLike {
  brandId: string | null;
  adAccountName: string;
  ignored: boolean;
}

export interface BrandEconRow {
  brandId: string;
  brandName: string;
  accountNames: string[]; // przypisane konta reklamowe (do podpisu na karcie)
  leadsCount: number; // leady z kampanii Meta/ręcznych
  spendGr: number;
  cplGr: number | null;
  verticals: BrandVerticalStat[]; // rozbicie per wertykal (sort: spend malejąco)
  deliveredLeads: number; // leady dostarczone klientom (z tej marki)
  revenueGr: number; // wycena dostaw po cenach jednostkowych (tylko wycenione)
  unpricedLeads: number; // dostarczone leady bez znanej ceny
  marginGr: number | null; // revenue − spend (null gdy brak przychodu i spendu)
  marginPct: number | null; // margin / revenue
  budgetGr: number | null; // plan z BrandBudget (null = nie ustawiono)
  remainingGr: number | null; // budget − spend (może być ujemne = przepał)
  usedPct: number | null; // spend / budget, w %
}

export function buildBrandEconomics(input: {
  brands: readonly BrandLike[];
  campaigns: readonly BrandCampaignMonthLike[];
  deliveries: readonly BrandDeliveryLike[];
  /** klucz `${clientId}|${vertical}` → cena netto gr */
  unitPriceByClientVertical: ReadonlyMap<string, number>;
  unitPriceByVertical: Readonly<Record<string, number>>;
  budgets: ReadonlyMap<string, number>;
  accounts: readonly BrandAccountLike[];
}): BrandEconRow[] {
  const spend = new Map<string, { spendGr: number; leadsCount: number }>();
  const byVertical = new Map<string, Map<string, { spendGr: number; leadsCount: number }>>();
  for (const c of input.campaigns) {
    const prev = spend.get(c.brandId) ?? { spendGr: 0, leadsCount: 0 };
    prev.spendGr += c.spendGr;
    prev.leadsCount += c.leadsCount;
    spend.set(c.brandId, prev);

    const vMap = byVertical.get(c.brandId) ?? new Map();
    const vPrev = vMap.get(c.vertical) ?? { spendGr: 0, leadsCount: 0 };
    vPrev.spendGr += c.spendGr;
    vPrev.leadsCount += c.leadsCount;
    vMap.set(c.vertical, vPrev);
    byVertical.set(c.brandId, vMap);
  }

  const rev = new Map<string, { revenueGr: number; delivered: number; unpriced: number }>();
  for (const d of input.deliveries) {
    if (!d.brandId) continue; // mix marek — poza kartami
    const r = rev.get(d.brandId) ?? { revenueGr: 0, delivered: 0, unpriced: 0 };
    r.delivered += d.leadsCount;
    const price =
      input.unitPriceByClientVertical.get(`${d.clientId}|${d.vertical}`) ??
      input.unitPriceByVertical[d.vertical];
    if (price !== undefined) r.revenueGr += d.leadsCount * price;
    else r.unpriced += d.leadsCount;
    rev.set(d.brandId, r);
  }

  const accountsByBrand = new Map<string, string[]>();
  for (const a of input.accounts) {
    if (!a.brandId || a.ignored) continue;
    const list = accountsByBrand.get(a.brandId) ?? [];
    list.push(a.adAccountName);
    accountsByBrand.set(a.brandId, list);
  }

  return input.brands.map((b) => {
    const s = spend.get(b.id) ?? { spendGr: 0, leadsCount: 0 };
    const r = rev.get(b.id) ?? { revenueGr: 0, delivered: 0, unpriced: 0 };
    const verticals: BrandVerticalStat[] = [...(byVertical.get(b.id) ?? new Map()).entries()]
      .map(([vertical, v]) => ({
        vertical,
        leadsCount: v.leadsCount,
        spendGr: v.spendGr,
        cplGr: v.leadsCount > 0 ? Math.round(v.spendGr / v.leadsCount) : null,
      }))
      .sort((a, x) => x.spendGr - a.spendGr);
    const budgetGr = input.budgets.get(b.id) ?? null;
    const hasAny = s.spendGr !== 0 || r.revenueGr !== 0;
    const marginGr = hasAny ? r.revenueGr - s.spendGr : null;
    return {
      brandId: b.id,
      brandName: b.name,
      accountNames: (accountsByBrand.get(b.id) ?? []).sort((x, y) => x.localeCompare(y, "pl")),
      leadsCount: s.leadsCount,
      spendGr: s.spendGr,
      cplGr: s.leadsCount > 0 ? Math.round(s.spendGr / s.leadsCount) : null,
      verticals,
      deliveredLeads: r.delivered,
      revenueGr: r.revenueGr,
      unpricedLeads: r.unpriced,
      marginGr,
      marginPct: marginGr !== null && r.revenueGr > 0 ? marginGr / r.revenueGr : null,
      budgetGr,
      remainingGr: budgetGr !== null ? budgetGr - s.spendGr : null,
      usedPct: budgetGr !== null && budgetGr > 0 ? Math.round((s.spendGr / budgetGr) * 100) : null,
    };
  });
}

/** Dni do końca miesiąca (łącznie z dziś) dla miesiąca "RRRR-MM" względem `today` (UTC). */
export function daysLeftInMonth(month: string, today: Date): number {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const curKey = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}`;
  if (month < curKey) return 0;
  if (month > curKey) return daysInMonth;
  return daysInMonth - today.getUTCDate() + 1;
}
