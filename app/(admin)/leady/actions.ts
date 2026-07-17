"use server";

// Akcje modułu Leady: kampanie miesięczne (marka × wertykal), dostawy leadów
// do klientów i CRUD marek wewnętrznych. Każda akcja: requireAdmin → zod (PL)
// → Prisma → revalidatePath (leady + rentowność + dashboard — koszt leadów
// wpływa na zyski) → ActionResult.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { parseMoneyToGr, pluralPl } from "@/lib/format";
import { LEAD_CATEGORIES } from "@/lib/types";

const PATHS = ["/leady", "/rentownosc", "/dashboard"] as const;
function revalidateAll() {
  for (const p of PATHS) revalidatePath(p);
}

const periodSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, "Nieprawidłowy miesiąc")
  .refine((p) => {
    const m = Number(p.slice(5, 7));
    return m >= 1 && m <= 12;
  }, "Nieprawidłowy miesiąc");

const verticalSchema = z.enum(LEAD_CATEGORIES, {
  message: "Wybierz wertykal z listy",
});

// ── Kampanie (marka × wertykal × miesiąc) ────────────────────────────

const campaignSchema = z.object({
  id: z.string().optional(),
  period: periodSchema,
  brandId: z.string().min(1, "Wybierz markę"),
  vertical: verticalSchema,
  spend: z.string().trim().min(1, "Podaj wydatki (netto)"),
  leads: z.string().trim().min(1, "Podaj liczbę leadów"),
  note: z.string().trim().optional(),
});

export async function saveCampaignAction(input: {
  id?: string;
  period: string;
  brandId: string;
  vertical: string;
  spend: string;
  leads: string;
  note?: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const parsed = campaignSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  }
  const d = parsed.data;

  const spendGr = parseMoneyToGr(d.spend);
  if (spendGr === null || spendGr < 0) {
    return fail("Podaj poprawne wydatki netto, np. 12 900,00");
  }
  const leadsCount = Number(d.leads.replace(/\s/g, ""));
  if (!Number.isInteger(leadsCount) || leadsCount < 0) {
    return fail("Liczba leadów musi być liczbą całkowitą (0 lub więcej)");
  }
  const brand = await db.brand.findUnique({ where: { id: d.brandId } });
  if (!brand) return fail("Wybrana marka nie istnieje");

  const data = {
    period: d.period,
    brandId: d.brandId,
    vertical: d.vertical,
    spendGr,
    leadsCount,
    note: d.note || null,
  };

  try {
    if (d.id) {
      await db.leadCampaignMonth.update({ where: { id: d.id }, data });
    } else {
      await db.leadCampaignMonth.create({ data });
    }
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return fail(
        "Kampania tej marki i wertykalu w tym miesiącu już istnieje — edytuj istniejący wiersz"
      );
    }
    throw e;
  }

  revalidateAll();
  return ok(d.id ? "Kampania zaktualizowana" : "Kampania dodana");
}

export async function deleteCampaignAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  await db.leadCampaignMonth.delete({ where: { id } }).catch(() => null);
  revalidateAll();
  return ok("Kampania usunięta");
}

// ── Dostawy leadów do klientów ───────────────────────────────────────

const deliverySchema = z.object({
  id: z.string().optional(),
  period: periodSchema,
  clientId: z.string().min(1, "Wybierz klienta"),
  vertical: verticalSchema,
  brandId: z.string().optional(), // "" = mix marek (średnia wertykalu)
  leads: z.string().trim().min(1, "Podaj liczbę leadów"),
  note: z.string().trim().optional(),
});

export async function saveDeliveryAction(input: {
  id?: string;
  period: string;
  clientId: string;
  vertical: string;
  brandId?: string;
  leads: string;
  note?: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const parsed = deliverySchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Nieprawidłowe dane");
  }
  const d = parsed.data;

  const leadsCount = Number(d.leads.replace(/\s/g, ""));
  if (!Number.isInteger(leadsCount) || leadsCount < 1) {
    return fail("Podaj liczbę leadów (min. 1)");
  }
  const client = await db.client.findUnique({ where: { id: d.clientId } });
  if (!client) return fail("Wybrany klient nie istnieje");
  const brandId = d.brandId || null;
  if (brandId) {
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    if (!brand) return fail("Wybrana marka nie istnieje");
  }

  const data = {
    period: d.period,
    clientId: d.clientId,
    vertical: d.vertical,
    brandId,
    leadsCount,
    note: d.note || null,
  };

  if (d.id) {
    await db.leadDelivery.update({ where: { id: d.id }, data });
  } else {
    await db.leadDelivery.create({ data });
  }

  revalidateAll();
  return ok(d.id ? "Dostawa zaktualizowana" : "Dostawa dodana");
}

export async function deleteDeliveryAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  await db.leadDelivery.delete({ where: { id } }).catch(() => null);
  revalidateAll();
  return ok("Dostawa usunięta");
}

// ── Marki wewnętrzne ─────────────────────────────────────────────────

const brandNameSchema = z
  .string()
  .trim()
  .min(1, "Podaj nazwę marki")
  .max(80, "Nazwa marki może mieć maks. 80 znaków");

export async function createBrandAction(name: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = brandNameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const exists = await db.brand.findUnique({ where: { name: parsed.data } });
  if (exists) return fail("Marka o tej nazwie już istnieje");
  const maxPos = (await db.brand.aggregate({ _max: { position: true } }))._max.position ?? 0;
  await db.brand.create({ data: { name: parsed.data, position: maxPos + 1 } });
  revalidateAll();
  return ok("Marka dodana");
}

export async function renameBrandAction(id: string, name: string): Promise<ActionResult> {
  await requireAdmin();
  const parsed = brandNameSchema.safeParse(name);
  if (!parsed.success) return fail(parsed.error.issues[0].message);
  const clash = await db.brand.findUnique({ where: { name: parsed.data } });
  if (clash && clash.id !== id) return fail("Marka o tej nazwie już istnieje");
  await db.brand.update({ where: { id }, data: { name: parsed.data } });
  revalidateAll();
  return ok("Nazwa marki zapisana");
}

export async function toggleBrandActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult> {
  await requireAdmin();
  await db.brand.update({ where: { id }, data: { active } });
  revalidateAll();
  return ok(active ? "Marka aktywna" : "Marka ukryta z nowych wpisów");
}

export async function deleteBrandAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const [campaigns, deliveries] = await Promise.all([
    db.leadCampaignMonth.count({ where: { brandId: id } }),
    db.leadDelivery.count({ where: { brandId: id } }),
  ]);
  const usage = campaigns + deliveries;
  if (usage > 0) {
    return fail(
      `Nie można usunąć — marka ma ${usage} ${pluralPl(usage, "wpis", "wpisy", "wpisów")} (kampanie/dostawy). Wyłącz ją zamiast usuwać.`
    );
  }
  await db.brand.delete({ where: { id } });
  revalidateAll();
  return ok("Marka usunięta");
}
