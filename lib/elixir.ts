// Eksport paczki przelewów w formacie Elixir-0 (import w bankowości elektronicznej).
//
// Format wiersza (pola rozdzielone przecinkami, teksty w cudzysłowach, CRLF):
//  1. typ komunikatu: 110 (polecenie przelewu)
//  2. data płatności RRRRMMDD
//  3. kwota w groszach (bez separatora)
//  4. numer rozliczeniowy banku zleceniodawcy (cyfry 3–10 NRB)
//  5. 0
//  6. rachunek zleceniodawcy (26 cyfr)
//  7. rachunek beneficjenta (26 cyfr)
//  8. nazwa i adres zleceniodawcy (do 4 linii po 35 znaków, separator |)
//  9. nazwa i adres beneficjenta
// 10. 0
// 11. numer rozliczeniowy banku beneficjenta (cyfry 3–10 jego NRB)
// 12. tytuł płatności (do 4 linii po 35 znaków, separator |)
// 13. puste
// 14. puste
// 15. "51" (klasyfikacja: przelew zwykły)
//
// Plik kodowany Windows-1250 (route handler używa iconv-lite).

export interface ElixirTransfer {
  dueDate: Date; // data płatności
  amountGr: number; // kwota w groszach
  receiverAccount: string; // NRB 26 cyfr
  receiverName: string;
  title: string;
}

export interface ElixirSender {
  account: string; // NRB 26 cyfr
  name: string;
  address?: string;
}

/** Usuwa z NRB wszystko poza cyframi (spacje, prefiks PL) */
export function normalizeAccount(account: string): string {
  return account.replace(/[^0-9]/g, "");
}

export function isValidNrb(account: string): boolean {
  return /^\d{26}$/.test(normalizeAccount(account));
}

/** Numer rozliczeniowy banku = cyfry 3–10 NRB (8 cyfr) */
export function bankSortCode(account: string): string {
  return normalizeAccount(account).slice(2, 10);
}

function chunkText(text: string, maxLines = 4, lineLen = 35): string {
  const cleaned = text.replace(/[\r\n|"]/g, " ").trim();
  const lines: string[] = [];
  for (let i = 0; i < cleaned.length && lines.length < maxLines; i += lineLen) {
    lines.push(cleaned.slice(i, i + lineLen));
  }
  return lines.join("|");
}

function formatElixirDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

export function buildElixirLine(
  transfer: ElixirTransfer,
  sender: ElixirSender
): string {
  const senderAccount = normalizeAccount(sender.account);
  const receiverAccount = normalizeAccount(transfer.receiverAccount);
  const senderText = chunkText(
    [sender.name, sender.address].filter(Boolean).join(" ")
  );
  const fields = [
    "110",
    formatElixirDate(transfer.dueDate),
    String(transfer.amountGr),
    bankSortCode(senderAccount),
    "0",
    `"${senderAccount}"`,
    `"${receiverAccount}"`,
    `"${senderText}"`,
    `"${chunkText(transfer.receiverName)}"`,
    "0",
    bankSortCode(receiverAccount),
    `"${chunkText(transfer.title)}"`,
    '""',
    '""',
    '"51"',
  ];
  return fields.join(",");
}

/** Buduje pełną treść pliku Elixir-0 (CRLF między wierszami) */
export function buildElixirFile(
  transfers: ElixirTransfer[],
  sender: ElixirSender
): string {
  return transfers.map((t) => buildElixirLine(t, sender)).join("\r\n") + "\r\n";
}
