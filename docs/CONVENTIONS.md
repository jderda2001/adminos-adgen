# Konwencje projektu adGen Finanse

Wewnętrzny system finansowy agencji adGen. Next.js 16 (App Router) + TypeScript +
SQLite/Prisma 6 + Tailwind 4 + shadcn/ui (wariant radix-nova) + Recharts.
Cały interfejs PO POLSKU. Waluta PLN, kwoty w groszach (Int), formaty polskie.

## Zasady twarde (nie łamać)

1. **NIE modyfikuj**: `prisma/schema.prisma`, `package.json`, `lib/*` (auth, calc,
   reports, format, periods, csv, elixir, settings, types, db, action-result),
   `components/ui/*`, `components/app-sidebar.tsx`, layoutów `app/layout.tsx`,
   `app/(admin)/layout.tsx`, `app/moj-czas/layout.tsx`, `proxy.ts`, `app/globals.css`.
   Jeśli czegoś brakuje w tych plikach — opisz to w raporcie końcowym, nie edytuj.
2. **NIE instaluj pakietów.** Wszystko co potrzebne jest zainstalowane
   (@tanstack/react-table, recharts, zod v4, date-fns, sonner, lucide-react, iconv-lite).
3. **NIE uruchamiaj** `npm run dev` ani `prisma db push`. Możesz uruchamiać
   `npx tsc --noEmit` do sprawdzenia typów swoich plików.
4. Twórz WYŁĄCZNIE pliki w katalogach przydzielonych w Twoim zadaniu.
5. Kwoty ZAWSZE w groszach (Int). Nigdy float dla pieniędzy.
6. Agregaty finansowe liczone na kwotach NETTO. VAT osobno, informacyjnie.
7. Wszystkie akcje serwerowe i route handlery ZACZYNAJĄ się od `await requireAdmin()`
   (lub `await requireUser()` tam, gdzie pracownik działa na WŁASNYCH danych).
   RBAC egzekwujemy na poziomie API, nie tylko UI. Akcje na własnych danych pracownika
   muszą filtrować po `user.id` z sesji — nigdy nie przyjmuj userId z formularza.

## Stack i idiomy UI

- shadcn/ui w wariancie **Radix** — triggery przez `asChild` (klasyczne API):
  `<DialogTrigger asChild><Button>…</Button></DialogTrigger>`.
- Dostępne komponenty ui: button, card, input, label, select, table, tabs, dialog,
  dropdown-menu, badge, checkbox, textarea, separator, switch, alert-dialog,
  tooltip, skeleton, sonner. `Button` ma rozmiary: xs, sm, default, lg, icon,
  icon-xs, icon-sm. `SelectTrigger` przyjmuje `size="sm"`.
- Toasty: `import { toast } from "sonner"` → `toast.success/error(...)`.
- Ikony: lucide-react.
- Layout stron admina: strona w `app/(admin)/<moduł>/page.tsx` (server component),
  na górze `<PageHeader title="…" description="…">` z `components/page-header.tsx`.
- Tabele: `DataTable` + `SortableHeader` z `components/data-table.tsx`
  (sortowanie, paginacja, `footer` na wiersz sum, `meta: { align: "right" }`
  dla kolumn kwotowych, `emptyState` na pusty stan).
- Puste stany: `EmptyState` z `components/empty-state.tsx` — zawsze z instrukcją
  co zrobić po polsku.
- Filtr okresu: `<PeriodFilter />` z `components/period-filter.tsx` steruje
  parametrami URL `?okres=miesiac|kwartal|rok|zakres&od=&do=`; strona serwerowa
  czyta przez `resolvePeriod(await searchParams)` z `lib/periods.ts`.
  W Next 16 `searchParams` to Promise — `const params = await searchParams;`.

## Wzorzec modułu (przykład: app/(admin)/klienci/)

- `page.tsx` — server component: `await requireAdmin()`, pobranie danych Prismą
  (`db` z `@/lib/db`), mapowanie na serializowalne wiersze (Date → ISO string!),
  render client componentu tabeli.
- `actions.ts` — `"use server"`; każda akcja: `await requireAdmin()`, walidacja
  zod z polskimi komunikatami, operacja Prisma, `revalidatePath(...)`,
  zwrot `ActionResult` (`ok("…")` / `fail("…")` z `@/lib/action-result`).
  Parsowanie formularza przez jawną unię `{ success: false; error } | { success: true; data }`.
