// Seed bazy danych — realistyczne dane przykładowe agencji adGen.
// Uruchomienie: npm run db:seed (tsx prisma/seed.ts)
//
// Wszystkie daty liczone względem dnia uruchomienia: dane obejmują bieżący
// miesiąc i dwa poprzednie. Daty zapisywane jako północ UTC danego dnia
// kalendarzowego (spójnie z lib/format.todayUTC). Kwoty w groszach (Int).
//
// Zgodność ze schematem (nowe pola realnego flow adGen):
// - CostCategory.isSalary — kategorie wynagrodzeń ("Wypłaty | Zarząd",
//   "Wypłaty | Zespół") rozliczane kosztem pracy z godzin, poza alokacją.
// - Cost.approvedForPayment — dwustopniowy flow: "Brak działań" → "Można płacić"
//   → "Opłacone" (paid=true). Eksport Elixir bierze approvedForPayment=true.
// - Client.offerTags — tagi oferty po przecinku (paleta DEFAULT_OFFER_TAGS).
// - User.monthlyBudgetGr — założenie miesięczne wypłaty per pracownik.
// - RevenuePlanNote — miesięczna uwaga do klienta w planie przychodów.

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { computeVatFromNet } from "../lib/calc";
import { todayUTC, formatMonth } from "../lib/format";
import { monthKey } from "../lib/periods";
import { DEFAULT_COST_CATEGORIES, type VatRate } from "../lib/types";

const db = new PrismaClient();

// Nazwy kategorii wynagrodzeń — muszą pokrywać się z DEFAULT_COST_CATEGORIES
// (kategorie z isSalary=true). Trzymane jako stałe dla czytelności przypisań.
const CAT_TEAM = "Wypłaty | Zespół";
const CAT_BOARD = "Wypłaty | Zarząd";
const CAT_SUBS = "Abonamenty";
const CAT_OPEX = "Pozostałe wydatki operacyjne";
const CAT_SUBCONTRACTORS = "Podwykonawcy";
const CAT_SAVINGS = "Oszczędności";
const CAT_OTHER = "Inne";

// ── Pomocnicze: daty ─────────────────────────────────────────────────

const today = todayUTC();
const Y = today.getUTCFullYear();
const M = today.getUTCMonth(); // 0-11, bieżący miesiąc

