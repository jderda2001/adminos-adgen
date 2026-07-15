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
  /**
   * Ukryta w dropdownach importu/edycji (stara, szczegółowa taksonomia z arkusza).
   * WCIĄŻ WAŻNA: rozpoznawana przez findRwCategory i liczona w raporcie, żeby
   * dane historyczne (2026) się nie rozjechały. Nowe importy używają kategorii
   * aktywnych (poniżej). Mapowanie stara→nowa w DEPRECATED_COST_MAP.
   */
  deprecated?: boolean;
}

// Kolejność = kolejność wierszy w tabeli UI. W każdej grupie: najpierw AKTYWNE
// (nowa taksonomia adGen — 14 kategorii kosztów), potem zdeprecjonowane (stare
// z arkusza — ukryte w dropdownie, pokazywane w tabeli tylko gdy mają dane).
export const RW_CATEGORIES: readonly RwCategoryDef[] = [
  // PRZYCHODY — wartości kolumny „Typ Przychodu" w CSV przychodów
  { name: "Abonament marketingowy", kind: "PRZYCHOD", bucket: "PRZYCHODY" },
  { name: "Paczki leadów (stała współpraca)", kind: "PRZYCHOD", bucket: "PRZYCHODY" },
  { name: "Paczki leadów (pilotaż)", kind: "PRZYCHOD", bucket: "PRZYCHODY" },
  { name: "Inne", kind: "PRZYCHOD", bucket: "PRZYCHODY" },

  // KOSZTY PRODUKCYJNE (delivery)
  { name: "Wypłaty | Zespół", kind: "KOSZT", bucket: "DELIVERY" },
  { name: "Wypłaty | UGC", kind: "KOSZT", bucket: "DELIVERY" },
  { name: "Delivery - wynagrodzenia", kind: "KOSZT", bucket: "DELIVERY", deprecated: true },
  { name: "Delivery - abonamenty pozostałe", kind: "KOSZT", bucket: "DELIVERY", deprecated: true },
  { name: "Delivery - budżet reklamowy", kind: "KOSZT", bucket: "DELIVERY", deprecated: true },
  { name: "Delivery - podwykonawcy", kind: "KOSZT", bucket: "DELIVERY", deprecated: true },
  { name: "ZUS", kind: "KOSZT", bucket: "DELIVERY", deprecated: true },

  // KOSZTY MARKETINGU I SPRZEDAŻY (growth)
  { name: "Budżet reklamowy", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Networking", kind: "KOSZT", bucket: "GROWTH" },
  { name: "Marketing - budżety", kind: "KOSZT", bucket: "GROWTH", deprecated: true },
  { name: "Marketing - abonamenty", kind: "KOSZT", bucket: "GROWTH", deprecated: true },
  { name: "Marketing - wynagrodzenia", kind: "KOSZT", bucket: "GROWTH", deprecated: true },
  { name: "Marketing - zewnętrzny koszt", kind: "KOSZT", bucket: "GROWTH", deprecated: true },
  { name: "Sprzedaż - abonamenty", kind: "KOSZT", bucket: "GROWTH", deprecated: true },
  { name: "Sprzedaż - wynagrodzenia", kind: "KOSZT", bucket: "GROWTH", deprecated: true },
  { name: "Sprzedaż - networking, restauracje", kind: "KOSZT", bucket: "GROWTH", deprecated: true },
  { name: "Sprzedaż - zewnętrzny koszt", kind: "KOSZT", bucket: "GROWTH", deprecated: true },

  // KOSZTY OVERHEAD
  { name: "Abonamenty", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Wypłaty | Zarząd", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Samochody", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Niespodziewane / Obiady zarządu", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Pozostałe wydatki operacyjne", kind: "KOSZT", bucket: "OVERHEAD" },
  { name: "Biuro - czynsz", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Biuro - sprzęt", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Biuro - pozostałe", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Obsługa księgowa", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Administracja - abonamenty", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Administracja - wynagrodzenia", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Wypłaty zarządu", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Premie zarządu", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Edukacja", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },
  { name: "Inne", kind: "KOSZT", bucket: "OVERHEAD", deprecated: true },

  // ODŁOŻONE ŚRODKI — nie wchodzą do „Koszty (łącznie)" ani do zysku
  { name: "Oszczędności", kind: "KOSZT", bucket: "ODLOZONE" },
  { name: "Zaliczki na CIT / premie", kind: "KOSZT", bucket: "ODLOZONE" },
  { name: "VAT", kind: "KOSZT", bucket: "ODLOZONE" },
  { name: "PIT", kind: "KOSZT", bucket: "ODLOZONE" },
  { name: "Środki przelane na oszczędności", kind: "KOSZT", bucket: "ODLOZONE", deprecated: true },
  { name: "Zaliczka na podatek CIT", kind: "KOSZT", bucket: "ODLOZONE", deprecated: true },
  { name: "Zaliczka na premie zespołu", kind: "KOSZT", bucket: "ODLOZONE", deprecated: true },

  // CIT — podatek (osobna linia wyniku)
  { name: "CIT", kind: "KOSZT", bucket: "CIT" },
] as const;

/**
 * Mapowanie stara (zdeprecjonowana) kategoria kosztu → aktywny odpowiednik.
 * Używane, gdy auto-kategoryzacja / reguły osobowe / AI zwrócą starą nazwę —
 * przekładamy ją na nową taksonomię (zgodnie z grupami zatwierdzonymi przez
 * użytkownika). NIE zmienia danych historycznych w bazie (te zostają jak były).
 */
export const DEPRECATED_COST_MAP: Record<string, string> = {
  "Delivery - wynagrodzenia": "Wypłaty | Zespół",
  "Delivery - abonamenty pozostałe": "Abonamenty",
  "Delivery - budżet reklamowy": "Budżet reklamowy",
  "Delivery - podwykonawcy": "Wypłaty | UGC",
  "ZUS": "Pozostałe wydatki operacyjne",
  "Marketing - budżety": "Budżet reklamowy",
  "Marketing - abonamenty": "Abonamenty",
  "Marketing - wynagrodzenia": "Wypłaty | Zespół",
  "Marketing - zewnętrzny koszt": "Budżet reklamowy",
  "Sprzedaż - abonamenty": "Abonamenty",
  "Sprzedaż - wynagrodzenia": "Wypłaty | Zespół",
  "Sprzedaż - networking, restauracje": "Networking",
  "Sprzedaż - zewnętrzny koszt": "Networking",
  "Biuro - czynsz": "Pozostałe wydatki operacyjne",
  "Biuro - sprzęt": "Pozostałe wydatki operacyjne",
  "Biuro - pozostałe": "Pozostałe wydatki operacyjne",
  "Obsługa księgowa": "Pozostałe wydatki operacyjne",
  "Administracja - abonamenty": "Abonamenty",
  "Administracja - wynagrodzenia": "Wypłaty | Zespół",
  "Wypłaty zarządu": "Wypłaty | Zarząd",
  "Premie zarządu": "Wypłaty | Zarząd",
  "Edukacja": "Pozostałe wydatki operacyjne",
  "Inne": "Pozostałe wydatki operacyjne",
  "Środki przelane na oszczędności": "Oszczędności",
  "Zaliczka na podatek CIT": "Zaliczki na CIT / premie",
  "Zaliczka na premie zespołu": "Zaliczki na CIT / premie",
};

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

/** Kategorie AKTYWNE (bez zdeprecjonowanych) — do dropdownów, promptu AI, enuma. */
export function rwActiveCategoriesFor(kind: RwKind): readonly RwCategoryDef[] {
  return RW_CATEGORIES.filter((c) => c.kind === kind && !c.deprecated);
}

/**
 * Zwraca AKTYWNĄ nazwę kategorii: zdeprecjonowaną przekłada na nowy odpowiednik
 * (DEPRECATED_COST_MAP). Dla nazw już aktywnych / nieznanych — zwraca bez zmian.
 * Używane przy sugerowaniu kategorii (auto/AI/reguły osobowe), żeby nigdy nie
 * zaproponować kategorii ukrytej w dropdownie.
 */
export function activeCategoryName(kind: RwKind, name: string): string {
  if (kind === "KOSZT") {
    const mapped = DEPRECATED_COST_MAP[name];
    if (mapped) return mapped;
  }
  return name;
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
