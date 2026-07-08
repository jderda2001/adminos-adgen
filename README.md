# adGen Finanse

Wewnętrzny system zarządzania finansami agencji marketingowej **adGen**:
przychody, koszty (w tym cykliczne), płatności z eksportem przelewów Elixir-0,
czas pracy zespołu, rentowność klientów i dashboard zarządczy.
Self-hosted, ~5–15 użytkowników, cały interfejs po polsku, waluta PLN.

## Szybki start

Wymagania: Node.js 20+.

```bash
npm install
npx prisma db push      # tworzy bazę SQLite (prisma/dev.db)
npm run db:seed         # przykładowe dane (UWAGA: czyści całą bazę!)
npm run dev             # http://localhost:3000
```

Logowanie po seedzie:

| Rola | E-mail | Hasło |
|---|---|---|
| Admin (zarząd) | `admin@adgen.pl` | `AdGen2026!` |
| Pracownik (każdy z 5) | np. `maciej.nowicki@adgen.pl` | `Pracownik123!` |

Wersja produkcyjna: `npm run build && npm start`. Za HTTPS ustaw zmienną
`AUTH_SECURE_COOKIE=1`, aby ciasteczko sesji było wysyłane tylko po TLS.

**Tryb bez haseł (sieć zamknięta):** `AUTH_DISABLED=1` wyłącza logowanie —
każdy, kto dotrze do aplikacji, działa jako administrator. Używać wyłącznie,
gdy aplikacja jest osiągalna tylko w tailnecie (Tailscale), nigdy publicznie.
Zmiana env + restart przywraca hasła.

## Stack

- **Next.js 16** (App Router) + TypeScript
- **SQLite + Prisma 6** — plik `prisma/dev.db`; schemat bez enumów i bez
  typów specyficznych dla SQLite, więc migracja do Postgresa sprowadza się do
  zmiany `datasource` i `DATABASE_URL`
- **Tailwind CSS 4 + shadcn/ui**, wykresy **Recharts**
- Logowanie e-mail + hasło (bcrypt), sesje w bazie, ciasteczko httpOnly —
  bez zewnętrznych providerów
- **Zero integracji z API banków** — dane wprowadzane ręcznie; na zewnątrz
  wychodzi tylko plik przelewów Elixir-0 do importu w bankowości

## Role i uprawnienia

- **Admin** — pełny dostęp do wszystkich modułów.
- **Pracownik** — wyłącznie panel „Mój czas" (własne wpisy). Brak dostępu do
  finansów, rentowności, stawek (także własnej) i danych innych osób.

Uprawnienia są egzekwowane **na poziomie API**: każda akcja serwerowa i route
handler zaczyna się od `requireAdmin()` / `requireUser()` (`lib/auth.ts`),
a operacje pracownika są filtrowane po `userId` z sesji — nigdy z formularza.
Proxy (`proxy.ts`) sprawdza tylko obecność sesji; role weryfikuje serwer.

## Moduły

- **Rachunek wyników** (najważniejsza zakładka) — pełny RW firmy liczony
  automatycznie z importowanych CSV (formaty arkusza „Rachunek wyników" adGen:
  przychody per typ, koszty per kategoria). Sekcje jak w arkuszu: Przychody,
  Koszty produkcyjne (delivery), Marketing i sprzedaż (growth), Overhead,
  Odłożone środki, Wynik finansowy (Zysk, CIT, Marża I/II vs cel 10%),
  LIVE BOA, metryki ręczne (estymacja zysku, nowi klienci → CAC, windykacja,
  ETH…). Import z podglądem i historią partii (cofanie importu). Silnik
  wyliczeń pokryty „złotym testem" odtwarzającym arkusz co do złotówki.
- **Dashboard** — KPI (przychody, koszty, zysk, marża %, VAT do zapłaty,
  należności przeterminowane), przychody vs koszty (12 mies.), zysk i marża,
  Top 5 / dolna 3 klientów, struktura kosztów per kategoria.
- **Finanse → Plan miesiąca** — checklista fakturowania aktywnych klientów
  (jak arkusz „Przychody"): status faktury tego miesiąca (bez fv → wystawiona →
  opłacona/przeterminowana), tagi oferty, planowana kwota, edytowalna uwaga per
  klient i miesiąc, „czas do zapłaty" dla opłaconych. Widać, kogo jeszcze nie
  zafakturowano.
- **Finanse → Rejestr faktur** — faktury sprzedażowe z pozycjami (ilość × cena
  netto, VAT per pozycja), statusy szkic / wystawiona / zapłacona /
  przeterminowana (przeterminowana automatycznie po terminie), filtry, sumy,
  eksport CSV.
- **Finanse → Koszty** — faktury kosztowe: kategoria (słownik w Ustawieniach),
  przypisanie do klienta albo „koszt ogólny", załączniki (PDF/zdjęcie),
  status akceptacji do płatności (Brak działań → Można płacić → Opłacone),
  **koszty cykliczne**: szablon „powtarzaj co miesiąc" tworzy na początku
  miesiąca kopię „do potwierdzenia", zatwierdzaną jednym kliknięciem.
- **Płatności** — „Do zapłaty" (niezapłacone koszty wg terminu, akceptacja
  „można płacić" i oznaczanie zapłaconych pojedynczo i masowo) oraz „Do
  ściągnięcia" (niezapłacone faktury z liczbą dni po terminie). **Eksport paczki
  przelewów Elixir-0** dla zaznaczonych, zatwierdzonych kosztów (plik
  Windows-1250 do importu w banku; wymaga numeru rachunku firmy w Ustawieniach
  i rachunków NRB dostawców).
