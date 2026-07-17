// Testy filtra okresu (lib/periods.ts). Zakresy półotwarte: [from, to).

import { describe, expect, it } from "vitest";
import {
  resolvePeriod,
  currentMonthPeriod,
  monthKey,
  lastMonths,
  lastMonthsRange,
  monthBounds,
  monthKeysInRange,
  nextMonthKey,
} from "@/lib/periods";

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));

/** Granice bieżącego miesiąca wg tej samej logiki co todayUTC() (lokalna data kalendarzowa) */
function currentMonthBounds() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return { y, m, from: utc(y, m, 1), to: utc(y, m + 1, 1) };
}

describe("resolvePeriod", () => {
  it("domyślnie bieżący miesiąc: [1. dzień miesiąca, 1. dzień następnego)", () => {
    const { from, to } = currentMonthBounds();
    const p = resolvePeriod({});
    expect(p.type).toBe("miesiac");
    expect(p.from.getTime()).toBe(from.getTime());
    expect(p.to.getTime()).toBe(to.getTime());
  });

  it('okres "miesiac" z od=RRRR-MM wybiera konkretny miesiąc', () => {
    const p = resolvePeriod({ okres: "miesiac", od: "2026-03" });
    expect(p.type).toBe("miesiac");
    expect(p.from.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(p.label).toBe("marzec 2026");
  });

  it('"miesiac" z grudniem przechodzi na styczeń następnego roku', () => {
    const p = resolvePeriod({ okres: "miesiac", od: "2025-12" });
    expect(p.from.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it('"zakres": to = dzień PO dacie "do" (zakres półotwarty)', () => {
    const p = resolvePeriod({
      okres: "zakres",
      od: "2026-01-10",
      do: "2026-01-20",
    });
    expect(p.type).toBe("zakres");
    expect(p.from.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-01-21T00:00:00.000Z");
    expect(p.label).toBe("10.01.2026 – 20.01.2026");
  });

  it('"zakres" jednodniowy: od = do → to następnego dnia', () => {
    const p = resolvePeriod({
      okres: "zakres",
      od: "2026-07-03",
      do: "2026-07-03",
    });
    expect(p.from.toISOString()).toBe("2026-07-03T00:00:00.000Z");
    expect(p.to.toISOString()).toBe("2026-07-04T00:00:00.000Z");
  });

  it("niepoprawny zakres (od > do) → bieżący miesiąc", () => {
    const { from, to } = currentMonthBounds();
    const p = resolvePeriod({
      okres: "zakres",
      od: "2026-02-10",
      do: "2026-01-01",
    });
    expect(p.type).toBe("miesiac");
    expect(p.from.getTime()).toBe(from.getTime());
    expect(p.to.getTime()).toBe(to.getTime());
  });

  it("zakres bez dat lub z niepoprawnymi datami → bieżący miesiąc", () => {
    const { from } = currentMonthBounds();
    expect(resolvePeriod({ okres: "zakres" }).from.getTime()).toBe(
      from.getTime()
    );
    expect(
      resolvePeriod({ okres: "zakres", od: "abc", do: "2026-01-20" }).type
    ).toBe("miesiac");
  });

  it('"miesiac" z niepoprawnym od (nie RRRR-MM) → bieżący miesiąc', () => {
    const { from } = currentMonthBounds();
    const p = resolvePeriod({ okres: "miesiac", od: "2026-3" });
    expect(p.from.getTime()).toBe(from.getTime());
  });

  it('"kwartal" → bieżący kwartał [pierwszy miesiąc kwartału, pierwszy miesiąc następnego)', () => {
    const { y, m } = currentMonthBounds();
    const q = Math.floor(m / 3);
    const p = resolvePeriod({ okres: "kwartal" });
    expect(p.type).toBe("kwartal");
    expect(p.from.getTime()).toBe(utc(y, q * 3, 1).getTime());
    expect(p.to.getTime()).toBe(utc(y, q * 3 + 3, 1).getTime());
  });

  it('"rok" → bieżący rok kalendarzowy', () => {
    const { y } = currentMonthBounds();
    const p = resolvePeriod({ okres: "rok" });
    expect(p.from.getTime()).toBe(utc(y, 0, 1).getTime());
    expect(p.to.getTime()).toBe(utc(y + 1, 0, 1).getTime());
  });
});

describe("currentMonthPeriod", () => {
  it("zwraca bieżący miesiąc [from, to)", () => {
    const { from, to } = currentMonthBounds();
    const p = currentMonthPeriod();
    expect(p.type).toBe("miesiac");
    expect(p.from.getTime()).toBe(from.getTime());
    expect(p.to.getTime()).toBe(to.getTime());
  });
});

describe("monthKey", () => {
  it('data UTC → "RRRR-MM" z zerem wiodącym', () => {
    expect(monthKey(utc(2026, 6, 15))).toBe("2026-07");
    expect(monthKey(utc(2025, 0, 1))).toBe("2025-01");
    expect(monthKey(utc(2025, 11, 31))).toBe("2025-12");
  });
});

describe("lastMonths", () => {
  it("n kluczy rosnąco, ostatni = bieżący miesiąc", () => {
    const { y, m } = currentMonthBounds();
    const keys = lastMonths(3);
    expect(keys).toHaveLength(3);
    expect(keys[2]).toBe(monthKey(utc(y, m, 1)));
    expect(keys[1]).toBe(monthKey(utc(y, m - 1, 1)));
    expect(keys[0]).toBe(monthKey(utc(y, m - 2, 1)));
  });

  it("lastMonths(1) → tylko bieżący miesiąc", () => {
    const { y, m } = currentMonthBounds();
    expect(lastMonths(1)).toEqual([monthKey(utc(y, m, 1))]);
  });

  it("kolejne klucze są rosnące i przechodzą przez granicę roku", () => {
    const keys = lastMonths(14); // na pewno obejmuje przełom roku
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
    expect(new Set(keys).size).toBe(14);
  });
});

describe("lastMonthsRange", () => {
  it("[pierwszy dzień n−1 miesięcy temu, pierwszy dzień następnego miesiąca)", () => {
    const { y, m, to } = currentMonthBounds();
    const r = lastMonthsRange(3);
    expect(r.from.getTime()).toBe(utc(y, m - 2, 1).getTime());
    expect(r.to.getTime()).toBe(to.getTime());
  });
});

describe("monthBounds", () => {
  it('"2026-02" → [2026-02-01, 2026-03-01)', () => {
    const { from, to } = monthBounds("2026-02");
    expect(from.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it('grudzień: "2025-12" → to = 2026-01-01', () => {
    const { from, to } = monthBounds("2025-12");
    expect(from.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("nextMonthKey", () => {
  it("zwykły miesiąc i przełom roku", () => {
    expect(nextMonthKey("2026-07")).toBe("2026-08");
    expect(nextMonthKey("2026-12")).toBe("2027-01");
  });
});

describe("monthKeysInRange", () => {
  it("pojedynczy miesiąc [1.07, 1.08) → jeden klucz", () => {
    expect(monthKeysInRange(utc(2026, 6, 1), utc(2026, 7, 1))).toEqual(["2026-07"]);
  });

  it("kwartał → 3 miesiące", () => {
    expect(monthKeysInRange(utc(2026, 6, 1), utc(2026, 9, 1))).toEqual([
      "2026-07", "2026-08", "2026-09",
    ]);
  });

  it("rok → 12 miesięcy", () => {
    const keys = monthKeysInRange(utc(2026, 0, 1), utc(2027, 0, 1));
    expect(keys).toHaveLength(12);
    expect(keys[0]).toBe("2026-01");
    expect(keys[11]).toBe("2026-12");
  });

  it("zakres tnący miesiące (15.07 – 11.08, to ekskluzywne) → oba częściowe miesiące", () => {
    expect(monthKeysInRange(utc(2026, 6, 15), utc(2026, 7, 11))).toEqual([
      "2026-07", "2026-08",
    ]);
  });

  it("zakres wewnątrz jednego miesiąca → jeden klucz", () => {
    expect(monthKeysInRange(utc(2026, 6, 10), utc(2026, 6, 20))).toEqual(["2026-07"]);
  });

  it("przełom roku grudzień → styczeń", () => {
    expect(monthKeysInRange(utc(2025, 11, 20), utc(2026, 0, 5))).toEqual([
      "2025-12", "2026-01",
    ]);
  });

  it("pusty/odwrócony zakres → pusta lista", () => {
    expect(monthKeysInRange(utc(2026, 6, 1), utc(2026, 6, 1))).toEqual([]);
    expect(monthKeysInRange(utc(2026, 7, 1), utc(2026, 6, 1))).toEqual([]);
  });
});
