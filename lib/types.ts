// Stałe domenowe i etykiety PL — statusy trzymane w bazie jako String (SQLite bez enumów)

export const ROLES = ["ADMIN", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  EMPLOYEE: "Pracownik",
};

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "OVERDUE"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: "Szkic",
  ISSUED: "Wystawiona",
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
} as const;
export type SettingKey = keyof typeof SETTING_DEFAULTS;

// Startowe kategorie kosztów (seed) — odwzorowane z realnego arkusza adGen.
// isSalary: kategoria wynagrodzeń — rozliczana w rentowności kosztem pracy z godzin,
// nie wchodzi do kosztów bezpośrednich klienta ani do puli alokacji (flaga edytowalna
// w Ustawieniach per kategoria).
export const DEFAULT_COST_CATEGORIES: ReadonlyArray<{
  name: string;
  isSalary: boolean;
}> = [
  { name: "Abonamenty", isSalary: false },
  { name: "Pozostałe wydatki operacyjne", isSalary: false },
  { name: "Wypłaty | Zarząd", isSalary: true },
  { name: "Wypłaty | Zespół", isSalary: true },
  { name: "Podwykonawcy", isSalary: false },
  { name: "Oszczędności", isSalary: false },
  { name: "Inne", isSalary: false },
];

// Dwustopniowy flow płatności kosztu: brak działań → można płacić → opłacone
export const COST_APPROVAL_LABELS = {
  NONE: "Brak działań",
  APPROVED: "Można płacić",
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

export const LEAD_TAG_PREFIX = "Leady: ";
