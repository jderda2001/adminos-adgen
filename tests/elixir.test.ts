// Testy eksportu przelewów w formacie Elixir-0 (lib/elixir.ts).

import { describe, expect, it } from "vitest";
import {
  normalizeAccount,
  isValidNrb,
  bankSortCode,
  buildElixirLine,
  buildElixirFile,
  type ElixirSender,
  type ElixirTransfer,
} from "@/lib/elixir";

const SENDER_NRB = "61109010140000071219812874";
const RECEIVER_NRB = "83114020040000360276543210";

const sender: ElixirSender = {
  account: "PL61 1090 1014 0000 0712 1981 2874",
  name: "adGen sp. z o.o.",
};

const transfer: ElixirTransfer = {
  dueDate: new Date("2026-07-15T00:00:00.000Z"),
  amountGr: 123456,
  receiverAccount: "83 1140 2004 0000 3602 7654 3210",
  receiverName: "Firma Testowa Sp. z o.o.",
  title: "Faktura FV 2026/07/01",
};

describe("normalizeAccount", () => {
  it("usuwa prefiks PL i spacje → 26 cyfr", () => {
    expect(normalizeAccount("PL83 1140 2004 0000 3602 7654 3210")).toBe(
      RECEIVER_NRB
    );
    expect(normalizeAccount(RECEIVER_NRB)).toHaveLength(26);
  });

  it("usuwa wszystko poza cyframi", () => {
    expect(normalizeAccount("PL 61-1090:1014 0000 0712 1981 2874")).toBe(
      SENDER_NRB
    );
  });
});

describe("isValidNrb", () => {
  it("26 cyfr (także ze spacjami i prefiksem PL) → true", () => {
    expect(isValidNrb(RECEIVER_NRB)).toBe(true);
    expect(isValidNrb("PL83 1140 2004 0000 3602 7654 3210")).toBe(true);
  });

  it("za krótki / za długi / bez cyfr → false", () => {
    expect(isValidNrb(RECEIVER_NRB.slice(0, 25))).toBe(false);
    expect(isValidNrb(RECEIVER_NRB + "1")).toBe(false);
    expect(isValidNrb("abc")).toBe(false);
    expect(isValidNrb("")).toBe(false);
  });
});

describe("bankSortCode", () => {
  it("numer rozliczeniowy = cyfry 3–10 NRB (8 cyfr)", () => {
    expect(bankSortCode(RECEIVER_NRB)).toBe("11402004");
    expect(bankSortCode("PL61 1090 1014 0000 0712 1981 2874")).toBe("10901014");
  });
});

describe("buildElixirLine", () => {
  it("buduje wiersz pole po polu zgodnie ze specyfikacją Elixir-0", () => {
    const line = buildElixirLine(transfer, sender);
    // żadne pole testowe nie zawiera przecinka w cudzysłowie → split(",") jest bezpieczny
    const fields = line.split(",");

    expect(fields).toHaveLength(15);
    expect(fields[0]).toBe("110"); // typ komunikatu
    expect(fields[1]).toBe("20260715"); // data RRRRMMDD
    expect(fields[2]).toBe("123456"); // kwota w groszach, bez separatora
    expect(fields[3]).toBe("10901014"); // sort code zleceniodawcy
    expect(fields[4]).toBe("0");
    expect(fields[5]).toBe(`"${SENDER_NRB}"`); // rachunek zleceniodawcy w cudzysłowach
    expect(fields[6]).toBe(`"${RECEIVER_NRB}"`); // rachunek beneficjenta w cudzysłowach
    expect(fields[7]).toBe('"adGen sp. z o.o."'); // nazwa zleceniodawcy
    expect(fields[8]).toBe('"Firma Testowa Sp. z o.o."'); // nazwa beneficjenta
    expect(fields[9]).toBe("0");
    expect(fields[10]).toBe("11402004"); // sort code beneficjenta
    expect(fields[11]).toBe('"Faktura FV 2026/07/01"'); // tytuł
    expect(fields[12]).toBe('""');
    expect(fields[13]).toBe('""');
    expect(fields[14]).toBe('"51"'); // klasyfikacja: przelew zwykły
  });

  it("porównanie całej linii", () => {
    expect(buildElixirLine(transfer, sender)).toBe(
      `110,20260715,123456,10901014,0,"${SENDER_NRB}","${RECEIVER_NRB}",` +
        `"adGen sp. z o.o.","Firma Testowa Sp. z o.o.",0,11402004,` +
        `"Faktura FV 2026/07/01","","","51"`
    );
  });

  it('tytuł dłuższy niż 35 znaków dzielony na linie separatorem "|"', () => {
    const line = buildElixirLine(
      { ...transfer, title: "X".repeat(80) },
      sender
    );
    const fields = line.split(",");
    expect(fields[11]).toBe(
      `"${"X".repeat(35)}|${"X".repeat(35)}|${"X".repeat(10)}"`
    );
  });

  it("tytuł obcinany do maksymalnie 4 linii po 35 znaków", () => {
    const line = buildElixirLine(
      { ...transfer, title: "X".repeat(200) },
      sender
    );
    const fields = line.split(",");
    const inner = fields[11].slice(1, -1); // bez cudzysłowów
    const parts = inner.split("|");
    expect(parts).toHaveLength(4);
    for (const p of parts) expect(p).toBe("X".repeat(35));
  });

  it("adres zleceniodawcy doklejany do nazwy", () => {
    const line = buildElixirLine(transfer, {
      ...sender,
      name: "adGen",
      address: "ul. Prosta 1",
    });
    expect(line.split(",")[7]).toBe('"adGen ul. Prosta 1"');
  });
});

describe("buildElixirFile", () => {
  it("łączy wiersze CRLF i kończy plik CRLF", () => {
    const second: ElixirTransfer = { ...transfer, amountGr: 999 };
    const file = buildElixirFile([transfer, second], sender);

    const line1 = buildElixirLine(transfer, sender);
    const line2 = buildElixirLine(second, sender);
    expect(file).toBe(`${line1}\r\n${line2}\r\n`);
    expect(file.endsWith("\r\n")).toBe(true);
    // brak samotnych \n (tylko CRLF)
    expect(file.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("jeden przelew → jedna linia zakończona CRLF", () => {
    const file = buildElixirFile([transfer], sender);
    expect(file).toBe(buildElixirLine(transfer, sender) + "\r\n");
  });
});
