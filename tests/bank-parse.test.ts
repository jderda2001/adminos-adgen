// Testy parsera wyciągu mBank (lib/bank-parse.ts) + przeliczeń VAT.

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  parseMbankCsv,
  guessVatRate,
  netFromGrossGr,
  type BankParseResult,
} from "@/lib/bank-parse";

// syntetyczny wyciąg mBank: preambuła + nagłówek tabeli + operacje + śmieci
const MBANK_CSV = `mBank S.A. Bankowość Detaliczna;
www.mBank.pl;

#Klient;
JAN TESTOWY;

#Za okres:;
2026-04-01 2026-04-30;

#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2026-04-30;ANTHROPIC  ZAKUP PRZY UŻYCIU KARTY;12 3456 7890;Towary i materiały;-123,00 PLN;
2026-04-15;ABONAMENT MARKETINGOWY FIRMA X;98 7654 3210;Wpływy - inne;1 230,00 PLN;
2026-04-10;WYNAGRODZENIE UMOWA ZLECENIE;11 2233 4455;Przelewy;-3 000,00 PLN;
2026-04-05;OPŁATA ZA PROWADZENIE RACHUNKU;;Opłaty i prowizje;-30,00 PLN;
;;;;;
Podsumowanie salda;;;;;
`;

describe("parseMbankCsv", () => {
  const res = parseMbankCsv(MBANK_CSV);
  if ("formatError" in res) throw new Error(res.formatError);
  const r = res as BankParseResult;

  it("wykrywa format mBank i pomija preambułę + wiersze zbiorcze", () => {
    expect(r.bank).toBe("mBank");
    expect(r.rows).toHaveLength(4); // 4 operacje (pusty + „Podsumowanie" pominięte)
    expect(r.skippedEmpty).toBe(1);
    expect(r.skipped.some((s) => /podsumowanie/i.test(s.reason))).toBe(true);
  });

  it("dzieli po znaku kwoty na przychody/koszty i czyta brutto", () => {
    const anthropic = r.rows.find((x) => /anthropic/i.test(x.description))!;
    expect(anthropic.kind).toBe("KOSZT");
    expect(anthropic.grossAmountGr).toBe(-12300);
    expect(anthropic.month).toBe(4);

    const przychod = r.rows.find((x) => /abonament/i.test(x.description))!;
    expect(przychod.kind).toBe("PRZYCHOD");
    expect(przychod.grossAmountGr).toBe(123000);
  });

  it("zła data / brak nagłówka", () => {
    const bad = parseMbankCsv("Data;Kwota\n2026-01-01;100");
    expect("formatError" in bad).toBe(true);
  });
});

describe("guessVatRate", () => {
  it("wynagrodzenia, podatki, opłaty bankowe, oszczędności → 0%", () => {
    expect(guessVatRate({ description: "WYNAGRODZENIE UMOWA ZLECENIE" })).toBe(0);
    expect(guessVatRate({ description: "ZALICZKA NA PODATEK CIT" })).toBe(0);
    expect(guessVatRate({ description: "OPŁATA ZA PROWADZENIE RACHUNKU" })).toBe(0);
    expect(guessVatRate({ description: "PRZELEW NA OSZCZĘDNOŚCI" })).toBe(0);
    expect(guessVatRate({ description: "SKŁADKA UBEZPIECZENIE OC" })).toBe(0);
  });
  it("faktury/zakupy → 23% (domyślnie)", () => {
    expect(guessVatRate({ description: "ANTHROPIC ZAKUP" })).toBe(23);
    expect(guessVatRate({ description: "GOOGLE WORKSPACE" })).toBe(23);
  });
});

describe("netFromGrossGr", () => {
  it("÷1,23 (VAT 23%) i ÷1,08 (VAT 8%), nigdy ×0,77", () => {
    expect(netFromGrossGr(-12300, 23)).toBe(-10000); // 123,00 → 100,00
    expect(netFromGrossGr(123000, 23)).toBe(100000);
    expect(netFromGrossGr(10800, 8)).toBe(10000); // 108,00 → 100,00
    // nigdy ×0,77: 12300 × 0,77 = 9471 ≠ 10000
    expect(netFromGrossGr(-12300, 23)).not.toBe(-9471);
  });
  it("0% → netto = brutto (wynagrodzenia, podatki)", () => {
    expect(netFromGrossGr(-300000, 0)).toBe(-300000);
  });
});

// ── Złoty test: realny wyciąg mBank z ~/Downloads (nie commitowany) ──────
const MBANK_FILE = join(
  homedir(),
  "Downloads",
  "lista_operacji_260401_260430_202605181124188223.csv"
);

describe.skipIf(!existsSync(MBANK_FILE))("realny wyciąg mBank (kwiecień 2026)", () => {
  const res = parseMbankCsv(readFileSync(MBANK_FILE, "utf-8"));

  it("parsuje się jako mBank z sensowną liczbą operacji", () => {
    if ("formatError" in res) throw new Error(res.formatError);
    expect(res.bank).toBe("mBank");
    expect(res.rows.length).toBeGreaterThan(50);
  });

  it("wszystkie operacje w kwietniu, oba kierunki obecne, kwoty niezerowe", () => {
    if ("formatError" in res) throw new Error(res.formatError);
    expect(res.rows.every((r) => r.month === 4)).toBe(true);
    expect(res.rows.some((r) => r.kind === "PRZYCHOD")).toBe(true);
    expect(res.rows.some((r) => r.kind === "KOSZT")).toBe(true);
    expect(res.rows.every((r) => Number.isInteger(r.grossAmountGr) && r.grossAmountGr !== 0)).toBe(true);
  });
});
