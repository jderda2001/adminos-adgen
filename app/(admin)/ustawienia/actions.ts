"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import { isValidNrb, normalizeAccount } from "@/lib/elixir";
import { pluralPl } from "@/lib/format";
import { fail, ok, type ActionResult } from "@/lib/action-result";

// ── Rentowność ───────────────────────────────────────────────────────

const profitabilitySchema = z.object({
  allocationEnabled: z.enum(["0", "1"], {
    message: "Nieprawidłowa wartość przełącznika alokacji",
  }),
  marginThreshold: z
    .string()
    .trim()
    .min(1, "Podaj próg marży")
    .transform((v) => Number(v.replace(",", ".")))
    .refine(
      (v) => Number.isFinite(v) && v >= 0 && v <= 100,
      "Próg marży musi być liczbą od 0 do 100"
    ),
});

export async function saveProfitabilitySettingsAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = profitabilitySchema.safeParse({
    allocationEnabled: formData.get("allocationEnabled"),
    marginThreshold: formData.get("marginThreshold") ?? "",
  });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza"
    );
  }

  await setSetting("allocation_enabled", parsed.data.allocationEnabled);
  await setSetting("margin_threshold_pct", String(parsed.data.marginThreshold));

  revalidatePath("/ustawienia");
  revalidatePath("/rentownosc");
  revalidatePath("/dashboard");
  return ok("Ustawienia rentowności zostały zapisane");
}

// ── Integracje (Meta Ads) ────────────────────────────────────────────

export async function saveMetaAutosyncAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const enabled = formData.get("metaAutosyncEnabled") === "1" ? "1" : "0";
  await setSetting("meta_autosync_enabled", enabled);
  revalidatePath("/ustawienia");
  return ok(
    enabled === "1"
      ? "Codzienna synchronizacja z Meta włączona"
      : "Codzienna synchronizacja z Meta wyłączona"
  );
}

// ── Cele BOA (docelowy podział przychodu) ────────────────────────────

const pctField = z.coerce
  .number({ message: "Podaj procent" })
  .min(0, "Procent nie może być ujemny")
  .max(100, "Procent nie może przekraczać 100");

const boaSchema = z.object({
  oszczednosci: pctField,
  wlasciciele: pctField,
  operacyjne: pctField,
  podatki: pctField,
});

export async function saveBoaTargetsAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = boaSchema.safeParse({
    oszczednosci: formData.get("oszczednosci"),
    wlasciciele: formData.get("wlasciciele"),
    operacyjne: formData.get("operacyjne"),
    podatki: formData.get("podatki"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza");
  }

  const { oszczednosci, wlasciciele, operacyjne, podatki } = parsed.data;
  const sum = oszczednosci + wlasciciele + operacyjne + podatki;
  // tolerancja na zaokrąglenia (np. 9+23+65+3 = 100)
  if (Math.abs(sum - 100) > 0.5) {
    return fail(`Cele muszą sumować się do 100% (obecnie ${sum.toFixed(1)}%)`);
  }

  await setSetting("boa_oszczednosci_pct", String(oszczednosci));
  await setSetting("boa_wlasciciele_pct", String(wlasciciele));
  await setSetting("boa_operacyjne_pct", String(operacyjne));
  await setSetting("boa_podatki_pct", String(podatki));

  revalidatePath("/ustawienia");
  revalidatePath("/rachunek-wynikow");
  return ok("Cele BOA zostały zapisane");
}

// ── Dane firmy (eksport przelewów Elixir) ────────────────────────────

const companySchema = z.object({
  companyName: z.string().trim().min(1, "Podaj nazwę firmy"),
  companyAddress: z.string().trim(),
  companyAccount: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || isValidNrb(v),
      "Numer rachunku musi mieć 26 cyfr"
    ),
});

export async function saveCompanySettingsAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = companySchema.safeParse({
    companyName: formData.get("companyName") ?? "",
    companyAddress: formData.get("companyAddress") ?? "",
    companyAccount: formData.get("companyAccount") ?? "",
  });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza"
    );
  }
  const d = parsed.data;

  await setSetting("company_name", d.companyName);
  await setSetting("company_address", d.companyAddress);
  await setSetting(
    "company_account",
    d.companyAccount ? normalizeAccount(d.companyAccount) : ""
  );

  revalidatePath("/ustawienia");
  revalidatePath("/platnosci");
  return ok("Dane firmy zostały zapisane");
}

// ── Kategorie kosztów ────────────────────────────────────────────────

const categoryNameSchema = z
  .string()
  .trim()
  .min(1, "Podaj nazwę kategorii")
  .max(100, "Nazwa kategorii może mieć maksymalnie 100 znaków");

function revalidateCategories() {
  revalidatePath("/ustawienia");
  revalidatePath("/koszty");
}

export async function createCategoryAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const parsed = categoryNameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Podaj nazwę kategorii");
  }
  const name = parsed.data;

  const existing = await db.costCategory.findMany({
    select: { name: true, position: true },
  });
  if (existing.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return fail("Kategoria o tej nazwie już istnieje");
  }
  const maxPosition = existing.reduce((max, c) => Math.max(max, c.position), 0);

  await db.costCategory.create({ data: { name, position: maxPosition + 1 } });
  revalidateCategories();
  return ok("Kategoria została dodana");
}

