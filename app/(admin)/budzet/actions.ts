"use server";

// Zapis planu miesięcznego (budżet). Upsert po okresie „RRRR-MM".

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { parseMoneyToGr } from "@/lib/format";

const schema = z.object({
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Nieprawidłowy miesiąc"),
  revenue: z.string().trim().optional().default(""),
  cost: z.string().trim().optional().default(""),
  leads: z.string().trim().optional().default(""),
  note: z.string().trim().optional().default(""),
});

export async function saveMonthlyBudgetAction(input: {
  period: string;
  revenue: string;
  cost: string;
  leads: string;
  note?: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  const d = parsed.data;

  const revenuePlanGr = d.revenue ? parseMoneyToGr(d.revenue) : 0;
  const costPlanGr = d.cost ? parseMoneyToGr(d.cost) : 0;
  if (revenuePlanGr === null || revenuePlanGr < 0) return fail("Podaj poprawny plan przychodu");
  if (costPlanGr === null || costPlanGr < 0) return fail("Podaj poprawny plan kosztów");

  let leadsPlan: number | null = null;
  if (d.leads) {
    const n = Number(d.leads.replace(/\s/g, ""));
    if (!Number.isInteger(n) || n < 0) return fail("Plan leadów musi być liczbą całkowitą (≥ 0)");
    leadsPlan = n;
  }

  const data = { revenuePlanGr, costPlanGr, leadsPlan, note: d.note || null };
  await db.monthlyBudget.upsert({
    where: { period: d.period },
    update: data,
    create: { period: d.period, ...data },
  });

  revalidatePath("/budzet");
  return ok("Plan zapisany");
}
