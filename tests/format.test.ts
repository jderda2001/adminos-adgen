// Testy formatowania i parsowania w polskich formatach (lib/format.ts).

import { describe, expect, it } from "vitest";
import {
  pluralPl,
  formatMoney,
  formatAmount,
  parseMoneyToGr,
  parseHoursToMinutes,
  formatDate,
  dateToInput,
  dateFromInput,
  daysOverdue,
  formatPercent,
  formatMonth,
} from "@/lib/format";

/** Intl wstawia twarde/wąskie spacje — normalizujemy wszystkie białe znaki do zwykłej spacji */
const norm = (s: string) => s.replace(/\s/g, " ");

describe("parseMoneyToGr", () => {
  it('"12 345,67" → 1234567', () => {
    expect(parseMoneyToGr("12 345,67")).toBe(1234567);
  });

  it('"1234.5" → 123450', () => {
    expect(parseMoneyToGr("1234.5")).toBe(123450);
  });

  it('"1 234" (bez groszy) → 123400', () => {
    expect(parseMoneyToGr("1 234")).toBe(123400);
  });

  it('"abc" → null', () => {
    expect(parseMoneyToGr("abc")).toBeNull();
  });

  it('ujemne "-50,00" → −5000', () => {
    expect(parseMoneyToGr("-50,00")).toBe(-5000);
  });

  it('sufiks "zł" jest ignorowany', () => {
    expect(parseMoneyToGr("100,00 zł")).toBe(10000);
  });

  it("pusty string i trzy miejsca po przecinku → null", () => {
    expect(parseMoneyToGr("")).toBeNull();
    expect(parseMoneyToGr("1,234")).toBeNull();
  });
});

describe("parseHoursToMinutes", () => {
  it('"1,5" → 90', () => {
    expect(parseHoursToMinutes("1,5")).toBe(90);
  });

  it('"0,25" → 15', () => {
    expect(parseHoursToMinutes("0,25")).toBe(15);
  });

  it('"0" → null (zero minut nie jest wpisem)', () => {
    expect(parseHoursToMinutes("0")).toBeNull();
  });

  it('"osiem" → null', () => {
    expect(parseHoursToMinutes("osiem")).toBeNull();
  });

  it('kropka też działa: "2.5" → 150', () => {
    expect(parseHoursToMinutes("2.5")).toBe(150);
  });

  it("ujemne → null", () => {
    expect(parseHoursToMinutes("-1")).toBeNull();
  });
});

describe("formatMoney / formatAmount", () => {
  it('1234567 gr → "12 345,67 zł"', () => {
    expect(norm(formatMoney(1234567))).toBe("12 345,67 zł");
  });

  it('0 gr → "0,00 zł"', () => {
    expect(norm(formatMoney(0))).toBe("0,00 zł");
  });

  it('kwota ujemna: −5000 gr → "-50,00 zł"', () => {
    expect(norm(formatMoney(-5000)).replace("−", "-")).toBe("-50,00 zł");
  });

  it('formatAmount bez symbolu: 1234567 → "12 345,67"', () => {
    expect(norm(formatAmount(1234567))).toBe("12 345,67");
  });
});

describe("formatDate / dateToInput / dateFromInput", () => {
  const date = new Date("2026-07-03T00:00:00.000Z");

  it('formatDate → "03.07.2026"', () => {
    expect(formatDate(date)).toBe("03.07.2026");
  });

  it('dateToInput → "2026-07-03"', () => {
    expect(dateToInput(date)).toBe("2026-07-03");
  });

  it("roundtrip dateFromInput(dateToInput(d)) zachowuje datę", () => {
    const parsed = dateFromInput(dateToInput(date));
    expect(parsed).not.toBeNull();
    expect(parsed!.getTime()).toBe(date.getTime());
  });

  it("dateFromInput zwraca północ UTC", () => {
    const d = dateFromInput("2026-01-15")!;
    expect(d.toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });

  it("niepoprawne wejście → null", () => {
    expect(dateFromInput("abc")).toBeNull();
    expect(dateFromInput("2026-7-3")).toBeNull(); // brak zer wiodących
    expect(dateFromInput("2026-13-01")).toBeNull(); // nieistniejący miesiąc
    expect(dateFromInput("")).toBeNull();
  });
});

describe("daysOverdue", () => {
  const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it("2 dni po terminie → 2", () => {
    expect(daysOverdue(d("2026-07-01"), d("2026-07-03"))).toBe(2);
  });

  it("w dniu terminu → 0", () => {
    expect(daysOverdue(d("2026-07-03"), d("2026-07-03"))).toBe(0);
  });

  it("przed terminem → wartość ujemna", () => {
    expect(daysOverdue(d("2026-07-10"), d("2026-07-03"))).toBe(-7);
  });
});

describe("formatPercent", () => {
  it('0.235 → "23,5%"', () => {
    expect(formatPercent(0.235)).toBe("23,5%");
  });

  it('zawsze jedna cyfra po przecinku: 0.2 → "20,0%"', () => {
    expect(formatPercent(0.2)).toBe("20,0%");
  });

  it('null → "—"', () => {
    expect(formatPercent(null)).toBe("—");
  });

  it('nieskończoność → "—"', () => {
    expect(formatPercent(Infinity)).toBe("—");
  });
});

describe("formatMonth", () => {
  it('"2026-07" → "lipiec 2026"', () => {
    expect(formatMonth("2026-07")).toBe("lipiec 2026");
  });

  it('"2025-01" → "styczeń 2025"', () => {
    expect(formatMonth("2025-01")).toBe("styczeń 2025");
  });

  it('"2026-12" → "grudzień 2026"', () => {
    expect(formatMonth("2026-12")).toBe("grudzień 2026");
  });
});

describe("pluralPl", () => {
  it("odmienia poprawnie one/few/many", () => {
    const f = (n: number) => pluralPl(n, "faktura", "faktury", "faktur");
    expect(f(1)).toBe("faktura");
    expect(f(2)).toBe("faktury");
    expect(f(4)).toBe("faktury");
    expect(f(5)).toBe("faktur");
    expect(f(12)).toBe("faktur");
    expect(f(14)).toBe("faktur");
    expect(f(22)).toBe("faktury");
    expect(f(104)).toBe("faktury");
    expect(f(112)).toBe("faktur");
    expect(f(0)).toBe("faktur");
  });
});
