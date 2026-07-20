// Stałe domenowe i etykiety PL — statusy trzymane w bazie jako String (SQLite bez enumów)

export const ROLES = ["ADMIN", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  EMPLOYEE: "Pracownik",
};

export const INVOICE_STATUSES = [
  "DRAFT",
  "NOT_ISSUED",
  "WAITING",
  "ISSUED",
  "NO_INVOICE",
  "PAID",
  "OVERDUE",
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Szkic",
  NOT_ISSUED: "Nie wystawiona",
  WAITING: "Czekamy",
  ISSUED: "Wystawiona",
  NO_INVOICE: "Bez faktury",
  PAID: "Zapłacona",
  OVERDUE: "Przeterminowana",
};

export const BILLING_MODELS = [
  "ABONAMENT",
  "PROJEKT",
  "SUCCESS_FEE",
  "PAKIETY_LEADOW",
] as const;
export type BillingModel = (typeof BILLING_MODELS)[number];
export const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  ABONAMENT: "Abonament",
  PROJEKT: "Projektowy",
  SUCCESS_FEE: "Success fee",
  PAKIETY_LEADOW: "Paczki leadów",
};

export const CLIENT_STATUSES = ["ACTIVE", "ENDED"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  ACTIVE: "Aktywny",
  ENDED: "Zakończony",
};

// Typ umowy — steruje okresem wypowiedzenia i tym, czy przychód powtarza się
// co miesiąc (MRR) czy jest jednorazowy (tylko miesiąc startu) w Estymacjach.
export const CONTRACT_TYPES = [
  "INDEFINITE_NOTICE",
  "ONE_OFF_MONTH",
  "ONE_OFF_PROJECT",
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];
export const CONTRACT_TYPE_LABELS: Record<ContractType, string> = {
  INDEFINITE_NOTICE: "Czas nieokreślony (1-mies. wypowiedzenie)",
  ONE_OFF_MONTH: "Umowa jednorazowa (1 miesiąc)",
  ONE_OFF_PROJECT: "Projekt jednorazowy",
};
/** okres wypowiedzenia w miesiącach wg typu umowy */
export const CONTRACT_TYPE_NOTICE_MONTHS: Record<ContractType, number> = {
  INDEFINITE_NOTICE: 1,
  ONE_OFF_MONTH: 0,
  ONE_OFF_PROJECT: 0,
};
/** czy przychód jest jednorazowy (bez powtarzalnego MRR w prognozie) */
export const CONTRACT_TYPE_ONE_OFF: Record<ContractType, boolean> = {
  INDEFINITE_NOTICE: false,
  ONE_OFF_MONTH: true,
  ONE_OFF_PROJECT: true,
};

// Rozliczenie: z góry (faktura za bieżący miesiąc) / z dołu (za miniony miesiąc)
export const BILLING_TIMINGS = ["UPFRONT", "ARREARS"] as const;
export type BillingTiming = (typeof BILLING_TIMINGS)[number];
export const BILLING_TIMING_LABELS: Record<BillingTiming, string> = {
  UPFRONT: "Z góry (za bieżący miesiąc)",
  ARREARS: "Z dołu (za miniony miesiąc)",
};

// Stawki VAT: wartość w bazie → ułamek i etykieta
export const VAT_RATES = ["23", "8", "5", "0", "ZW"] as const;
export type VatRate = (typeof VAT_RATES)[number];
export const VAT_RATE_FRACTIONS: Record<VatRate, number> = {
  "23": 0.23,
  "8": 0.08,
  "5": 0.05,
  "0": 0,
  ZW: 0,
};
export const VAT_RATE_LABELS: Record<VatRate, string> = {
  "23": "23%",
  "8": "8%",
  "5": "5%",
  "0": "0%",
  ZW: "zw.",
};

export function isVatRate(value: string): value is VatRate {
  return (VAT_RATES as readonly string[]).includes(value);
}

