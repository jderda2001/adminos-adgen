import "server-only";
import { db } from "./db";
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