/** Dzień `day` miesiąca oddalonego o `offset` miesięcy wstecz od bieżącego (północ UTC). */
function monthDay(offset: number, day: number): Date {
  return new Date(Date.UTC(Y, M - offset, day));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function earlier(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/** Klucz "RRRR-MM" miesiąca oddalonego o `offset` wstecz. */
function periodKey(offset: number): string {
  return monthKey(monthDay(offset, 1));
}

// ── Pomocnicze: NRB (26 cyfr, poprawna suma kontrolna IBAN) ──────────

/** Z 24-cyfrowego BBAN (8 cyfr nr rozliczeniowy + 16 cyfr rachunku) liczy NRB z cyframi kontrolnymi. */
function makeNrb(bban24: string): string {
  if (!/^\d{24}$/.test(bban24)) throw new Error(`Niepoprawny BBAN: ${bban24}`);
  // IBAN PL: kontrola mod 97 dla BBAN + "2521" (PL) + "00"
  const rest = Number(BigInt(bban24 + "252100") % BigInt(97));
  const check = 98 - rest;
  return String(check).padStart(2, "0") + bban24;
}

// ── Pomocnicze: deterministyczny generator (mulberry32) ─────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);

// ── Główna logika ────────────────────────────────────────────────────

async function main() {
  console.log(`Seed danych przykładowych adGen — dziś: ${today.toISOString().slice(0, 10)}`);

  // 1. Czyszczenie tabel w kolejności FK
  await db.session.deleteMany({});
  await db.activeTimer.deleteMany({});
  await db.timeEntry.deleteMany({});
  await db.invoiceItem.deleteMany({});
  await db.invoice.deleteMany({});
  await db.cost.deleteMany({});
  await db.recurringCost.deleteMany({});
  await db.revenuePlanNote.deleteMany({});
  await db.hourlyRate.deleteMany({});
  await db.user.deleteMany({});
  await db.client.deleteMany({});
  await db.costCategory.deleteMany({});
  await db.setting.deleteMany({});

  // 2. Ustawienia
  await db.setting.createMany({
    data: [
      { key: "company_name", value: "adGen sp. z o.o." },
      { key: "company_address", value: "ul. Marszałkowska 8/15, 00-590 Warszawa" },
      { key: "company_account", value: "83114020040000300201355387" },
      { key: "allocation_enabled", value: "1" },
      { key: "margin_threshold_pct", value: "20" },
    ],
  });

  // 3. Kategorie kosztów (dokładnie DEFAULT_COST_CATEGORIES — obiekty {name, isSalary})
  const categories = new Map<string, string>();
  for (const [i, def] of DEFAULT_COST_CATEGORIES.entries()) {
    const cat = await db.costCategory.create({
      data: { name: def.name, isSalary: def.isSalary, position: i },
    });
    categories.set(def.name, cat.id);
  }
  const catId = (name: string): string => {
    const id = categories.get(name);
    if (!id) throw new Error(`Brak kategorii: ${name}`);
    return id;
  };

  // 4. Użytkownicy + stawki godzinowe.
  //    monthlyBudgetGr = założenie miesięczne wypłaty (do rozliczenia zespołu),
  //    realistycznie względem stawki godzinowej.
  const adminHash = await bcrypt.hash("AdGen2026!", 10);
  const employeeHash = await bcrypt.hash("Pracownik123!", 10);

  await db.user.create({
    data: {
      name: "Jakub Derda",
      email: "admin@adgen.pl",
      passwordHash: adminHash,
      role: "ADMIN",
      mustChangePassword: false,
      monthlyBudgetGr: null, // zarząd/admin — bez założenia budżetu wypłaty
    },
  });

  const employeeDefs = [
    { name: "Marek Wójcik", email: "marek.wojcik@example.com", rateGr: 120_00, monthlyBudgetGr: 16_000_00 },
    { name: "Anna Nowak", email: "anna.nowak@example.com", rateGr: 95_00, monthlyBudgetGr: 12_000_00 },
    { name: "Katarzyna Dąbrowska", email: "katarzyna.dabrowska@example.com", rateGr: 85_00, monthlyBudgetGr: 10_000_00 },
    { name: "Piotr Jankowski", email: "piotr.jankowski@example.com", rateGr: 75_00, monthlyBudgetGr: 8_000_00 },
    { name: "Tomasz Lewicki", email: "tomasz.lewicki@example.com", rateGr: 60_00, monthlyBudgetGr: 6_000_00 },
  ];

  const employees = new Map<string, string>(); // imię → userId
  const ratesFrom = monthDay(6, 1); // stawki bazowe od 6 miesięcy wstecz
  for (const def of employeeDefs) {
    const user = await db.user.create({
      data: {
        name: def.name,
        email: def.email,
        passwordHash: employeeHash,
        role: "EMPLOYEE",
        mustChangePassword: false,
        monthlyBudgetGr: def.monthlyBudgetGr,
      },
    });
    employees.set(def.name, user.id);
    await db.hourlyRate.create({
      data: { userId: user.id, ratePerHourGr: def.rateGr, validFrom: ratesFrom },
    });
  }
  // Podwyżka Hani: 95 zł/h od 1. dnia poprzedniego miesiąca (historia zmian stawek)
  await db.hourlyRate.create({
    data: {
      userId: employees.get("Katarzyna Dąbrowska")!,
      ratePerHourGr: 95_00,
      validFrom: monthDay(1, 1),
    },
  });

  // 5. Klienci — offerTags z realnej palety DEFAULT_OFFER_TAGS.
  //    Zachowany profil rentowności: FitLife nierentowny (dużo godzin, niskie prowizje).
  const techNova = await db.client.create({
    data: {
      name: "TechNova sp. z o.o.",
      nip: "5213456789",
      contactPerson: "Katarzyna Lewandowska",
      email: "k.lewandowska@technova.pl",
      phone: "+48 601 234 567",
      address: "ul. Prosta 68, 00-838 Warszawa",
      billingModel: "ABONAMENT",
      monthlyRetainerGr: 18_500_00,
      offerTags: "META ADS ABO",
      status: "ACTIVE",
      startDate: monthDay(14, 1),
      notes: "Największy klient abonamentowy. Rozszerzenie o projekty CRO od zeszłego miesiąca.",
    },
  });
  const bistro = await db.client.create({
    data: {
      name: "Bistro Zielona Weranda",
      nip: "7010987654",
      contactPerson: "Piotr Malinowski",
      email: "kontakt@zielonaweranda.pl",
      phone: "+48 512 887 340",
      address: "ul. Francuska 12, 03-906 Warszawa",
      billingModel: "ABONAMENT",
      monthlyRetainerGr: 6_500_00,
      offerTags: "SOCIAL MEDIA ABO",
      status: "ACTIVE",
      startDate: monthDay(8, 1),
      notes: "Social media + kreacje. Kontakt najlepiej telefoniczny po 12:00.",
    },
  });
  const meble = await db.client.create({
    data: {
      name: "Meble Wnętrza S.A.",
      nip: "9512345678",
      contactPerson: "Anna Sobczak",
      email: "a.sobczak@meblewnetrza.pl",
      phone: "+48 22 501 22 10",
      address: "ul. Puławska 303, 02-785 Warszawa",
      billingModel: "PROJEKT",
      offerTags: "PAKIETY LEADÓW",
      status: "ACTIVE",
      startDate: monthDay(4, 15),
      notes: "Rozliczenie projektowe — kampanie sezonowe. Faktury akceptuje dział zakupów (dłuższy obieg).",
    },
  });
  const fitLife = await db.client.create({
    data: {
      name: "FitLife Studio",
      nip: "1132567890",
      contactPerson: "Tomasz Grabowski",
      email: "tomek@fitlifestudio.pl",
      phone: "+48 698 445 112",
      address: "ul. Górczewska 124, 01-460 Warszawa",
      billingModel: "SUCCESS_FEE",
      offerTags: "PAKIETY LEADÓW,INNE",
      status: "ACTIVE",
      startDate: monthDay(5, 1),
      notes: "Success fee od pozyskanych leadów. Uwaga: dużo godzin zespołu przy niskich prowizjach — pilnować rentowności.",
    },
  });

  // 6. Faktury sprzedażowe (numeracja FV/RRRR/MM/NN wg miesiąca wystawienia)
  const invoiceCounters = new Map<string, number>();
  function nextInvoiceNumber(issueDate: Date): string {
    const key = monthKey(issueDate); // "RRRR-MM"
    const n = (invoiceCounters.get(key) ?? 0) + 1;
    invoiceCounters.set(key, n);
    const [y, m] = key.split("-");
    return `FV/${y}/${m}/${String(n).padStart(2, "0")}`;
  }

  // Rejestr przychodów (arkusz adGen): pojedyncza kwota netto, bez pozycji.
  // number opcjonalny — „bez fv" (DRAFT) zapisujemy jako null.
  async function createInvoice(opts: {
    clientId: string;
    issueDate: Date;
    saleDate: Date;
    dueDate: Date;
    status: "DRAFT" | "ISSUED" | "PAID" | "OVERDUE";
    paidDate?: Date;
    netGr: number;
    vatRate?: VatRate;
    label?: string;
    offerTags?: string;
    notes?: string;
    /** false → „bez fv" (number: null); domyślnie number nadawany dla wystawionych */
    numbered?: boolean;
  }) {
    const amounts = computeVatFromNet(opts.netGr, opts.vatRate ?? "23");
    const numbered = opts.numbered ?? opts.status !== "DRAFT";
    await db.invoice.create({
      data: {
        number: numbered ? nextInvoiceNumber(opts.issueDate) : null,
        clientId: opts.clientId,
        label: opts.label ?? null,
        offerTags: opts.offerTags ?? null,
        issueDate: opts.issueDate,
        saleDate: opts.saleDate,
        dueDate: opts.dueDate,
        status: opts.status,
        paidDate: opts.paidDate ?? null,
        netGr: amounts.netGr,
        vatGr: amounts.vatGr,
        grossGr: amounts.grossGr,
        notes: opts.notes ?? null,
      },
    });
  }

  const monthName = (offset: number) => formatMonth(periodKey(offset));

  // — 2 miesiące temu: wszystkie opłacone (paidDate kilka dni po terminie)
  await createInvoice({
    clientId: techNova.id,
    issueDate: monthDay(2, 1),
    saleDate: monthDay(2, 1),
    dueDate: monthDay(2, 15),
    status: "PAID",
    paidDate: monthDay(2, 18),
    netGr: 18_500_00,
    label: `Obsługa Meta Ads + social media ${monthName(2)}`,
    offerTags: "META ADS ABO,SOCIAL MEDIA ABO",
  });
  await createInvoice({
    clientId: bistro.id,
    issueDate: monthDay(2, 1),
    saleDate: monthDay(2, 1),
    dueDate: monthDay(2, 15),
    status: "PAID",
    paidDate: monthDay(2, 17),
    netGr: 6_500_00,
    label: `Social media + kreacje ${monthName(2)}`,
    offerTags: "SOCIAL MEDIA ABO",
  });
  await createInvoice({
    clientId: fitLife.id,
    issueDate: monthDay(2, 6),
    saleDate: monthDay(2, 6),
    dueDate: monthDay(2, 20),
    status: "PAID",
    paidDate: monthDay(2, 23),
    netGr: 3_200_00,
    label: `Success fee — leady (${monthName(2)})`,
    offerTags: "PAKIETY LEADÓW",
  });
  await createInvoice({
    clientId: meble.id,
    issueDate: monthDay(2, 10),
    saleDate: monthDay(2, 10),
    dueDate: monthDay(2, 24),
    status: "PAID",
    paidDate: monthDay(2, 28),
    netGr: 24_000_00,
    label: "Pakiet leadów — nowa kolekcja, etap I",
    offerTags: "PAKIETY LEADÓW",
    notes: "Etap I zgodnie z umową ramową.",
  });

  // — poprzedni miesiąc: większość opłacone, Meble Wnętrza i FitLife po terminie
  await createInvoice({
    clientId: techNova.id,
    issueDate: monthDay(1, 1),
    saleDate: monthDay(1, 1),
    dueDate: monthDay(1, 15),
    status: "PAID",
    paidDate: monthDay(1, 19),
    netGr: 18_500_00,
    label: `Obsługa Meta Ads + social media ${monthName(1)}`,
    offerTags: "META ADS ABO,SOCIAL MEDIA ABO",
  });
  await createInvoice({
    clientId: bistro.id,
    issueDate: monthDay(1, 1),
    saleDate: monthDay(1, 1),
    dueDate: monthDay(1, 15),
    status: "PAID",
    paidDate: monthDay(1, 16),
    netGr: 6_500_00,
    label: `Social media + kreacje ${monthName(1)}`,
    offerTags: "SOCIAL MEDIA ABO",
  });
  await createInvoice({
    clientId: meble.id,
    issueDate: monthDay(1, 5),
    saleDate: monthDay(1, 5),
    dueDate: addDays(today, -22), // 20+ dni po terminie
    status: "OVERDUE",
    netGr: 31_500_00,
    label: "Pakiet leadów — kampania wyprzedażowa + spot wideo",
    offerTags: "PAKIETY LEADÓW",
    notes: "Wysłano przypomnienie o płatności — czeka na akceptację działu zakupów.",
  });
  await createInvoice({
    clientId: fitLife.id,
    issueDate: monthDay(1, 8),
    saleDate: monthDay(1, 8),
    dueDate: addDays(today, -10), // 10 dni po terminie
    status: "OVERDUE",
    netGr: 2_800_00,
    label: `Success fee — leady (${monthName(1)})`,
    offerTags: "PAKIETY LEADÓW",
  });
  await createInvoice({
    clientId: techNova.id,
    issueDate: monthDay(1, 12),
    saleDate: monthDay(1, 12),
    dueDate: monthDay(1, 26),
    status: "PAID",
    paidDate: monthDay(1, 28),
    netGr: 12_000_00,
    label: "Optymalizacja konwersji — projekt (landing pages)",
    offerTags: "INNE",
  });

  // — bieżący miesiąc: wysłane z terminem w przyszłości + dwie „bez fv" (DRAFT)
  await createInvoice({
    clientId: techNova.id,
    issueDate: today,
    saleDate: monthDay(0, 1),
    dueDate: addDays(today, 14),
    status: "ISSUED",
    netGr: 18_500_00,
    label: `Obsługa Meta Ads + social media ${monthName(0)}`,
    offerTags: "META ADS ABO,SOCIAL MEDIA ABO",
  });
  await createInvoice({
    clientId: bistro.id,
    issueDate: today,
    saleDate: monthDay(0, 1),
    dueDate: addDays(today, 14),
    status: "ISSUED",
    netGr: 6_500_00,
    label: `Social media + kreacje ${monthName(0)}`,
    offerTags: "SOCIAL MEDIA ABO",
  });
  await createInvoice({
    clientId: meble.id,
    issueDate: today,
    saleDate: today,
    dueDate: addDays(today, 14),
    status: "DRAFT", // „bez fv" — number: null
    netGr: 9_800_00,
    label: "Audyt UX i optymalizacja konwersji — projekt",
    offerTags: "INNE",
    notes: "Bez FV — czeka na potwierdzenie zakresu przez klienta.",
  });
  await createInvoice({
    clientId: fitLife.id,
    issueDate: today,
    saleDate: today,
    dueDate: addDays(today, 14),
    status: "DRAFT", // „bez fv" — number: null
    netGr: 1_500_00,
    label: `Success fee — leady (${monthName(0)}, w toku)`,
    offerTags: "PAKIETY LEADÓW",
    notes: "Bez FV — prowizja liczona na koniec miesiąca.",
  });

  // 6b. RevenuePlanNote — uwagi do planu przychodów na bieżący miesiąc
  const currentPeriod = periodKey(0);
  await db.revenuePlanNote.createMany({
    data: [
      {
        clientId: fitLife.id,
        period: currentPeriod,
        note: "W tym miesiącu brak prowizji — kampania leadowa dopiero się rozkręca.",
      },
      {
        clientId: techNova.id,
        period: currentPeriod,
        note: "Podstawa abonamentowa + potencjalny success fee za projekt CRO.",
      },
      {
        clientId: meble.id,
        period: currentPeriod,
        note: "Ostatnia płatność faktury za współpracę projektową (etap końcowy).",
      },
    ],
  });

  // 7. Szablony kosztów cyklicznych
  // Rachunki NRB (poprawne cyfry kontrolne, prefiksy kodów banków)
  const nrbGoogle = makeNrb("114020040000330201889011");
  const nrbMake = makeNrb("105010381000009712345678");
  const nrbClaude = makeNrb("124010370000401122334455");
  const nrbTmobile = makeNrb("102010260000042270418355");
  const nrbCzynsz = makeNrb("114010100000712345670001");
  const nrbKsiegowosc = makeNrb("105000021000230144556677");
  const nrbSerwis = makeNrb("124062181111000012348765");
  const nrbVps = makeNrb("102055581111147890123456");

  const currentKey = periodKey(0);
  const prevKey = periodKey(1);

  interface RecurringDef {
    key: string;
    supplierName: string;
    supplierAccount?: string;
    docNumber: string; // baza z {MM/RRRR}
    netGr: number;
    vatRate: VatRate;
    category: string;
    clientId?: string;
    dueDayOfMonth: number;
    lastGeneratedPeriod: string;
    note?: string;
  }

  const recurringDefs: RecurringDef[] = [
    {
      key: "czynsz",
      supplierName: "Nieruchomości Marszałkowska sp. z o.o.",
      supplierAccount: nrbCzynsz,
      docNumber: "Czynsz biuro {MM/RRRR}",
      netGr: 4_200_00,
      vatRate: "23",
      category: CAT_OPEX,
      dueDayOfMonth: 5,
      lastGeneratedPeriod: currentKey,
    },
    {
      key: "google-workspace",
      supplierName: "Google Workspace",
      supplierAccount: nrbGoogle,
      docNumber: "Google Workspace {MM/RRRR}",
      netGr: 450_00,
      vatRate: "23",
      category: CAT_SUBS,
      dueDayOfMonth: 12,
      lastGeneratedPeriod: currentKey,
    },
    {
      key: "make",
      supplierName: "MAKE (Celonis)",
      supplierAccount: nrbMake,
      docNumber: "MAKE {MM/RRRR}",
      netGr: 380_00,
      vatRate: "23",
      category: CAT_SUBS,
      dueDayOfMonth: 15,
      lastGeneratedPeriod: currentKey,
    },
    {
      // celowo poprzedni miesiąc — przy pierwszym wejściu na Koszty
      // wygeneruje się 1 pozycja "do potwierdzenia" (demo flow)
      key: "claude",
      supplierName: "Anthropic (Claude AI)",
      supplierAccount: nrbClaude,
      docNumber: "Claude AI {MM/RRRR}",
      netGr: 780_00,
      vatRate: "23",
      category: CAT_SUBS,
      dueDayOfMonth: 10,
      lastGeneratedPeriod: prevKey,
    },
    {
      key: "tmobile",
      supplierName: "T-Mobile Polska S.A.",
      supplierAccount: nrbTmobile,
      docNumber: "t-mobile {MM/RRRR}",
      netGr: 320_00,
      vatRate: "23",
      category: CAT_SUBS,
      dueDayOfMonth: 8,
      lastGeneratedPeriod: currentKey,
    },
    // — wynagrodzenia: zarząd (isSalary → "Wypłaty | Zarząd")
    {
      key: "pensja-maciej",
      supplierName: "Marek Wójcik",
      docNumber: "Lista płac {MM/RRRR}",
      netGr: 15_500_00,
      vatRate: "ZW",
      category: CAT_BOARD,
      dueDayOfMonth: 10,
      lastGeneratedPeriod: currentKey,
    },
    // — wynagrodzenia: zespół (isSalary → "Wypłaty | Zespół")
    {
      key: "pensja-greta",
      supplierName: "Anna Nowak",
      docNumber: "Lista płac {MM/RRRR}",
      netGr: 12_800_00,
      vatRate: "ZW",
      category: CAT_TEAM,
      dueDayOfMonth: 10,
      lastGeneratedPeriod: currentKey,
    },
    {
      key: "pensja-hania",
      supplierName: "Katarzyna Dąbrowska",
      docNumber: "Lista płac {MM/RRRR}",
      netGr: 12_600_00, // po podwyżce
      vatRate: "ZW",
      category: CAT_TEAM,
      dueDayOfMonth: 10,
      lastGeneratedPeriod: currentKey,
    },
    {
      key: "pensja-bartek",
      supplierName: "Piotr Jankowski",
      docNumber: "Lista płac {MM/RRRR}",
      netGr: 10_200_00,
      vatRate: "ZW",
      category: CAT_TEAM,
      dueDayOfMonth: 10,
      lastGeneratedPeriod: currentKey,
    },
    {
      key: "pensja-ola",
      supplierName: "Tomasz Lewicki",
      docNumber: "Lista płac {MM/RRRR}",
      netGr: 8_200_00,
      vatRate: "ZW",
      category: CAT_TEAM,
      dueDayOfMonth: 10,
      lastGeneratedPeriod: currentKey,
    },
    // — podwykonawcy przypisani do klientów
    {
      key: "grafik-technova",
      supplierName: "Studio Graficzne Pixel — Anna Lis",
      docNumber: "Grafika TechNova {MM/RRRR}",
      netGr: 3_500_00,
      vatRate: "23",
      category: CAT_SUBCONTRACTORS,
      clientId: techNova.id,
      dueDayOfMonth: 10,
      lastGeneratedPeriod: currentKey,
      note: "Freelancer — kreacje do kampanii TechNova.",
    },
    {
      key: "copy-bistro",
      supplierName: "Marta Krajewska Copywriting",
      docNumber: "Copywriting Bistro {MM/RRRR}",
      netGr: 1_200_00,
      vatRate: "23",
      category: CAT_SUBCONTRACTORS,
      clientId: bistro.id,
      dueDayOfMonth: 12,
      lastGeneratedPeriod: currentKey,
      note: "Teksty postów i newsletter dla Bistro Zielona Weranda.",
    },
    {
      key: "trener-fitlife",
      supplierName: "Karol Sportowiec — trener i ambasador",
      docNumber: "Ambasador FitLife {MM/RRRR}",
      netGr: 4_500_00,
      vatRate: "23",
      category: CAT_SUBCONTRACTORS,
      clientId: fitLife.id,
      dueDayOfMonth: 15,
      lastGeneratedPeriod: currentKey,
      note: "Współpraca ambasadorska — koszt przypisany do FitLife Studio.",
    },
  ];

  const recurringIds = new Map<string, string>();
  for (const def of recurringDefs) {
    const rc = await db.recurringCost.create({
      data: {
        active: true,
        supplierName: def.supplierName,
        supplierAccount: def.supplierAccount ?? null,
        docNumber: def.docNumber,
        netGr: def.netGr,
        vatRate: def.vatRate,
        categoryId: catId(def.category),
        clientId: def.clientId ?? null,
        dueDayOfMonth: def.dueDayOfMonth,
        note: def.note ?? null,
        lastGeneratedPeriod: def.lastGeneratedPeriod,
      },
    });
    recurringIds.set(def.key, rc.id);
  }

  // 8. Koszty za 3 miesiące
  //    approvedForPayment: zapłacone → true implicite (spójność);
  //    niezapłacone bieżącego miesiąca — część true ("Można płacić"),
  //    część false ("Brak działań"); zaległe — mix.
  async function createCost(opts: {
    supplierName: string;
    supplierAccount?: string;
    docNumber: string;
    docDate: Date;
    dueDate?: Date;
    netGr: number;
    vatRate?: VatRate;
    category: string;
    clientId?: string;
    paid: boolean;
    paidDate?: Date;
    approvedForPayment?: boolean;
    note?: string;
    recurringKey?: string;
  }) {
    const vatRate = opts.vatRate ?? "23";
    const amounts = computeVatFromNet(opts.netGr, vatRate);
    // Zapłacone koszty są z definicji zatwierdzone do płatności (spójność flow).
    const approved = opts.paid ? true : opts.approvedForPayment ?? false;
    await db.cost.create({
      data: {
        supplierName: opts.supplierName,
        supplierAccount: opts.supplierAccount ?? null,
        docNumber: opts.docNumber,
        docDate: opts.docDate,
        dueDate: opts.dueDate ?? null,
        netGr: amounts.netGr,
        vatRate,
        vatGr: amounts.vatGr,
        grossGr: amounts.grossGr,
        categoryId: catId(opts.category),
        clientId: opts.clientId ?? null,
        paid: opts.paid,
        paidDate: opts.paidDate ?? null,
        approvedForPayment: approved,
        needsConfirmation: false,
        note: opts.note ?? null,
        recurringCostId: opts.recurringKey
          ? recurringIds.get(opts.recurringKey) ?? null
          : null,
      },
    });
  }

  /** "MM/RRRR" miesiąca oddalonego o offset — do numerów dokumentów. */
  function mmYYYY(offset: number): string {
    const d = monthDay(offset, 1);
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
  }

  // — wynagrodzenia (VAT ZW, zapłacone do 10. dnia miesiąca).
  //   Zarząd → "Wypłaty | Zarząd", zespół → "Wypłaty | Zespół".
  const salaryByMonth = (offset: number) => [
    { key: "pensja-maciej", name: "Marek Wójcik", netGr: 15_500_00, category: CAT_BOARD },
    { key: "pensja-greta", name: "Anna Nowak", netGr: 12_800_00, category: CAT_TEAM },
    // pensja Hani spójna z podwyżką stawki od poprzedniego miesiąca
    { key: "pensja-hania", name: "Katarzyna Dąbrowska", netGr: offset >= 2 ? 11_000_00 : 12_600_00, category: CAT_TEAM },
    { key: "pensja-bartek", name: "Piotr Jankowski", netGr: 10_200_00, category: CAT_TEAM },
    { key: "pensja-ola", name: "Tomasz Lewicki", netGr: 8_200_00, category: CAT_TEAM },
  ];

  // 2 i 1 miesiąc temu: pensje zapłacone. Bieżący miesiąc: niezapłacone —
  // zarząd zatwierdzony do płatności ("Można płacić"), zespół czeka ("Brak działań").
  for (const offset of [2, 1]) {
    for (const s of salaryByMonth(offset)) {
      await createCost({
        supplierName: s.name,
        docNumber: `Lista płac ${mmYYYY(offset)}`,
        docDate: monthDay(offset, 1),
        dueDate: monthDay(offset, 10),
        netGr: s.netGr,
        vatRate: "ZW",
        category: s.category,
        paid: true,
        paidDate: earlier(monthDay(offset, 8), today),
        recurringKey: s.key,
      });
    }
  }
  for (const s of salaryByMonth(0)) {
    await createCost({
      supplierName: s.name,
      docNumber: `Lista płac ${mmYYYY(0)}`,
      docDate: monthDay(0, 1),
      dueDate: monthDay(0, 10),
      netGr: s.netGr,
      vatRate: "ZW",
      category: s.category,
      paid: false,
      approvedForPayment: s.category === CAT_BOARD, // zarząd gotowy do przelewu
      recurringKey: s.key,
    });
  }

  // — abonamenty (co miesiąc; bieżący miesiąc NIEZAPŁACONE, Claude bez kopii w bieżącym
  //   — wygeneruje się jako "do potwierdzenia" z szablonu cyklicznego)
  const subs = [
    { key: "google-workspace", name: "Google Workspace", account: nrbGoogle, netGr: 450_00, docBase: "Google Workspace", dueDay: 12, dueInDays: 5, approve: true },
    { key: "make", name: "MAKE (Celonis)", account: nrbMake, netGr: 380_00, docBase: "MAKE", dueDay: 15, dueInDays: 9, approve: true },
    { key: "claude", name: "Anthropic (Claude AI)", account: nrbClaude, netGr: 780_00, docBase: "Claude AI", dueDay: 10, dueInDays: 0, approve: false },
    { key: "tmobile", name: "T-Mobile Polska S.A.", account: nrbTmobile, netGr: 320_00, docBase: "t-mobile", dueDay: 8, dueInDays: 12, approve: false },
  ];
  for (const offset of [2, 1]) {
    for (const s of subs) {
      await createCost({
        supplierName: s.name,
        supplierAccount: s.account,
        docNumber: `${s.docBase} ${mmYYYY(offset)}`,
        docDate: monthDay(offset, 1),
        dueDate: monthDay(offset, s.dueDay),
        netGr: s.netGr,
        category: CAT_SUBS,
        paid: true,
        paidDate: monthDay(offset, s.dueDay),
        recurringKey: s.key,
      });
    }
  }
  for (const s of subs) {
    if (s.key === "claude") continue; // wygeneruje się jako "do potwierdzenia" (demo)
    await createCost({
      supplierName: s.name,
      supplierAccount: s.account,
      docNumber: `${s.docBase} ${mmYYYY(0)}`,
      docDate: monthDay(0, 1),
      dueDate: addDays(today, s.dueInDays),
      netGr: s.netGr,
      category: CAT_SUBS,
      paid: false,
      approvedForPayment: s.approve, // część "Można płacić", część "Brak działań"
      recurringKey: s.key,
    });
  }
  // — dodatkowe abonamenty (Canva Pro, Mailerlite, SMS Planet, Sellizer, iPhone raty)
  //   za bieżący miesiąc — niezapłacone, mix approvedForPayment.
  const extraSubsCurrent = [
    { name: "Canva Pty Ltd", doc: `Canva Pro ${mmYYYY(0)}`, netGr: 260_00, dueInDays: 6, approve: true },
    { name: "Mailerlite", doc: `Mailerlite ${mmYYYY(0)}`, netGr: 190_00, dueInDays: 8, approve: false },
    { name: "SMS Planet sp. z o.o.", doc: `SMS Planet ${mmYYYY(0)}`, netGr: 150_00, dueInDays: 4, approve: true },
    { name: "Sellizer sp. z o.o.", doc: `Sellizer ${mmYYYY(0)}`, netGr: 240_00, dueInDays: 10, approve: false },
    { name: "T-Mobile Polska S.A.", doc: `iPhone raty ${mmYYYY(0)}`, netGr: 330_00, dueInDays: 12, approve: false },
    { name: "OVHcloud Poland sp. z o.o.", account: nrbVps, doc: `VPS ${mmYYYY(0)}`, netGr: 210_00, dueInDays: 7, approve: true },
  ];
  for (const s of extraSubsCurrent) {
    await createCost({
      supplierName: s.name,
      supplierAccount: s.account,
      docNumber: s.doc,
      docDate: monthDay(0, 2),
      dueDate: addDays(today, s.dueInDays),
      netGr: s.netGr,
      category: CAT_SUBS,
      paid: false,
      approvedForPayment: s.approve,
    });
  }
  // — te same abonamenty za 2 poprzednie miesiące (zapłacone)
  for (const offset of [2, 1]) {
    for (const s of extraSubsCurrent) {
      await createCost({
        supplierName: s.name,
        supplierAccount: s.account,
        docNumber: s.doc.replace(mmYYYY(0), mmYYYY(offset)),
        docDate: monthDay(offset, 2),
        dueDate: monthDay(offset, 14),
        netGr: s.netGr,
        category: CAT_SUBS,
        paid: true,
        paidDate: monthDay(offset, 13),
      });
    }
  }

  // — Pozostałe wydatki operacyjne: czynsz/wynajem biura (bieżący NIEZAPŁACONY, NRB — demo Elixir)
  for (const offset of [2, 1]) {
    await createCost({
      supplierName: "Nieruchomości Marszałkowska sp. z o.o.",
      supplierAccount: nrbCzynsz,
      docNumber: `Czynsz biuro ${mmYYYY(offset)}`,
      docDate: monthDay(offset, 1),
      dueDate: monthDay(offset, 5),
      netGr: 4_200_00,
      category: CAT_OPEX,
      paid: true,
      paidDate: monthDay(offset, 5),
      recurringKey: "czynsz",
    });
  }
  await createCost({
    supplierName: "Nieruchomości Marszałkowska sp. z o.o.",
    supplierAccount: nrbCzynsz,
    docNumber: `Czynsz biuro ${mmYYYY(0)}`,
    docDate: monthDay(0, 1),
    dueDate: addDays(today, 4),
    netGr: 4_200_00,
    category: CAT_OPEX,
    paid: false,
    approvedForPayment: true, // czynsz gotowy do przelewu
    recurringKey: "czynsz",
  });

  // — Pozostałe wydatki operacyjne: prąd TAURON (co miesiąc)
  for (const offset of [2, 1]) {
    await createCost({
      supplierName: "TAURON Sprzedaż sp. z o.o.",
      docNumber: `Prąd biuro ${mmYYYY(offset)}`,
      docDate: monthDay(offset, 6),
      dueDate: monthDay(offset, 18),
      netGr: 480_00,
      category: CAT_OPEX,
      paid: true,
      paidDate: monthDay(offset, 17),
    });
  }
  await createCost({
    supplierName: "TAURON Sprzedaż sp. z o.o.",
    docNumber: `Prąd biuro ${mmYYYY(0)}`,
    docDate: monthDay(0, 6),
    dueDate: addDays(today, 9),
    netGr: 510_00,
    category: CAT_OPEX,
    paid: false,
    approvedForPayment: false, // "Brak działań"
  });

  // — Pozostałe wydatki operacyjne: prowizje (bramka płatnicza)
  for (const offset of [2, 1, 0]) {
    const paid = offset > 0;
    await createCost({
      supplierName: "PayU S.A.",
      docNumber: `Prowizje płatnicze ${mmYYYY(offset)}`,
      docDate: monthDay(offset, 4),
      dueDate: paid ? monthDay(offset, 12) : addDays(today, 5),
      netGr: 220_00 + offset * 10_00,
      category: CAT_OPEX,
      paid,
      paidDate: paid ? monthDay(offset, 11) : undefined,
      approvedForPayment: paid ? true : true, // bieżące prowizje zatwierdzone
    });
  }

  // — Abonamenty: księgowość co miesiąc (bieżący NIEZAPŁACONY, NRB)
  for (const offset of [2, 1]) {
    await createCost({
      supplierName: "Biuro Rachunkowe Balans sp. z o.o.",
      supplierAccount: nrbKsiegowosc,
      docNumber: `FV ${47 + (2 - offset) * 31}/${mmYYYY(offset)}`,
      docDate: monthDay(offset, 3),
      dueDate: monthDay(offset, 14),
      netGr: 1_400_00,
      category: CAT_SUBS,
      paid: true,
      paidDate: monthDay(offset, 13),
    });
  }
  await createCost({
    supplierName: "Biuro Rachunkowe Balans sp. z o.o.",
    supplierAccount: nrbKsiegowosc,
    docNumber: `FV 112/${mmYYYY(0)}`,
    docDate: monthDay(0, 3),
    dueDate: addDays(today, 7),
    netGr: 1_400_00,
    category: CAT_SUBS,
    paid: false,
    approvedForPayment: true, // księgowość gotowa do przelewu
  });

  // — Oszczędności: odkładane z konta co miesiąc (VAT ZW — transfer wewnętrzny)
  for (const offset of [2, 1]) {
    await createCost({
      supplierName: "adGen — konto oszczędnościowe",
      docNumber: `Odpis oszczędnościowy ${mmYYYY(offset)}`,
      docDate: monthDay(offset, 20),
      dueDate: monthDay(offset, 20),
      netGr: 5_000_00,
      vatRate: "ZW",
      category: CAT_SAVINGS,
      paid: true,
      paidDate: monthDay(offset, 20),
      note: "Odkładane z konta firmowego na poduszkę finansową.",
    });
  }
  await createCost({
    supplierName: "adGen — konto oszczędnościowe",
    docNumber: `Odpis oszczędnościowy ${mmYYYY(0)}`,
    docDate: monthDay(0, 20) > today ? monthDay(0, 2) : monthDay(0, 20),
    dueDate: addDays(today, 3),
    netGr: 5_000_00,
    vatRate: "ZW",
    category: CAT_SAVINGS,
    paid: false,
    approvedForPayment: false, // planowane, jeszcze bez decyzji
    note: "Planowany odpis oszczędnościowy na bieżący miesiąc.",
  });

  // — Inne: marketing własny adGen (Meta/Google Ads)
  const marketingDefs = [
    { offset: 2, supplier: "Meta Platforms Ireland Ltd.", doc: `Meta Ads — promocja adGen ${mmYYYY(2)}`, netGr: 1_200_00 },
    { offset: 1, supplier: "Google Ireland Ltd.", doc: `Google Ads — kampania rekrutacyjna ${mmYYYY(1)}`, netGr: 950_00 },
    { offset: 0, supplier: "Meta Platforms Ireland Ltd.", doc: `Meta Ads — promocja adGen ${mmYYYY(0)}`, netGr: 1_450_00 },
  ];
  for (const m of marketingDefs) {
    const paid = m.offset > 0;
    await createCost({
      supplierName: m.supplier,
      docNumber: m.doc,
      docDate: monthDay(m.offset, 2),
      dueDate: paid ? monthDay(m.offset, 16) : addDays(today, 8),
      netGr: m.netGr,
      category: CAT_OTHER,
      paid,
      paidDate: paid ? earlier(monthDay(m.offset, 15), today) : undefined,
      approvedForPayment: paid ? true : false, // bieżący "Brak działań"
    });
  }

  // — Inne: podróże (raz, poprzedni miesiąc)
  await createCost({
    supplierName: "PKP Intercity S.A.",
    docNumber: `Bilety ${mmYYYY(1)} — delegacja Kraków`,
    docDate: monthDay(1, 17),
    dueDate: monthDay(1, 17),
    netGr: 620_00,
    vatRate: "8",
    category: CAT_OTHER,
    paid: true,
    paidDate: monthDay(1, 17),
    note: "Wyjazd na spotkanie z potencjalnym klientem (Kraków).",
  });

  // — Podwykonawcy przypisani do klientów
  for (const offset of [2, 1]) {
    await createCost({
      supplierName: "Studio Graficzne Pixel — Anna Lis",
      docNumber: `FV ${8 + (2 - offset)}/${mmYYYY(offset)}`,
      docDate: monthDay(offset, 2),
      dueDate: monthDay(offset, 10),
      netGr: 3_500_00,
      category: CAT_SUBCONTRACTORS,
      clientId: techNova.id,
      paid: true,
      paidDate: monthDay(offset, 9),
      recurringKey: "grafik-technova",
    });
    await createCost({
      supplierName: "Marta Krajewska Copywriting",
      docNumber: `FV ${14 + (2 - offset)}/${mmYYYY(offset)}`,
      docDate: monthDay(offset, 2),
      dueDate: monthDay(offset, 12),
      netGr: 1_200_00,
      category: CAT_SUBCONTRACTORS,
      clientId: bistro.id,
      paid: true,
      paidDate: monthDay(offset, 11),
      recurringKey: "copy-bistro",
    });
    await createCost({
      supplierName: "Karol Sportowiec — trener i ambasador",
      docNumber: `FV ${3 + (2 - offset)}/${mmYYYY(offset)}`,
      docDate: monthDay(offset, 2),
      dueDate: monthDay(offset, 15),
      netGr: 4_500_00,
      category: CAT_SUBCONTRACTORS,
      clientId: fitLife.id,
      paid: true,
      paidDate: monthDay(offset, 14),
      recurringKey: "trener-fitlife",
    });
  }
  // studio foto dla Meble Wnętrza — jednorazowo, poprzedni miesiąc
  await createCost({
    supplierName: "Studio Foto Kadr sp. z o.o.",
    docNumber: `FV 41/${mmYYYY(1)}`,
    docDate: monthDay(1, 9),
    dueDate: monthDay(1, 23),
    netGr: 6_800_00,
    category: CAT_SUBCONTRACTORS,
    clientId: meble.id,
    paid: true,
    paidDate: monthDay(1, 22),
    note: "Sesja produktowa do kampanii wyprzedażowej.",
  });
  // bieżący miesiąc — podwykonawcy z szablonów (mix zapłacone/niezapłacone)
  await createCost({
    supplierName: "Studio Graficzne Pixel — Anna Lis",
    docNumber: `FV 10/${mmYYYY(0)}`,
    docDate: monthDay(0, 1),
    dueDate: monthDay(0, 10),
    netGr: 3_500_00,
    category: CAT_SUBCONTRACTORS,
    clientId: techNova.id,
    paid: true,
    paidDate: earlier(monthDay(0, 2), today),
    recurringKey: "grafik-technova",
  });
  await createCost({
    supplierName: "Marta Krajewska Copywriting",
    docNumber: `FV 16/${mmYYYY(0)}`,
    docDate: monthDay(0, 1),
    dueDate: addDays(today, 10),
    netGr: 1_200_00,
    category: CAT_SUBCONTRACTORS,
    clientId: bistro.id,
    paid: false,
    approvedForPayment: true, // "Można płacić"
    recurringKey: "copy-bistro",
  });
  await createCost({
    supplierName: "Karol Sportowiec — trener i ambasador",
    docNumber: `FV 5/${mmYYYY(0)}`,
    docDate: monthDay(0, 1),
    dueDate: monthDay(0, 15),
    netGr: 4_500_00,
    category: CAT_SUBCONTRACTORS,
    clientId: fitLife.id,
    paid: false,
    approvedForPayment: false, // "Brak działań"
    recurringKey: "trener-fitlife",
  });

  // — koszty po terminie (NIEZAPŁACONE, z NRB — demo Elixir/Płatności; zaległe mix)
  await createCost({
    supplierName: "Serwis Komputerowy Bajt",
    supplierAccount: nrbSerwis,
    docNumber: "FV 208/2026",
    docDate: addDays(today, -17),
    dueDate: addDays(today, -3),
    netGr: 890_00,
    category: CAT_OTHER,
    paid: false,
    approvedForPayment: true, // zaległy, ale zatwierdzony do przelewu
    note: "Naprawa MacBooka (dział kreacji) — po terminie.",
  });
  await createCost({
    supplierName: "OVHcloud Poland sp. z o.o.",
    supplierAccount: nrbVps,
    docNumber: "PRO/2026/5512",
    docDate: addDays(today, -16),
    dueDate: addDays(today, -2),
    netGr: 640_00,
    category: CAT_SUBS,
    paid: false,
    approvedForPayment: false, // zaległy, ale jeszcze "Brak działań"
    note: "Odnowienie VPS i domen — po terminie.",
  });

  // 9. Wpisy czasu — 3 miesiące, dni robocze, deterministycznie (mulberry32, ziarno 42)
  const descriptions = [
    "optymalizacja kampanii Meta Ads",
    "przygotowanie raportu miesięcznego",
    "kreacje do karuzeli",
    "spotkanie z klientem",
    "konfiguracja analityki i tagowania",
    "copywriting postów",
    "moderacja komentarzy i wiadomości",
    "przygotowanie prezentacji wyników",
    "testy A/B landing page",
    "brief kreatywny i research",
    "poprawki graficzne po feedbacku",
    "planowanie contentu na kolejny tydzień",
    "audyt konta reklamowego",
    "harmonogram publikacji",
  ];

  // wagi podziału czasu na klientów per pracownik
  const workProfiles: { userId: string; weights: [string, number][] }[] = [
    {
      userId: employees.get("Marek Wójcik")!,
      weights: [
        [techNova.id, 0.5],
        [meble.id, 0.3],
        [fitLife.id, 0.2],
      ],
    },
    {
      userId: employees.get("Anna Nowak")!,
      weights: [
        [bistro.id, 0.6],
        [techNova.id, 0.4],
      ],
    },
    {
      userId: employees.get("Katarzyna Dąbrowska")!,
      weights: [
        [techNova.id, 0.7],
        [bistro.id, 0.3],
      ],
    },
    {
      userId: employees.get("Piotr Jankowski")!,
      weights: [
        [meble.id, 0.5],
        [fitLife.id, 0.5],
      ],
    },
    {
      userId: employees.get("Tomasz Lewicki")!,
      weights: [
        [techNova.id, 0.4],
        [bistro.id, 0.3],
        [meble.id, 0.3],
      ],
    },
  ];

  function pickClient(weights: [string, number][]): string {
    let r = rand();
    for (const [id, w] of weights) {
      if (r < w) return id;
      r -= w;
    }
    return weights[weights.length - 1][0];
  }

  /** Dzieli sumę minut na n części, każda ≥ 30 min, wielokrotność 15. */
  function splitMinutes(total: number, n: number): number[] {
    const parts: number[] = [];
    let remaining = total;
    for (let i = n - 1; i > 0; i--) {
      const maxPart = remaining - 30 * i;
      let part = Math.round((remaining * (0.25 + rand() * 0.5)) / 15) * 15;
      part = Math.max(30, Math.min(part, maxPart));
      parts.push(part);
      remaining -= part;
    }
    parts.push(remaining);
    return parts;
  }

  const timeEntries: {
    userId: string;
    clientId: string;
    date: Date;
    minutes: number;
    description: string;
  }[] = [];

  const rangeStart = monthDay(2, 1);
  for (
    let d = new Date(rangeStart);
    d.getTime() <= today.getTime();
    d = addDays(d, 1)
  ) {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // tylko pon–pt
    for (const profile of workProfiles) {
      // 6–8 h dziennie w krokach 15 min
      const totalMinutes = (24 + Math.floor(rand() * 9)) * 15;
      const entryCount = rand() < 0.4 ? 3 : 2;
      const parts = splitMinutes(totalMinutes, entryCount);
      for (const minutes of parts) {
        timeEntries.push({
          userId: profile.userId,
          clientId: pickClient(profile.weights),
          date: new Date(d),
          minutes,
          description: descriptions[Math.floor(rand() * descriptions.length)],
        });
      }
    }
  }
  await db.timeEntry.createMany({ data: timeEntries });

  // 10. Podsumowanie + szybkie sanity
  const [salaryCatCount, approvedUnpaidCount, planNotesCount] = await Promise.all([
    db.costCategory.count({ where: { isSalary: true } }),
    db.cost.count({ where: { approvedForPayment: true, paid: false } }),
    db.revenuePlanNote.count(),
  ]);

  const counts = {
    ustawienia: await db.setting.count(),
    kategorie: await db.costCategory.count(),
    uzytkownicy: await db.user.count(),
    stawki: await db.hourlyRate.count(),
    klienci: await db.client.count(),
    faktury: await db.invoice.count(),
    koszty: await db.cost.count(),
    szablonyCykliczne: await db.recurringCost.count(),
    uwagiPlanu: planNotesCount,
    wpisyCzasu: await db.timeEntry.count(),
  };

  console.log("Seed zakończony. Utworzono:");
  console.log(`  ustawienia:              ${counts.ustawienia}`);
  console.log(`  kategorie kosztów:       ${counts.kategorie} (w tym isSalary: ${salaryCatCount})`);
  console.log(`  użytkownicy:             ${counts.uzytkownicy}`);
  console.log(`  stawki godzinowe:        ${counts.stawki}`);
  console.log(`  klienci:                 ${counts.klienci}`);
  console.log(`  przychody (rejestr):     ${counts.faktury}`);
  console.log(`  koszty:                  ${counts.koszty} (do zapłaty zatwierdzone: ${approvedUnpaidCount})`);
  console.log(`  szablony cykliczne:      ${counts.szablonyCykliczne}`);
  console.log(`  uwagi planu przychodów:  ${counts.uwagiPlanu}`);
  console.log(`  wpisy czasu:             ${counts.wpisyCzasu}`);
  console.log("");
  console.log("Zaloguj się: admin@adgen.pl / AdGen2026!");
}

main()
  .catch((e) => {
    console.error("Błąd seeda:", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
