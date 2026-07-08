// Testy parsera CSV rachunku wyników (lib/rw-parse.ts)

import { describe, expect, it } from "vitest";
import {
  detectRwCsvKind,
  parseCsv,
  parseRwAmountGr,
  parseRwCsv,
  parseRwMonth,
} from "@/lib/rw-parse";

describe("parseCsv (RFC 4180)", () => {
  it("pola w cudzysłowach z przecinkami i cudzysłowami", () => {
    const rows = parseCsv('a,"b,c","d""e"\n1,2,3');
    expect(rows).toEqual([
      ["a", "b,c", 'd"e'],
      ["1", "2", "3"],
    ]);
  });

  it("nowe linie wewnątrz pól i CRLF", () => {
    const rows = parseCsv('a,"linia1\nlinia2",c\r\nx,y,z');
    expect(rows).toEqual([
      ["a", "linia1\nlinia2", "c"],
      ["x", "y", "z"],
    ]);
  });

  it("usuwa BOM", () => {
    const rows = parseCsv("﻿Miesiąc,Klient\n01 - styczeń,X");
    expect(rows[0][0]).toBe("Miesiąc");
  });
});

describe("parseRwAmountGr", () => {
  it("polskie formaty kwot z pliku", () => {
    expect(parseRwAmountGr("1 459,00 zł")).toBe(145900);
    expect(parseRwAmountGr("-2 667,00 zł")).toBe(-266700);
    expect(parseRwAmountGr("257,3")).toBe(25730);
    expect(parseRwAmountGr("861")).toBe(86100);
    expect(parseRwAmountGr("3 250,00")).toBe(325000);
    expect(parseRwAmountGr("-194,00 PLN")).toBe(-19400);
  });

  it("twarde spacje (NBSP)", () => {
    expect(parseRwAmountGr("18 200,00 zł")).toBe(1820000);
  });

  it("nie-kwoty → null", () => {
    expect(parseRwAmountGr("")).toBeNull();
    expect(parseRwAmountGr("-")).toBeNull();
    expect(parseRwAmountGr("abc")).toBeNull();
    expect(parseRwAmountGr("2,19 ETH")).toBeNull();
  });

  it("kropka tysięcy (eksport w innym locale) → ODRZUCONE, nie 1000× za mało", () => {
    expect(parseRwAmountGr("1.459")).toBeNull();
    expect(parseRwAmountGr("2.500")).toBeNull();
    expect(parseRwAmountGr("-1.200")).toBeNull();
    expect(parseRwAmountGr("1.459,00")).toBeNull(); // mieszany format też odrzucony
    // legalne ułamki dziesiętne wciąż przechodzą
    expect(parseRwAmountGr("257,3")).toBe(25730);
    expect(parseRwAmountGr("12,34")).toBe(1234);
  });
});

describe("parseRwMonth", () => {
  it("formaty miesięcy", () => {
    expect(parseRwMonth("01 - styczeń")).toBe(1);
    expect(parseRwMonth("12 - grudzień")).toBe(12);
    expect(parseRwMonth("3 - marzec")).toBe(3);
    expect(parseRwMonth("06- czerwiec")).toBe(6);
  });
  it("nieprawidłowe → null", () => {
    expect(parseRwMonth("")).toBeNull();
    expect(parseRwMonth("styczeń")).toBeNull();
    expect(parseRwMonth("13 - trzynasty")).toBeNull();
  });
});

describe("detectRwCsvKind", () => {
  it("rozpoznaje oba formaty", () => {
    expect(
      detectRwCsvKind(["Miesiąc", "Klient", "Przychód netto", "Typ Przychodu", "NestBank / mBank", "Opis"])
    ).toBe("PRZYCHOD");
    expect(
      detectRwCsvKind(["Miesiąc", "Opis", "Netto", "Kategoria", "NestBank / mBank", "Brutto", "Kontrahent", "Uwagi"])
    ).toBe("KOSZT");
    expect(detectRwCsvKind(["Data", "Kwota"])).toBeNull();
  });
});

const REVENUE_CSV = `Miesiąc,Klient,Przychód netto,Typ Przychodu,NestBank / mBank,Opis
01 - styczeń,"FIRMA A, FVS/2026/01/1","1 000,00 zł",Abonament marketingowy,mBank,
01 - styczeń,FIRMA B,"2 500,00 zł",Paczki leadów (pilotaż),mBank,uwaga
,,,,,
02 - luty,FIRMA C,"500,50",Inne,NestBank,zwrot
`;

const COST_CSV = `Miesiąc,Opis,Netto,Kategoria,NestBank / mBank,Brutto,Kontrahent,Uwagi
01 - styczeń,"PRZELEW, wynagrodzenie","-4 000,00 zł",Delivery - wynagrodzenia,mBank,,Jan Kowalski,
01 - styczeń,Facebook ZAKUP,"-950,81 zł",Marketing - budżety,mBank,,Meta Ads,
02 - luty,KOREKTA,"100,00 zł",Inne,mBank,,mBank,zwrot opłaty
`;

describe("parseRwCsv — przychody", () => {
  it("parsuje wiersze, pomija puste separatory", () => {
    const res = parseRwCsv(REVENUE_CSV);
    if ("formatError" in res) throw new Error(res.formatError);
    expect(res.kind).toBe("PRZYCHOD");
    expect(res.errors).toEqual([]);
    expect(res.skippedEmpty).toBe(1);
    expect(res.entries).toHaveLength(3);
    expect(res.entries[0]).toMatchObject({
      month: 1,
      category: "Abonament marketingowy",
      amountGr: 100000,
      bank: "mBank",
    });
    expect(res.entries[2]).toMatchObject({ month: 2, category: "Inne", amountGr: 50050 });
  });

  it("nieznany typ przychodu → błąd z numerem linii", () => {
    const res = parseRwCsv(
      "Miesiąc,Klient,Przychód netto,Typ Przychodu\n01 - styczeń,X,100,Nieistniejący typ"
    );
    if ("formatError" in res) throw new Error(res.formatError);
    expect(res.entries).toHaveLength(0);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0].line).toBe(2);
    expect(res.errors[0].message).toContain("Nieznany typ przychodu");
  });
});

describe("parseRwCsv — koszty", () => {
  it("parsuje z kontrahentem i uwagami; dodatni koszt daje ostrzeżenie", () => {
    const res = parseRwCsv(COST_CSV);
    if ("formatError" in res) throw new Error(res.formatError);
    expect(res.kind).toBe("KOSZT");
    expect(res.errors).toEqual([]);
    expect(res.entries).toHaveLength(3);
    expect(res.entries[0]).toMatchObject({
      month: 1,
      category: "Delivery - wynagrodzenia",
      amountGr: -400000,
      contractor: "Jan Kowalski",
    });
    // korekta dodatnia: zachowany znak z pliku + ostrzeżenie
    expect(res.entries[2].amountGr).toBe(10000);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0].line).toBe(4);
  });

  it("kategoria „Inne” kosztów nie miesza się z „Inne” przychodów", () => {
    const res = parseRwCsv(COST_CSV);
    if ("formatError" in res) throw new Error(res.formatError);
    expect(res.entries[2].kind).toBe("KOSZT");
  });

  it("zły nagłówek → formatError", () => {
    const res = parseRwCsv("Data,Kwota\n2026-01-01,100");
    expect("formatError" in res).toBe(true);
  });
});
