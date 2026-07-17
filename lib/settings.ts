import "server-only";
import { db } from "./db";
import { RW_BOA_TARGETS } from "./rw";
import { SETTING_DEFAULTS, type SettingKey } from "./types";

export async function getSetting(key: SettingKey): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? SETTING_DEFAULTS[key];
}

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const rows = await db.setting.findMany();
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const result = { ...SETTING_DEFAULTS } as Record<SettingKey, string>;
  for (const key of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
    const v = map.get(key);
    if (v !== undefined) result[key] = v;
  }
  return result;
}

export async function setSetting(key: SettingKey, value: string): Promise<void> {
  await db.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function isAllocationEnabled(): Promise<boolean> {
  return (await getSetting("allocation_enabled")) === "1";
}

/** Próg marży (ułamek, np. 0.2) poniżej którego klient jest podświetlany */
export async function getMarginThresholdFraction(): Promise<number> {
  const raw = await getSetting("margin_threshold_pct");
  const pct = parseFloat(raw.replace(",", "."));
  return isFinite(pct) ? pct / 100 : 0.2;
}

export interface BoaTargets {
  oszczednosci: number;
  wlasciciele: number;
  operacyjne: number;
  podatkiIZaliczki: number;
}

const pctToFraction = (raw: string, fallback: number): number => {
  const pct = parseFloat(raw.replace(",", "."));
  return isFinite(pct) ? pct / 100 : fallback;
};

/** Cele BOA (ułamki przychodu) z Ustawień — z fallbackiem na wartości domyślne. */
export async function getBoaTargets(): Promise<BoaTargets> {
  const [oszcz, wlasc, oper, pod] = await Promise.all([
    getSetting("boa_oszczednosci_pct"),
    getSetting("boa_wlasciciele_pct"),
    getSetting("boa_operacyjne_pct"),
    getSetting("boa_podatki_pct"),
  ]);
  return {
    oszczednosci: pctToFraction(oszcz, RW_BOA_TARGETS.oszczednosci),
    wlasciciele: pctToFraction(wlasc, RW_BOA_TARGETS.wlasciciele),
    operacyjne: pctToFraction(oper, RW_BOA_TARGETS.operacyjne),
    podatkiIZaliczki: pctToFraction(pod, RW_BOA_TARGETS.podatkiIZaliczki),
  };
}

/**
 * Id kategorii wynagrodzeń (isSalary=true) — specjalna rola w rentowności:
 * rozliczane kosztem pracy z godzin, poza kosztami bezpośrednimi i alokacją.
 */
export async function getSalaryCategoryIds(): Promise<Set<string>> {
  const cats = await db.costCategory.findMany({
    where: { isSalary: true },
    select: { id: true },
  });
  return new Set(cats.map((c) => c.id));
}

/** Kategorie budżetu reklamowego (isAdBudget) — poza direct/alokacją w rentowności */
export async function getAdBudgetCategoryIds(): Promise<Set<string>> {
  const cats = await db.costCategory.findMany({
    where: { isAdBudget: true },
    select: { id: true },
  });
  return new Set(cats.map((c) => c.id));
}
