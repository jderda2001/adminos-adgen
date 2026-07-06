"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { parseMoneyToGr } from "@/lib/format";

/**
 * Ustaw założenie miesięczne (budżet wypłaty) pracownika do rozliczenia zespołu.
 * Pusta wartość → null (brak założenia). Kwota parsowana z zł na grosze.
 */
export async function setMonthlyBudgetAction(
  userId: string,
  budgetInput: string
): Promise<ActionResult> {
  await requireAdmin();

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail("Użytkownik nie istnieje");

  const raw = budgetInput.trim();
  let monthlyBudgetGr: number | null = null;
  if (raw !== "") {
    monthlyBudgetGr = parseMoneyToGr(raw);
    if (monthlyBudgetGr === null || monthlyBudgetGr < 0) {
      return fail("Podaj poprawną kwotę założenia, np. 8 000,00");
    }
  }

  await db.user.update({ where: { id: userId }, data: { monthlyBudgetGr } });
  revalidatePath("/zespol/rozliczenie");
  revalidatePath("/zespol");
  return ok(
    monthlyBudgetGr === null
      ? "Założenie zostało wyczyszczone"
      : "Założenie zostało zapisane"
  );
}
