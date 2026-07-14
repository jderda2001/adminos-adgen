// Obsługa VAT-u przy imporcie wyciągu: wyciąg podaje kwoty BRUTTO, a rachunek
// wyników operuje NETTO. Stawka jest per operacja (Meta/Google = reverse charge
// czyli już netto/0%, polski podwykonawca = 23%, ZUS/opłaty = bez VAT), więc nie
// da się jej zgadnąć — użytkownik zaznacza ją ręcznie, a wybór zapamiętuje się
// per kontrahent (RwVatRule) i podpowiada przy kolejnym imporcie.
//
// Funkcje są czyste (bez zależności serwerowych) — używane i po stronie klienta
// (podgląd netto w oknie importu) i serwera (autorytatywne przeliczenie).

/** Dozwolone stawki VAT (w %). 0 = „bez VAT" (kwota już netto, np. reverse charge). */
export const VAT_RATES = [23, 8, 5, 0] as const;
export type VatRate = (typeof VAT_RATES)[number];

/** Domyślna stawka dla nowej operacji z wyciągu (większość to krajowe 23%). */
export const DEFAULT_VAT_RATE: VatRate = 23;

/** Etykiety do UI. */
export const VAT_RATE_LABELS: Record<VatRate, string> = {
  23: "23%",
  8: "8%",
  5: "5%",
  0: "bez VAT",
};

export function isValidVatRate(rate: unknown): rate is VatRate {
  return typeof rate === "number" && (VAT_RATES as readonly number[]).includes(rate);
}

/** Normalizuje dowolną wartość do prawidłowej stawki (domyślnie 0 = brak zmiany). */
export function coerceVatRate(rate: unknown): VatRate {
  return isValidVatRate(rate) ? rate : 0;
}

/**
 * Przelicza kwotę brutto (grosze, ze znakiem) na netto (grosze, ze znakiem)
 * dla danej stawki. Stawka 0 → kwota bez zmian. Zaokrąglenie do pełnego grosza
 * na wartości bezwzględnej (znak zachowany), więc koszt (−) zostaje kosztem.
 *
 *   netFromGrossGr(12300, 23)  →  10000   (123,00 zł brutto → 100,00 zł netto)
 *   netFromGrossGr(-12300, 23) →  -10000
 *   netFromGrossGr(9999, 0)    →  9999    (bez VAT — bez zmian)
 */
export function netFromGrossGr(grossGr: number, rate: unknown): number {
  if (!Number.isFinite(grossGr)) return 0;
  const gross = Math.trunc(grossGr);
  const r = coerceVatRate(rate);
  if (r === 0) return gross;
  const sign = gross < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(gross) / (1 + r / 100));
}

// Boilerplate mBanku w opisach płatności kartą — usuwany z klucza, żeby
// operacje różnych merchantów nie zlewały się w jeden klucz przez wspólny
// prefiks („zakup przy użyciu karty debetowej nr …").
const CARD_STOPWORDS = new Set([
  "zakup", "przy", "uzyciu", "karty", "karta", "kartą", "debetowej", "kredytowej",
  "platnosc", "platnosci", "platnosć", "transakcja", "transakcji", "operacja",
  "kurs", "data", "godz", "ref", "nr", "pln", "eur", "usd",
]);

/** usuwa polskie znaki diakrytyczne (do stabilnego, ascii klucza) */
function asciiFold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Klucz kontrahenta do reguły VAT. Dla PRZELEWÓW (jest numer konta kontrahenta)
 * używa numeru konta — najstabilniejszy sygnał (ten sam klient/dostawca = to samo
 * IBAN). Dla płatności KARTĄ (brak konta) buduje klucz z tokenów opisu po usunięciu
 * cyfr/boilerplate'u (zostaje nazwa merchanta). Pusty string = brak sensownego
 * klucza (nie zapisujemy reguły — użytkownik i tak kliknie).
 */
export function vatMatchKey(row: {
  description?: string | null;
  account?: string | null;
}): string {
  const digits = (row.account ?? "").replace(/\D/g, "");
  if (digits.length >= 16) return `acct:${digits}`;

  const desc = asciiFold((row.description ?? "").toLowerCase());
  const tokens = desc
    .replace(/[^a-z\s]/g, " ") // zostaw tylko litery (cyfry/ref/znaki → spacje)
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !CARD_STOPWORDS.has(t));
  const key = tokens.join(" ").slice(0, 80).trim();
  return key.length >= 4 ? key : "";
}