- `*-table.tsx`, `*-form.tsx` — client componenty; formularze w `Dialog`,
  submit przez `useTransition` + wywołanie akcji, `toast` na wynik, zamknięcie
  dialogu po sukcesie. Usuwanie przez `AlertDialog` z potwierdzeniem.
- Daty z serwera do klienta przekazuj jako ISO string; formatuj `formatDate()`.

## Formatowanie i parsowanie (lib/format.ts — używaj, nie pisz własnych)

- `formatMoney(gr)` → "12 345,67 zł"; `formatAmount(gr)` → "12 345,67"
- `parseMoneyToGr("12 345,67")` → grosze | null (waliduj w akcjach!)
- `parseHoursToMinutes("1,5")` → minuty | null; `formatHours(min)` → "1,5 h"
- `formatDate(d)` → "03.07.2026"; `dateToInput(d)` / `dateFromInput("2026-07-03")`
- `todayUTC()` — dzisiejsza data jako północ UTC (tak przechowujemy daty!)
- `formatPercent(0.235)` → "23,5%"; `formatMonth("2026-07")` → "lipiec 2026"
- `daysOverdue(due, today)` → liczba dni po terminie
- Stałe domenowe i polskie etykiety: `lib/types.ts` (INVOICE_STATUS_LABELS,
  VAT_RATES, VAT_RATE_LABELS, BILLING_MODEL_LABELS, ROLE_LABELS itd.)

## Wyliczenia (lib/calc.ts + lib/reports.ts — jedyne źródło prawdy)

- `computeItemAmounts`, `computeVatFromNet`, `sumAmounts` — kwoty pozycji/dokumentów
- `effectiveRateGr(rates, date)`, `laborCostGr(min, rate)` — stawki historyczne
- `lib/reports.ts`: `getDashboardData`, `getMonthlySeries`, `getCostStructure`,
  `getClientProfitability`, `getClientMonthlyProfit`, `refreshInvoiceStatuses`,
  `generateRecurringCosts` — NIE duplikuj tych zapytań, wołaj te funkcje.
- Przychód = faktury bez szkiców (status != DRAFT), wg daty sprzedaży.
  Koszt = wg daty dokumentu, bez pozycji `needsConfirmation=true`.
- Statusy/enumy w bazie to String — porównuj ze stałymi z `lib/types.ts`.

## Eksporty plików

- CSV: `toCsv(headers, rows)` + `csvResponse(content, filename)` z `lib/csv.ts`;
  route handler `app/api/eksport/<nazwa>/route.ts`, na początku `await requireAdmin()`.
  Kwoty w CSV przez `formatAmount()`, daty przez `formatDate()`.
- Elixir-0: `buildElixirFile`, `isValidNrb`, `normalizeAccount` z `lib/elixir.ts`;
  odpowiedź kodowana Windows-1250 przez `iconv-lite` (`iconv.encode(content, "win1250")`).

## Rozszerzenia pod realny flow adGen (aktualne)

- **Kategorie kosztów** mają flagę `isSalary` (bool). Kategorie wynagrodzeń
  (może być kilka, np. „Wypłaty | Zarząd", „Wypłaty | Zespół") są wyłączone z
  kosztów bezpośrednich i alokacji. Zamiast dawnego `getSalaryCategoryId()`
  używaj `getSalaryCategoryIds(): Promise<Set<string>>` z `lib/settings.ts`;
  `computeProfitability` przyjmuje `salaryCategoryIds: ReadonlySet<string>`.
  Startowe kategorie: `DEFAULT_COST_CATEGORIES` (tablica `{name, isSalary}`).
- **Koszt: `approvedForPayment`** (bool) — dwustopniowy flow płatności:
  „Brak działań" (false, niezapłacony) → „Można płacić" (true, niezapłacony) →
  „Opłacone" (paid=true). Etykiety: `COST_APPROVAL_LABELS`. Eksport Elixir i
  masowa płatność obejmują tylko `approvedForPayment=true`.
- **Klient: `offerTags`** (String, tagi po przecinku) — np. „META ADS ABO,
  PAKIETY LEADÓW". Podpowiedzi: `DEFAULT_OFFER_TAGS`. Renderuj jako Badge.
