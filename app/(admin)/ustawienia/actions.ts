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
