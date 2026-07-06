"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { todayUTC } from "@/lib/format";

const idsSchema = z
  .array(z.string().min(1))
  .min(1, "Zaznacz co najmniej jedną pozycję");

/** Polska odmiana: plural(3, "koszt", "koszty", "kosztów") → "koszty" */
function plural(n: number, one: string, few: string, many: string): string {
  if (n === 1) return one;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Oznacza koszty jako zapłacone (paid=true, paidDate=dziś) — pojedynczo i masowo */
export async function markCostsPaidAction(
  ids: string[]
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  }

  const result = await db.cost.updateMany({
    where: { id: { in: parsed.data }, paid: false, needsConfirmation: false },
    data: { paid: true, paidDate: todayUTC() },
  });
  if (result.count === 0) {
    return fail("Nie znaleziono niezapłaconych kosztów do oznaczenia");
  }

  revalidatePath("/platnosci");
  revalidatePath("/finanse/koszty");
  return ok(
    result.count === 1
      ? "Koszt oznaczony jako zapłacony"
      : `Oznaczono ${result.count} ${plural(result.count, "koszt", "koszty", "kosztów")} jako zapłacone`
  );
}

/** Oznacza koszty jako zatwierdzone do płatności (approvedForPayment=true) — „Można płacić" */
export async function approveCostsAction(
  ids: string[]
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  }

  const result = await db.cost.updateMany({
    where: {
      id: { in: parsed.data },
      paid: false,
      needsConfirmation: false,
      approvedForPayment: false,
    },
    data: { approvedForPayment: true },
  });
  if (result.count === 0) {
    return fail("Nie znaleziono kosztów do zatwierdzenia");
  }

  revalidatePath("/platnosci");
  revalidatePath("/finanse/koszty");
  return ok(
    result.count === 1
      ? "Koszt oznaczony jako „Można płacić”"
      : `Oznaczono ${result.count} ${plural(result.count, "koszt", "koszty", "kosztów")} jako „Można płacić”`
  );
}

/** Cofa zatwierdzenie kosztów do płatności (approvedForPayment=false) — „Brak działań" */
export async function unapproveCostsAction(
  ids: string[]
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  }

  const result = await db.cost.updateMany({
    where: {
      id: { in: parsed.data },
      paid: false,
      needsConfirmation: false,
      approvedForPayment: true,
    },
    data: { approvedForPayment: false },
  });
  if (result.count === 0) {
    return fail("Nie znaleziono kosztów do cofnięcia akceptacji");
  }

  revalidatePath("/platnosci");
  revalidatePath("/finanse/koszty");
  return ok(
    result.count === 1
      ? "Cofnięto akceptację kosztu"
      : `Cofnięto akceptację ${result.count} ${plural(result.count, "kosztu", "kosztów", "kosztów")}`
  );
}

/** Oznacza faktury sprzedażowe jako zapłacone (status=PAID, paidDate=dziś) */
export async function markInvoicesPaidAction(
  ids: string[]
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  }

  const result = await db.invoice.updateMany({
    where: { id: { in: parsed.data }, status: { in: ["ISSUED", "OVERDUE"] } },
    data: { status: "PAID", paidDate: todayUTC() },
  });
  if (result.count === 0) {
    return fail("Nie znaleziono nieopłaconych faktur do oznaczenia");
  }

  revalidatePath("/platnosci");
  revalidatePath("/finanse/przychody");
  return ok(
    result.count === 1
      ? "Faktura oznaczona jako zapłacona"
      : `Oznaczono ${result.count} ${plural(result.count, "fakturę", "faktury", "faktur")} jako zapłacone`
  );
}