- **User: `monthlyBudgetGr`** (Int|null) — założenie miesięczne per pracownik
  do rozliczenia zespołu.
- **RevenuePlanNote** (clientId, period „RRRR-MM", note) — miesięczna uwaga do
  klienta w planie przychodów (unique [clientId, period]).
- **Ekonomika leadów (moduł Leady, `/leady`)**: `Brand` (marki wewnętrzne,
  CRUD w module), `LeadCampaignMonth` (period „RRRR-MM" × brand × wertykal:
  spendGr netto + leadsCount z Meta Ads Manager → CPL; unique [period, brandId,
  vertical]), `LeadDelivery` (dostawy leadów do klientów; brandId null = mix →
  średnia ważona CPL wertykalu). Silnik: `lib/leads.ts` (`buildLeadCosts`).
  Kategorie kosztów mają flagę `isAdBudget` — przelewy do Mety są poza kosztami
  bezpośrednimi i pulą alokacji; klientom przypisywany jest koszt leadów
  (leady × CPL), reszta = „nieprzypisane wydatki reklamowe". Tożsamość pionowa
  rentowności (V2): Σ zysków klientów − niealokowane − niepokryte wynagrodzenia
  − nieprzypisany spend = zysk firmy. `computeProfitability` przyjmuje
  opcjonalne `adBudgetCategoryIds` i `leadCosts`; `getAdBudgetCategoryIds()`
  w `lib/settings.ts`. Wertykale = `LEAD_CATEGORIES`. Nazwy marek to dane
  biznesowe poza repo: `config/brands.json` (gitignore, wzór
  `config/brands.example.json`), ładowane przez `loadDefaultBrands()`
  (`lib/brands-config.ts`) — jak `rw-people.json`. Skrypty
  `prisma/ensure-cost-categories.ts` i `prisma/ensure-brands.ts`
  (idempotentne, uruchamiane w deploy/update.sh; brak configu → brak marek).
- **Integracja Meta Ads (portfolio)**: automatyczne zaciąganie wydatków i leadów
  kampanii ze WSZYSTKICH kont reklamowych portfolio (`/me/adaccounts` →
  `/{act}/insights`). Klient: `lib/meta-ads.ts` (`isMetaConfigured`, `isMetaMock`,
  `fetchAdAccounts`, `fetchCampaignInsights`; tryb mock gdy brak `META_ACCESS_TOKEN`
  lub `META_MOCK=1` — deterministyczne dane, bez sieci). **Mapowanie dwupoziomowe**:
  `MetaAdAccountMap` — KONTO → marka wewnętrzna albo `ignored` (konto klienta
  abonamentowego, pomijane w całości); `MetaCampaignMap` — kampania → wertykal
  (marka dziedziczona z konta, `brandId` per kampania = opcjonalny override).
  Agregacja czysta: `lib/meta-sync.ts` (`aggregateMetaToCampaignMonths(insights,
  campaignMaps, accountMaps)` — sumuje per marka×wertykal; konta/kampanie ignored
  pomijane bez liczenia; brak marki lub wertykalu → pula „nieprzypisane"). Rdzeń
  zapisu: `lib/meta-sync-run.ts` (`runMetaSync(month)` — upsert map kont i kampanii,
  wpis `LeadCampaignMonth` z `source="META"` bez nadpisywania `source="MANUAL"`,
  log `MetaSyncRun`; bez auth). Wołany przez: akcję `syncMetaCampaignsAction`
  (przycisk „Zaciągnij z Mety", `requireAdmin`) oraz cron `POST /api/cron/meta-sync`
  (nagłówek `x-cron-secret == CRON_SECRET`, działa tylko gdy ustawienie
  `meta_autosync_enabled="1"`). UI przypisywania: `meta-mapping-dialog.tsx` —
  2 kroki (Konta → Kampanie), autosave optymistyczny, podpowiedź wertykalu z nazwy
  kampanii.
- **Ekonomika marek + budżety (moduł Leady)**: `BrandBudget` (period × brandId →
  budgetGr, plan miesiąca „żeby się spięło"). Silnik czysty `lib/brand-econ.ts`
  (`buildBrandEconomics` — leady/spend/CPL per marka, przychód z dostaw wg cen
  jednostkowych z faktur: klient×wertykal → fallback wertykal, leady bez ceny do
  `unpricedLeads`; marża = przychód − spend; budżet plan vs wydane; oraz
  `daysLeftInMonth`). Raporty: `getBrandEconomics(month)` (karty marek) i
  `getAdBudgetStatus(month)` (plan Σ marek vs wydane wg Mety vs zaksięgowane +
  tempo dzienne) — wspólna karta `components/ad-budget-summary.tsx` renderowana
  w `/leady` (variant card) i na górze `/finanse/koszty` (variant banner, bieżący
  miesiąc). Layout `/leady`: pasek Meta → karty marek → dostawy + cash-flow →
  `<details>` ze szczegółami (kampanie per wertykal, uzgodnienie). **Zmienne środowiskowe**
  (prod `.env`, nie w repo): `META_ACCESS_TOKEN` (System User token z `ads_read` +
  `business_management`), `META_API_VERSION` (dom. `v21.0`),
  `META_AD_ACCOUNT_ALLOWLIST` (opcjonalna, CSV `act_...`),
  `META_LEAD_ACTION_TYPES` (dom. `lead,onsite_conversion.lead_grouped`),
  `META_MOCK` (`1` = wymuś dane testowe), `CRON_SECRET` (sekret dla route cron).
  Bez tokena moduł działa na mocku. **Nigdy nie commituj tokena** ani App Secret.
- Polska odmiana liczebników: `pluralPl(n, one, few, many)` z `lib/format.ts`
  (np. `pluralPl(n, "faktura", "faktury", "faktur")`). Używaj wszędzie zamiast
  ręcznego `n === 1 ? … : …`.
- `csvEscape` neutralizuje formuły (=,+,-,@,tab) — nie obchodź go własnym CSV.

## Design system (redesign — obowiązuje w całym UI)

Cel: minimalistycznie, przejrzyście, przyjemnie. Widoki główne pokazują tylko
PODSTAWOWE dane; szczegóły i rzadsze akcje trafiają do wysuwanego panelu (Sheet),
nie przytłaczając list.

- **Czcionka**: Poppins (globalnie jako `--font-sans`; nagłówki `font-heading`).
  Nie ustawiaj własnych fontów. Nagłówki h1–h4 już mają `tracking` i wagę.
- **Tokeny/kolory** (z `app/globals.css` — używaj ich, NIE hardkoduj hexów):
  kolor marki = indygo (`--primary`, `text-primary`, `bg-primary`). Płótno strony
  `bg-background` (jasnoszare), karty `bg-card` (białe). Tekst pomocniczy
  `text-muted-foreground`. Obramowania `border` (subtelne). Kwoty ujemne/dodatnie
  przez tony (patrz KpiCard). Wykresy: kolory `var(--chart-1..5)`.
- **Karty**: `rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]`.
  Sekcje/panele składaj z takich kart. Unikaj ciężkich ramek i mocnych cieni.
- **KPI**: używaj `KpiCard` z `components/kpi-card.tsx` (label, value, sub, tone
  positive/negative/warning, opcjonalny `href` klikalnego kafla). Nie buduj
  własnych kafli KPI.
- **Statusy**: WSZYSTKIE znaczniki statusów przez `StatusBadge`
  (`components/status-badge.tsx`) z tonami neutral/indigo/blue/green/amber/red.
  Dla faktur/przychodów: `invoiceTone(status)`. Dla kosztów: `costTone(paid, approved)`.
  Nie wklejaj już własnych klas `bg-green-100…` na badge — użyj tonów.
- **Tabele**: `DataTable`/`SortableHeader` (już przestylowane: nagłówek
  uppercase, wiersze z hover). Kolumny kwotowe `meta: { align: "right" }`.
  Pokazuj w tabeli 4–7 najważniejszych kolumn; resztę (notatki, historia,
  szczegóły pozycji, dane kontaktowe) przenieś do panelu szczegółów.
- **Szczegóły/rozwinięcie**: `DetailSheet` + `DetailRow` z
  `components/detail-sheet.tsx` — prawy wysuwany panel. Klik w wiersz listy
  (`onRowClick`) albo akcja „Szczegóły" otwiera Sheet z pełnymi danymi i akcjami.
  Duże/rozbudowane treści NIE w Dialogu na środku — w Sheet.
- **Dialog**: zostaw wyłącznie do krótkich formularzy tworzenia/edycji i
  potwierdzeń (AlertDialog). Przeglądanie szczegółów → Sheet.
- **Pusty stan**: `EmptyState` (już przestylowany) z instrukcją po polsku.
- **Moduł czasu pracy jest UKRYTY** z nawigacji (sidebar bez „Czas pracy"/
  „Mój czas"). Trasy zostają, ale nie linkujemy ich (docelowo Clockify API).
  Nie dodawaj linków do czasu pracy.
- Liczby/kwoty: `tabular-nums`, wyrównanie do prawej w kolumnach kwotowych.

## Jakość

- Gęsty, czytelny layout narzędzia do pracy — bez marketingowych ozdobników.
- Wszystkie tabele: sortowanie, paginacja, sumy pod tabelą (footer), filtry nad tabelą.
- Komunikaty walidacji po polsku, np. "Podaj poprawną kwotę, np. 1 234,56".
- Klikalne wiersze tam, gdzie spec tego wymaga (`onRowClick` w DataTable).
- Liczby w komórkach: wyrównane do prawej (`meta: { align: "right" }`).

## Estymacje (prognoza finansowa)

Zakładka `/estymacje` — prognoza przychodów/kosztów (P&L, netto) i cash flow
(brutto) na 3/6/12 mies. Silnik `lib/forecast.ts` jest CZYSTY (bez bazy, `todayIso`
z zewnątrz) — testy `tests/forecast.test.ts`. Warstwa AI `lib/forecast-ai.ts`
(server-only, jak `lib/rw-ai.ts`) jest DORADCZA: `applyAiAdjustments` (czysta)
skaluje wyłącznie składniki ZAKŁADANE. Wejście ładuje wspólny `forecast-data.ts`
(`loadForecastInput`) — używany też przez `aiForecastAction` (serwer odbudowuje
input, nie ufa klientowi).

Modele: `CashSnapshot` (ręczny łączny stan kont — kotwica cash flow; suma kont,
więc „Oszczędności" są neutralne), `FinPlanEvent` (jednorazowe zdarzenia
gotówkowe), `Client.endDate/noticeMonths` (przychód umowny vs zakładany),
`RecurringCost.endPeriod` (raty/leasingi — `generateRecurringCosts` kończy na tym
miesiącu). Dedup szablon↔historia: `baselineResidual = max(0, śr.3M RW − Σszablonów)`.
Bez wpisanego `CashSnapshot` cash flow = null (EmptyState z instrukcją).

## Przypomnienia o płatnościach (Przychody)

Sekwencja miękkiej windykacji wokół `Invoice.dueDate` (SMS + e-mail + telefon).
Silnik czysty w `lib/payment-reminders.ts` (`REMINDER_STEPS` D-1…D+3, szablony,
`buildReminderTimeline`, `currentStepFor`) — testy `tests/payment-reminders.test.ts`.
Zasada „tylko najświeższy": aktualny jest krok o największym offsecie ≤ dni-od-
terminu; starsze niewykonane → pominięte. Zakres: statusy `ISSUED`/`OVERDUE`.
Stop z chwilą wpłaty (`markInvoicePaidAction` gasi QUEUED → SKIPPED) lub pauzy
(`Invoice.remindersEnabled`).

Model „kolejka z akceptacją": cron `POST /api/cron/payment-reminders` (nagłówek
`x-cron-secret`, gate `payment_reminders_enabled`) KOLEJKUJE należne kroki
(`lib/reminder-run.ts`); wysyłkę odpala admin ręcznie z osi czasu w szczegółach
pozycji (`reminder-timeline.tsx` + `reminder-actions.ts`). Wysyłka przez
`lib/notify.ts` z BRAMKĄ `notify_mode`: `"off"` = SYMULACJA (nic nie wychodzi,
status `SIMULATED`), `"live"` = realny SMTP (nodemailer) / HTTP SMS. Sekrety
SMTP/SMS w tabeli `Setting` (jak `meta_app_secret`). Prod: dopisać do crontab
dzienny `curl` na route (jak meta-sync).