export async function renameCategoryAction(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const category = await db.costCategory.findUnique({ where: { id } });
  if (!category) return fail("Kategoria nie istnieje");

  const parsed = categoryNameSchema.safeParse(formData.get("name") ?? "");
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Podaj nazwę kategorii");
  }
  const name = parsed.data;

  if (name === category.name) return ok("Nazwa kategorii bez zmian");

  // Filtr po nazwie w SQLite jest case-sensitive — unikalność sprawdzamy ręcznie
  const others = await db.costCategory.findMany({
    where: { id: { not: id } },
    select: { name: true },
  });
  if (others.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return fail("Kategoria o tej nazwie już istnieje");
  }

  await db.costCategory.update({ where: { id }, data: { name } });
  revalidateCategories();
  return ok("Nazwa kategorii została zmieniona");
}

export async function deleteCategoryAction(id: string): Promise<ActionResult> {
  await requireAdmin();

  const category = await db.costCategory.findUnique({
    where: { id },
    include: { _count: { select: { costs: true, recurringCosts: true } } },
  });
  if (!category) return fail("Kategoria nie istnieje");

  const usage = category._count.costs + category._count.recurringCosts;
  if (usage > 0) {
    return fail(
      `Nie można usunąć kategorii używanej przez ${usage} ${pluralPl(
        usage,
        "koszt",
        "koszty",
        "kosztów"
      )}`
    );
  }

  await db.costCategory.delete({ where: { id } });
  revalidateCategories();
  return ok("Kategoria została usunięta");
}

/**
 * Włącza/wyłącza flagę wynagrodzeń (isSalary) dla kategorii. Kategorie
 * wynagrodzeń są w rentowności rozliczane kosztem pracy z godzin — poza
 * kosztami bezpośrednimi klienta i poza pulą alokacji. Zastępuje dawną
 * twardo zaszytą jedną kategorię „wynagrodzenia” — teraz konfigurowalne
 * per kategoria (może być kilka).
 */
export async function toggleSalaryCategoryAction(
  id: string,
  isSalary: boolean
): Promise<ActionResult> {
  await requireAdmin();

  const category = await db.costCategory.findUnique({ where: { id } });
  if (!category) return fail("Kategoria nie istnieje");

  if (isSalary && category.isAdBudget) {
    return fail("Kategoria budżetu reklamowego nie może być jednocześnie wynagrodzeniami");
  }
  if (isSalary && category.isDeferred) {
    return fail("Kategoria odłożona nie może być jednocześnie wynagrodzeniami");
  }
  await db.costCategory.update({ where: { id }, data: { isSalary } });

  revalidatePath("/ustawienia");
  revalidatePath("/rentownosc");
  revalidatePath("/dashboard");
  return ok(
    isSalary
      ? "Kategoria oznaczona jako wynagrodzenia"
      : "Zdjęto oznaczenie wynagrodzeń z kategorii"
  );
}

export async function toggleAdBudgetCategoryAction(
  id: string,
  isAdBudget: boolean
): Promise<ActionResult> {
  await requireAdmin();

  const category = await db.costCategory.findUnique({ where: { id } });
  if (!category) return fail("Kategoria nie istnieje");
  if (isAdBudget && category.isSalary) {
    return fail("Kategoria wynagrodzeń nie może być jednocześnie budżetem reklamowym");
  }
  if (isAdBudget && category.isDeferred) {
    return fail("Kategoria odłożona nie może być jednocześnie budżetem reklamowym");
  }

  await db.costCategory.update({ where: { id }, data: { isAdBudget } });

  revalidatePath("/ustawienia");
  revalidatePath("/rentownosc");
  revalidatePath("/dashboard");
  revalidatePath("/leady");
  return ok(
    isAdBudget
      ? "Kategoria oznaczona jako budżet reklamowy"
      : "Zdjęto oznaczenie budżetu reklamowego z kategorii"
  );
}

/**
 * Włącza/wyłącza flagę „odłożone" (isDeferred) — koszt wewnętrzny/transfer na
 * własne konto (poduszka, inwestycje, zaliczki CIT). NIE liczony jako koszt
 * zewnętrzny w zysku/rentowności ani jako zobowiązanie do zapłaty.
 */
export async function toggleDeferredCategoryAction(
  id: string,
  isDeferred: boolean
): Promise<ActionResult> {
  await requireAdmin();

  const category = await db.costCategory.findUnique({ where: { id } });
  if (!category) return fail("Kategoria nie istnieje");
  if (isDeferred && category.isSalary) {
    return fail("Kategoria wynagrodzeń nie może być jednocześnie odłożona");
  }
  if (isDeferred && category.isAdBudget) {
    return fail("Kategoria budżetu reklamowego nie może być jednocześnie odłożona");
  }

  await db.costCategory.update({ where: { id }, data: { isDeferred } });

  revalidatePath("/ustawienia");
  revalidatePath("/rentownosc");
  revalidatePath("/dashboard");
  revalidatePath("/platnosci");
  return ok(
    isDeferred
      ? "Kategoria oznaczona jako odłożona (koszt wewnętrzny)"
      : "Zdjęto oznaczenie „odłożona” z kategorii"
  );
}
