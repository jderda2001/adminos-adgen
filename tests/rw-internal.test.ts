// Testy wykrywania przelewów własnych i scalania wielu wyciągów (lib/rw-internal.ts)
// + wyciągania kont z preambuły mBank (lib/bank-parse.ts).

import { describe, expect, it } from "vitest";
import { parseMbankCsv, type BankParseResult } from "@/lib/bank-parse";
import {
  classifyBankRow,
  mergeBankFiles,
  DEFAULT_SELF_NAMES,
  type InternalRulesConfig,
} from "@/lib/rw-internal";

const CFG: InternalRulesConfig = {
  selfNames: DEFAULT_SELF_NAMES,
  accounts: [
    { match: "11 1140 2004 0000 3902 0000 0001", name: "Konto główne" },
    {
      match: "33334020040000390200000003",
      name: "Oszczędności",
      transferCategory: "Środki przelane na oszczędności",
    },
  ],
};

describe("classifyBankRow", () => {
  it("nazwa własna firmy w opisie → przelew własny (pomijany)", () => {
    const v = classifyBankRow(
      {
        description: "ADGEN SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ, PRZELEW ŚRODKÓW",
        account: "99 8888 7777 6666 5555 4444 3333",
        amountGr: -50000,
      },
      CFG
    );
    expect(v.internal).toBe(true);
    if (v.internal) expect(v.category).toBeNull();
  });

  it("kontrahent = konto z configu → przelew własny", () => {
    const v = classifyBankRow(
      { description: "PRZELEW ŚRODKÓW", account: "11114020040000390200000001", amountGr: 50000 },
      CFG
    );
    expect(v.internal).toBe(true);
    if (v.internal) expect(v.reason).toContain("Konto główne");
  });

  it("kontrahent = konto z preambuły innego pliku (ownNumbers) → własny", () => {
    const v = classifyBankRow(
      { description: "PRZELEW", account: "22 2240 2004 0000 3900 0000 0003", amountGr: -10000 },
      CFG,
      ["22224020040000390000000003"]
    );
    expect(v.internal).toBe(true);
  });

  it("konto z transferCategory: noga wychodząca DOSTAJE kategorię, przychodząca nie", () => {
    const out = classifyBankRow(
      { description: "PRZELEW WŁASNY", account: "33334020040000390200000003", amountGr: -900000 },
      CFG
    );
    expect(out.internal).toBe(true);
    if (out.internal) expect(out.category).toBe("Środki przelane na oszczędności");

    const inc = classifyBankRow(
      { description: "PRZELEW WŁASNY", account: "33334020040000390200000003", amountGr: 900000 },
      CFG
    );
    expect(inc.internal).toBe(true);
    if (inc.internal) expect(inc.category).toBeNull();
  });

  it("słowa kluczowe odłożonych środków (bez configu konta): oszczędności / premie / CIT", () => {
    const cases: [string, string][] = [
      ["ADGEN SP. Z O.O. PRZELEW NA OSZCZĘDNOŚCI", "Środki przelane na oszczędności"],
      ["ADGEN SP. Z O.O. ZALICZKA NA PREMIE ZESPOŁU", "Zaliczka na premie zespołu"],
      ["ADGEN SP. Z O.O. ZALICZKA CIT", "Zaliczka na podatek CIT"],
    ];
    for (const [desc, cat] of cases) {
      const v = classifyBankRow({ description: desc, account: "", amountGr: -100000 }, CFG);
      expect(v.internal).toBe(true);
      if (v.internal) expect(v.category).toBe(cat);
    }
  });

  it("zwykła operacja zewnętrzna → NIE własny", () => {
    const v = classifyBankRow(
      { description: "ANTHROPIC ZAKUP PRZY UŻYCIU KARTY", account: "", amountGr: -12300 },
      CFG
    );
    expect(v.internal).toBe(false);
  });
});

// ── scalanie wielu plików ────────────────────────────────────────────

