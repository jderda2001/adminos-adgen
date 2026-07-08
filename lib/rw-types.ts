// Rachunek wyników (RW) — taksonomia kategorii odwzorowana 1:1 z arkusza
// „Rachunek wyników 2026 (adGen)". To NAJWAŻNIEJSZY moduł systemu — na jego
// podstawie oceniana jest rentowność firmy. Struktura:
//
//   PRZYCHODY (4 kategorie)
//   KOSZTY PRODUKCYJNE (delivery)
//   KOSZTY MARKETINGU I SPRZEDAŻY (growth)
//   KOSZTY OVERHEAD (zarząd, biuro, administracja)
//   ODŁOŻONE ŚRODKI (oszczędności, zaliczki) — poza „Koszty (łącznie)"
//   CIT — podatek, osobna linia (Zysk po podatkach = Zysk − CIT)
//
// Kwoty w groszach (Int): przychody dodatnie, koszty/odłożone/CIT ujemne.

export type RwKind = "PRZYCHOD" | "KOSZT";

export type RwBucket =
  | "PRZYCHODY"
  | "DELIVERY"
  | "GROWTH"
  | "OVERHEAD"
  | "ODLOZONE"
  | "CIT";

export const RW_BUCKET_LABELS: Record<RwBucket, string> = {
  PRZYCHODY: "Przychody",
  DELIVERY: "Koszty produkcyjne (delivery)",
  GROWTH: "Koszty marketingu i sprzedaży (growth)",
  OVERHEAD: "Koszty overhead (zarząd, biuro, administracja)",
  ODLOZONE: "Odłożone środki",
  CIT: "Podatek CIT",
};

export interface RwCategoryDef {
  /** dokładna nazwa kategorii w CSV i w arkuszu — klucz kanoniczny */
  name: string;
  kind: RwKind;
  bucket: RwBucket;
}

// Kolejność = kolejność wierszy w arkuszu (i w tabeli UI).
export const RW_CATEGORIES: readonly RwCategoryDef[] = [
  // PRZYCHODY — wartości kolumny „Typ Przychodu" w CSV przychodów
  { name: "Abonament marketingowy", kind: "PRZYCHOD", bucket: "PRZYCHODY" },
  { name: "Paczki leadów (stała współpraca)", kind: "PRZYCHOD", bucket: "PRZYCHODY" },
  { name: "Paczki leadów (pilotaż)", kind: "PRZYCHOD", bucket: "PRZYCHODY" },
  { name: "Inne", kind: "PRZYCHOD", bucket: "PRZYCHODY" },

  // KOSZTY PRODUKCYJNE (delivery)
  { name: "Delivery - wynagrodzenia", kind: "KOSZT", bucket: "DELIVERY" },
  { name: "Delivery - abonamenty pozostałe", kind: "KOSZT", bucket: "DELIVERY" },
  { name: "Delivery - budżet reklamowy", kind: "KOSZT", bucket: "DELIVERY" },
  { name: "Delivery - podwykonawcy", kind: "KOSZT", bucket: "DELIVERY" },
  { name: "ZUS", kind: "KOSZT", bucket: "DELIVERY" },

  // KOSZTY MARKETINGU I SPRZEDAŻY (growth)
  { name: "Marketing - budżety", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Marketing - abonamenty", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Marketing - wynagrodzenia", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Marketing - zewnętrzny koszt", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Sprzedaż - abonamenty", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Sprzedaż - wynagrodzenia", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Sprzedaż - networking, restauracje", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Sprzedaż - zewnętrzny koszt", kind: "KOSZT", bucket: "GROWTH" },

  // KOSZTY OVERHEAD
  { name: "Biuro - czynsz", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Biuro - sprzęt", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Biuro - pozostałe", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Obsługa księgowa", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Administracja - abonamenty", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Administracja - wynagrodzenia", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Wypłaty zarządu", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Premie zarządu", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Edukacja", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Inne", kind: "KOSZT", bucket: "OVERHEAD" },

  // ODŁOŻONE ŚRODKI — nie wchodzą do „Koszty (łącznie)" ani do zysku
  { name: "Środki przelane na oszczędności", kind: "KOSZT", bucket: "ODLOZONE" },
  { name: "Zaliczka na podatek CIT", kind: "KOSZT", bucket: "ODLOZONE" },
  { name: "Zaliczka na premie zespołu", kind: "KOSZT", bucket: "ODLOZONE" },

  // CIT — podatek (osobna linia wyniku)
  { name: "CIT", kind: "KOSZT", bucket: "CIT" },
] as const;

/**
 * UWAGA: nazwa „Inne" występuje dwa razy (przychód i koszt overhead) —
 * dlatego wyszukiwanie kategorii wymaga PARY (kind, name).
 */
export function findRwCategory(
  kind: RwKind,
  name: string
): RwCategoryDef | undefined {
  const needle = name.trim();
  return RW_CATEGORIES.find((c) => c.kind === kind && c.name === needle);
}

export function rwCategoriesFor(kind: RwKind): readonly RwCategoryDef[] {
  return RW_CATEGORIES.filter((c) => c.kind === kind);
}

export function rwCategoriesInBucket(
  bucket: RwBucket
): readonly RwCategoryDef[] {
  return RW_CATEGORIES.filter((c) => c.bucket === bucket);
}

// ── Metryki ręczne (uzupełniane per miesiąc) ─────────────────────────

export const RW_MANUAL_METRICS = [
  { key: "zysk_estymacja", label: "Zysk — estymacja", unit: "zł" },
  { key: "eth_saved", label: "Odłożone ETH", unit: "ETH" },
  { key: "windykacja", label: "Kwota w windykacji", unit: "zł" },
  { key: "leady_marketing", label: "Leady z marketingu (CRM)", unit: "szt." },
  { key: "nowi_klienci", label: "Nowi klienci (podpisane umowy)", unit: "szt." },
  { key: "przychod_nowe_umowy", label: "Przychód z nowych umów", unit: "zł" },
  { key: "srednie_zamowienie_paczki", label: "Średnie zamówienie z paczki leadów", unit: "" },
  { key: "leady_networking", label: "Leady z networkingu (CRM)", unit: "szt." },
  { key: "ltv", label: "Łączna wartość klienta (LTV)", unit: "zł" },
  { key: "churn_kwartalny", label: "Churn rate % (kwartalnie)", unit: "%" },
] as const;

export type RwManualMetricKey = (typeof RW_MANUAL_METRICS)[number]["key"];

export const RW_MONTH_LABELS = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
] as const;
