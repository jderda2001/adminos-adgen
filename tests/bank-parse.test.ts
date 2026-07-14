// Testy parsera wyciągu mBank (lib/bank-parse.ts).

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseMbankCsv, type BankParseResult } from "@/lib/bank-parse";

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
;;;;;
Podsumowanie salda;;;;;
`;

describe("parseMbankCsv", () => {
  const res = parseMbankCsv(MBANK_CSV);
  if ("formatError" in res) throw new Error(res.formatError);
  const r = res as BankParseResult;

  it("wykrywa format mBank i pomija preambułę + wiersze zbiorcze", () => {
    expect(r.bank).toBe("mBank");
    expect(r.rows).toHaveLength(3); // 3 operacje (pusty + „Podsumowanie" pominięte)
    expect(r.skippedEmpty).toBe(1);
    expect(r.skipped.some((s) => /podsumowanie/i.test(s.reason))).toBe(true);
  });

  it("dzieli po znaku kwoty na przychody/koszty i czyta kwotę wprost", () => {
    const anthropic = r.rows.find((x) => /anthropic/i.test(x.description))!;
    expect(anthropic.kind).toBe("KOSZT");
    expect(anthropic.amountGr).toBe(-12300);
    expect(anthropic.month).toBe(4);

    const przychod = r.rows.find((x) => /abonament/i.test(x.description))!;
    expect(przychod.kind).toBe("PRZYCHOD");
    expect(przychod.amountGr).toBe(123000);
  });

  it("zła data / brak nagłówka → formatError", () => {
    const bad = parseMbankCsv("Data;Kwota\n2026-01-01;100");
    expect("formatError" in bad).toBe(true);
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
    expect(res.rows.every((r) => Number.isInteger(r.amountGr) && r.amountGr !== 0)).toBe(true);
  });
});