const FILE_A = `mBank S.A.;
#dla rachunków:;
Przychody - 65 1140 2004 0000 3900 0000 0001;

#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2026-05-10;FIRMA X FVS/1;;Wpływy;"1 000,00 PLN";
2026-05-12;ADGEN SPÓŁKA Z O.O. PRZELEW ŚRODKÓW;91 1140 2004 0000 3900 0000 0002;Przelewy;-500,00 PLN;
`;

const FILE_B = `mBank S.A.;
#dla rachunków:;
Abonamenty (budżet reklamowy) - 91 1140 2004 0000 3900 0000 0002;

#Data operacji;#Opis operacji;#Rachunek;#Kategoria;#Kwota;
2026-05-12;ADGEN SPÓŁKA Z O.O. PRZELEW ŚRODKÓW;65 1140 2004 0000 3900 0000 0001;Przelewy;500,00 PLN;
2026-05-15;CANVA SUBSCRIPTION;;Karty;-49,00 PLN;
2026-05-10;FIRMA X FVS/1;;Wpływy;"1 000,00 PLN";
`;

describe("preambuła + mergeBankFiles", () => {
  const a = parseMbankCsv(FILE_A) as BankParseResult;
  const b = parseMbankCsv(FILE_B) as BankParseResult;

  it("konta z preambuły: nazwa + numer (same cyfry)", () => {
    expect(a.accounts).toEqual([{ name: "Przychody", number: "65114020040000390000000001" }]);
    expect(b.accounts[0].name).toContain("Abonamenty");
    expect(b.accounts[0].number).toBe("91114020040000390000000002");
  });

  it("scala pliki, usuwa duplikaty MIĘDZY plikami, sumuje konta", () => {
    const m = mergeBankFiles([
      { filename: "a.csv", rows: a.rows, accounts: a.accounts },
      { filename: "b.csv", rows: b.rows, accounts: b.accounts },
    ]);
    // FIRMA X 1000 zł występuje w obu plikach → raz
    expect(m.duplicates).toBe(1);
    expect(m.rows).toHaveLength(4);
    expect(m.accounts).toHaveLength(2);
    expect(m.rows.find((r) => /canva/i.test(r.description))?.sourceFile).toBe("b.csv");
  });

  it("identyczne operacje w JEDNYM pliku to NIE duplikaty (np. 2× Meta ta sama kwota)", () => {
    const m = mergeBankFiles([
      { filename: "a.csv", rows: [...b.rows, ...b.rows.slice(1, 2)], accounts: [] },
    ]);
    // CANVA celowo 2× w jednym pliku → obie zostają
    expect(m.duplicates).toBe(0);
    expect(m.rows.filter((r) => /canva/i.test(r.description))).toHaveLength(2);
  });

  it("ten sam plik wgrany dwa razy → dedup do oryginalnej liczby", () => {
    const m = mergeBankFiles([
      { filename: "b.csv", rows: b.rows, accounts: b.accounts },
      { filename: "b (1).csv", rows: b.rows, accounts: b.accounts },
    ]);
    expect(m.rows).toHaveLength(b.rows.length);
    expect(m.duplicates).toBe(b.rows.length);
  });

  it("obie nogi transferu wykrywane przez konta z preambuł (bez configu)", () => {
    const m = mergeBankFiles([
      { filename: "a.csv", rows: a.rows, accounts: a.accounts },
      { filename: "b.csv", rows: b.rows, accounts: b.accounts },
    ]);
    const own = m.accounts.map((x) => x.number);
    const cfg: InternalRulesConfig = { selfNames: ["adgen sp"], accounts: [] };
    const legs = m.rows.filter((r) => classifyBankRow(r, cfg, own).internal);
    expect(legs).toHaveLength(2);
    expect(legs.reduce((s, r) => s + r.amountGr, 0)).toBe(0); // nogi się znoszą
    // zewnętrzne operacje nietknięte
    expect(
      m.rows.filter((r) => !classifyBankRow(r, cfg, own).internal).map((r) => r.description)
    ).toEqual(expect.arrayContaining([expect.stringMatching(/FIRMA X/), expect.stringMatching(/CANVA/)]));
  });
});