// Klucze ustawień (tabela Setting) z wartościami domyślnymi
export const SETTING_DEFAULTS = {
  allocation_enabled: "1", // alokacja kosztów ogólnych na klientów wł./wył.
  margin_threshold_pct: "20", // próg marży — klienci poniżej podświetlani na czerwono
  company_name: "adGen sp. z o.o.",
  company_address: "",
  company_account: "", // NRB 26 cyfr — rachunek zleceniodawcy do eksportu Elixir
  estymacje_nowy_biznes_gr: "0", // założenie „nowy biznes"/mies. NETTO w groszach (moduł Estymacje)
  // Cele BOA — docelowy podział przychodu (%). Edytowalne co kwartał w Ustawieniach.
  boa_oszczednosci_pct: "9",
  boa_wlasciciele_pct: "23",
  boa_operacyjne_pct: "65",
  boa_podatki_pct: "3",
  // codzienny automatyczny sync kampanii z Meta (cron) — "1" wł. / "0" wył.
  meta_autosync_enabled: "0",
  // Poświadczenia Meta (trzymane w bazie, nie w repo — DB jest gitignored).
  // Ustawiane przez UI (Ustawienia → Integracje) i przepływ OAuth „Połącz z FB".
  meta_app_id: "", // ID aplikacji Meta (jawne, używane w URL logowania)
  meta_app_secret: "", // sekret aplikacji (server-only, nigdy do klienta)
  meta_access_token: "", // token dostępu (z OAuth lub wklejony ręcznie; fallback: env)
  meta_oauth_base_url: "", // bazowy URL HTTPS do redirectu OAuth (puste = z żądania)
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;

// Startowe kategorie kosztów (seed) — odwzorowane z realnego arkusza adGen.
// isSalary: kategoria wynagrodzeń — rozliczana w rentowności kosztem pracy z godzin,
// nie wchodzi do kosztów bezpośrednich klienta ani do puli alokacji (flaga edytowalna
// w Ustawieniach per kategoria).
export const DEFAULT_COST_CATEGORIES: ReadonlyArray<{
  name: string;
  isSalary: boolean;
  isDeferred?: boolean;
  isAdBudget?: boolean;
}> = [
  { name: "Abonamenty", isSalary: false },
  { name: "Pozostałe wydatki operacyjne", isSalary: false },
  { name: "Wypłaty | Zarząd", isSalary: true },
  { name: "Wypłaty | Zespół", isSalary: true },
  { name: "Podwykonawcy", isSalary: false },
  // budżet reklamowy (Meta) — poza direct/alokacją; klientom liczony koszt leadów:
  { name: "Budżet reklamowy", isSalary: false, isAdBudget: true },
  // odłożone środki (koszt wewnętrzny — przelew na własne konto, poza zyskiem):
  { name: "Zaliczki na CIT / premie", isSalary: false, isDeferred: true },
  { name: "Odłożona gotówka - poduszka", isSalary: false, isDeferred: true },
  { name: "Wartość inwestycji - akcje, obligacje", isSalary: false, isDeferred: true },
  { name: "Wartość inwestycji - krypto", isSalary: false, isDeferred: true },
  { name: "Inne", isSalary: false },
];

// ── Ekonomika leadów (moduł Leady) ──────────────────────────────────

// Marki wewnętrzne: nazwy to dane biznesowe agencji, więc NIE są w repo —
// domyślne marki wczytuje `loadDefaultBrands()` z config/brands.json
// (gitignore), a użytkownik zarządza nimi w module Leady (dialog „Marki").

// Źródło CPL zastosowanego do dostawy leadów
export const LEAD_COST_SOURCES = ["MARKA", "SREDNIA_WERTYKALU", "BRAK_KAMPANII"] as const;
export type LeadCostSource = (typeof LEAD_COST_SOURCES)[number];
export const LEAD_COST_SOURCE_LABELS: Record<LeadCostSource, string> = {
  MARKA: "CPL marki",
  SREDNIA_WERTYKALU: "śr. wertykalu",
  BRAK_KAMPANII: "brak kampanii",
};

// Dwustopniowy flow płatności kosztu: brak działań → można płacić → opłacone
export const COST_APPROVAL_LABELS = {
  NONE: "Brak działań",
  APPROVED: "Można płacić",
  DELAYED: "Opóźniamy",
  PAID: "Opłacone",
} as const;

// Startowe tagi oferty (podpowiedzi przy kliencie; wartości wolne)
export const DEFAULT_OFFER_TAGS = [
  "META ADS ABO",
  "ADS ABO",
  "TIKTOK ADS",
  "SOCIAL MEDIA ABO",
  "PAKIETY LEADÓW",
  "INNE",
] as const;

// Tag oferty „pakiety leadów" — po jego wybraniu w formularzu przychodu
// pojawia się dropdown „Leady na" z branżami poniżej.
export const LEADS_OFFER_TAG = "PAKIETY LEADÓW";

// Branże/kategorie leadów (dropdown „Leady na"). Wybór zapisywany jako tag
// oferty z prefiksem LEAD_TAG_PREFIX (np. „Leady: SKD") — bez zmian w schemacie.
export const LEAD_CATEGORIES = [
  "SKD",
  "Służebności przesyłu",
  "Kredyty zagraniczne",
  "Kredyty firmowe",
  "Restrukturyzacje",
  "OZE",
  "Księgowość (JDG na sp zoo)",
  "Księgowość Spółki",
  "Księgowość KSEF",
  "Automotive",
] as const;

// Startowe wertykały (seed do LeadVertical). Po wdrożeniu lista jest edytowalna
// w module Leady; LEAD_CATEGORIES to tylko wartości domyślne/fallback.
export const DEFAULT_VERTICALS: readonly string[] = LEAD_CATEGORIES;

export const LEAD_TAG_PREFIX = "Leady: ";
