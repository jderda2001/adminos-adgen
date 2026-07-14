// Testy obsługi VAT-u (lib/rw-vat.ts): przeliczanie brutto→netto, walidacja
// stawek i klucz kontrahenta do reguł (RwVatRule).

import { describe, expect, it } from "vitest";
import {
  netFromGrossGr,
  coerceVatRate,
  isValidVatRate,
  vatMatchKey,
  VAT_RATES,
  DEFAULT_VAT_RATE,
} from "@/lib/rw-vat";

describe("netFromGrossGr", () => {
  it("dzieli przez 1,23 przy 23% (123,00 zł → 100,00 zł)", () => {
    expect(netFromGrossGr(12300, 23)).toBe(10000);
  });

  it("zachowuje znak dla kosztów (ujemne zostają ujemne)", () => {
    expect(netFromGrossGr(-12300, 23)).toBe(-10000);
  });

  it("stawka 0 = bez zmian (kwota już netto, np. reverse charge)", () => {
    expect(netFromGrossGr(9999, 0)).toBe(9999);
    expect(netFromGrossGr(-9999, 0)).toBe(-9999);
  });

  it("obsługuje 8% i 5%", () => {
    expect(netFromGrossGr(10800, 8)).toBe(10000);
    expect(netFromGrossGr(10500, 5)).toBe(10000);
  });

  it("zaokrągla do pełnego grosza", () => {
    // 100,00 brutto @23% = 81,300813... → 81,30 zł = 8130 gr
    expect(netFromGrossGr(10000, 23)).toBe(8130);
  });

  it("nieprawidłowa stawka traktowana jak 0 (bez zmiany)", () => {
    expect(netFromGrossGr(12300, 17 as unknown as number)).toBe(12300);
    expect(netFromGrossGr(12300, NaN as unknown as number)).toBe(12300);
  });

  it("odporny na niecałkowite/niepoprawne wejście", () => {
    expect(netFromGrossGr(NaN, 23)).toBe(0);
    expect(netFromGrossGr(12300.7, 0)).toBe(12300); // trunc
  });
});

describe("stawki VAT", () => {
  it("domyślna to 23%", () => {
    expect(DEFAULT_VAT_RATE).toBe(23);
  });

  it("isValidVatRate akceptuje tylko dozwolone", () => {
    for (const r of VAT_RATES) expect(isValidVatRate(r)).toBe(true);
    expect(isValidVatRate(17)).toBe(false);
    expect(isValidVatRate("23")).toBe(false);
    expect(isValidVatRate(undefined)).toBe(false);
  });

  it("coerceVatRate normalizuje do 0 gdy nieprawidłowa", () => {
    expect(coerceVatRate(23)).toBe(23);
    expect(coerceVatRate(17)).toBe(0);
    expect(coerceVatRate(null)).toBe(0);
  });
});

describe("vatMatchKey", () => {
  it("przelew (jest konto) → klucz z numeru konta", () => {
    const key = vatMatchKey({
      description: "FAKTURA 12/2026",
      account: "12 3456 7890 1234 5678 9012 3456",
    });
    expect(key).toBe("acct:12345678901234567890123456");
  });

  it("karta (brak konta) → klucz z tokenów opisu, bez boilerplate'u i cyfr", () => {
    const a = vatMatchKey({
      description: "META ADS ZAKUP PRZY UŻYCIU KARTY DEBETOWEJ NR 4256",
      account: "",
    });
    const b = vatMatchKey({
      description: "META ADS ZAKUP PRZY UŻYCIU KARTY DEBETOWEJ NR 9981",
      account: null,
    });
    // różne numery karty/ref, ten sam merchant → ten sam klucz (nauka działa)
    expect(a).toBe(b);
    expect(a).toContain("meta");
    expect(a).not.toContain("zakup");
    expect(a).not.toContain("4256");
  });

  it("różni merchantzy → różne klucze (brak kolizji przez wspólny boilerplate)", () => {
    const meta = vatMatchKey({ description: "META ADS ZAKUP PRZY UŻYCIU KARTY", account: "" });
    const google = vatMatchKey({ description: "GOOGLE ADS ZAKUP PRZY UŻYCIU KARTY", account: "" });
    expect(meta).not.toBe(google);
    expect(meta.length).toBeGreaterThan(0);
    expect(google.length).toBeGreaterThan(0);
  });

  it("brak sensownego klucza → pusty string (regula nie zapisywana)", () => {
    expect(vatMatchKey({ description: "", account: "" })).toBe("");
    expect(vatMatchKey({ description: "12 34", account: "999" })).toBe("");
  });
});