- **Czas pracy** — panel pracownika (wpis < 10 s: klient, opis, godziny, data,
  Enter zapisuje; timer start/stop; kopiowanie wczorajszego dnia; tygodniowa
  lista z sumami) oraz panel admina (wszystkie wpisy, filtry, koszt pracy =
  godziny × stawka historyczna, eksport CSV).
- **Rentowność klientów** — per klient: przychody, koszty bezpośrednie, koszt
  pracy, alokacja kosztów ogólnych (przełączana w Ustawieniach), zysk, marża %,
  efektywna stawka; klienci poniżej progu marży podświetleni; widok szczegółowy
  z wykresem miesięcznym; karta uzgodnienia z zyskiem firmy.
- **Klienci** — NIP, kontakt, model rozliczeń (abonament / projektowy /
  success fee), MRR, tagi oferty, status, notatki.
- **Zespół** — konta i role, zapraszanie z hasłem tymczasowym (wymuszona
  zmiana przy pierwszym logowaniu), stawki kosztowe z historią zmian
  (stawka działa od podanej daty; starsze wpisy liczone po starej stawce).
  **Rozliczenie** — koszt pracy zespołu w rozbiciu na tygodnie miesiąca vs
  założenie (budżet) per osoba, z podsumowaniem „suma live / założenie /
  różnica" (jak arkusz zespołu).
- **Ustawienia** — alokacja kosztów ogólnych wł./wył., próg marży, dane firmy
  i rachunek do Elixir, edytowalny słownik kategorii kosztów z konfigurowalną
  flagą „wynagrodzenia" per kategoria.

## Zasady wyliczeń

- Kwoty przechowywane w **groszach** (integer); agregaty liczone na kwotach
  **netto**, VAT osobno (informacyjnie: należny − naliczony = do zapłaty).
- Przychód przypisany do miesiąca po **dacie sprzedaży**, koszt po **dacie
  dokumentu**. Szkice faktur i niezatwierdzone kopie kosztów cyklicznych nie
  wchodzą do agregatów.
- Stawki VAT: 23%, 8%, 5%, 0%, zw.
- **Zgodność w pionie** (Rentowność ↔ Dashboard): kategoria kosztów
  „wynagrodzenia" nie wchodzi do kosztów bezpośrednich klienta ani do puli
  alokacji — pensje są rozliczane na klientów **kosztem pracy z godzin**
  (stawki godzinowe). Dzięki temu zachodzi, co do grosza:

  ```
  suma zysków klientów
    − koszty ogólne niealokowane
    − wynagrodzenia niepokryte godzinami (pensje − koszt pracy z godzin)
  = zysk firmy (przychody − wszystkie koszty)
  ```

  Uzgodnienie widać na dole modułu Rentowność. Właściwość jest pokryta
  testami jednostkowymi (`tests/calc.test.ts`).

## Wdrożenie (OVH + Tailscale)

Pełny runbook: **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**. W skrócie na serwerze:

```bash
cp .env.production.example .env      # uzupełnij DATABASE_URL (bezwzględna), AUTH_SECURE_COOKIE=1, ADMIN_*
npm ci
npx prisma db push                   # utworzenie schematu
npm run db:bootstrap                 # kategorie + ustawienia + konto admina (BEZ danych demo)
npm run build
sudo cp deploy/adgen-finanse.service /etc/systemd/system/ && sudo systemctl enable --now adgen-finanse
sudo tailscale serve --bg 3000       # dostęp po HTTPS w tailnecie
```

Aktualizacje: `./deploy/update.sh`. Aplikacja nasłuchuje na `127.0.0.1` i jest
wystawiana wyłącznie w tailnecie (nie w publicznym internecie).

## Testy

```bash
npm test
```

Testy jednostkowe pokrywają: kwoty pozycji i VAT (zaokrąglenia), stawki
historyczne i koszt pracy, rentowność klientów z tożsamością pionową
(alokacja wł./wył., grosze z zaokrągleń), P&L i marżę, parsowanie/formaty
polskie, format Elixir-0 i CSV oraz obsługę okresów.

## Struktura projektu

```
app/(admin)/…        moduły panelu admina (dashboard, finanse, płatności, …)
app/moj-czas/        panel czasu pracy (każdy zalogowany użytkownik)
app/login/           logowanie
app/api/eksport/     eksporty CSV i Elixir (route handlery, tylko admin)
lib/calc.ts          czyste funkcje wyliczeń (testowane jednostkowo)
lib/reports.ts       raporty na bazie (wspólne dla Dashboardu i Rentowności)
lib/auth.ts          sesje + requireUser/requireAdmin
prisma/schema.prisma schemat bazy (SQLite; gotowy na migrację do Postgresa)
prisma/seed.ts       dane przykładowe
uploads/             załączniki kosztów (poza gitem)
```

## Uwagi operacyjne

- **Koszty cykliczne** generują się „leniwie": przy pierwszym wejściu na
  Koszty lub Płatności w nowym miesiącu system tworzy kopie do potwierdzenia
  (self-hosted bez crona). 
- **Elixir-0**: plik kodowany Windows-1250, pola zgodne ze specyfikacją
  banków PL (typ 110, data RRRRMMDD, kwota w groszach, numery rozliczeniowe
  z NRB, klasyfikacja 51). Przed importem sprawdź w swojej bankowości, czy
  wymaga dokładnie tego wariantu formatu.
- `npm run db:seed` **czyści bazę** i wgrywa dane demo od nowa.
