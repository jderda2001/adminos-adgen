"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { parseMoneyToGr, dateFromInput } from "@/lib/format";
import { BILLING_MODELS, CLIENT_STATUSES } from "@/lib/types";

const clientSchema = z.object({
  name: z.string().trim().min(1, "Podaj nazwę klienta"),
  nip: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .refine((v) => v === "" || /^\d{10}$/.test(v), "NIP musi mieć 10 cyfr")
    .optional()
    .or(z.literal("")),
  contactPerson: z.string().trim().optional(),
  email: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "Podaj poprawny adres e-mail"
    )
    .optional(),
  phone: z.string().trim().optional(),
  address: z.string().trim().optional(),
  billingModel: z.enum(BILLING_MODELS, {
    message: "Wybierz model rozliczeń",
  }),
  monthlyRetainer: z.string().trim().optional(),
  offerTags: z.string().trim().optional(),
  status: z.enum(CLIENT_STATUSES, { message: "Wybierz status" }),
  startDate: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

/** Normalizuje tagi oferty: rozbij po przecinku, trim, usuń puste i duplikaty, złącz przecinkiem. */
function normalizeOfferTags(raw: string | undefined): string | null {
  const tags = (raw ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const unique: string[] = [];
  for (const t of tags) {
    if (!unique.some((u) => u.toLowerCase() === t.toLowerCase())) unique.push(t);
  }
  return unique.length > 0 ? unique.join(",") : null;
}

interface ClientData {
  name: string;
  nip: string | null;
  contactPerson: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  billingModel: string;
  monthlyRetainerGr: number | null;
  offerTags: string | null;
  status: string;
  startDate: Date | null;
  notes: string | null;
}

function parseClientForm(
  formData: FormData
): { success: false; error: string } | { success: true; data: ClientData } {
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    nip: formData.get("nip") ?? "",
    contactPerson: formData.get("contactPerson") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    address: formData.get("address") ?? "",
    billingModel: formData.get("billingModel"),
    monthlyRetainer: formData.get("monthlyRetainer") ?? "",
    offerTags: formData.get("offerTags") ?? "",
    status: formData.get("status"),
    startDate: formData.get("startDate") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza",
    };
  }
  const d = parsed.data;

  let monthlyRetainerGr: number | null = null;
  if (d.monthlyRetainer) {
    monthlyRetainerGr = parseMoneyToGr(d.monthlyRetainer);
    if (monthlyRetainerGr === null || monthlyRetainerGr < 0) {
      return {
        success: false,
        error: "Podaj poprawną kwotę abonamentu, np. 12 000,00",
      };
    }
  }

  let startDate: Date | null = null;
  if (d.startDate) {
    startDate = dateFromInput(d.startDate);
    if (!startDate) return { success: false, error: "Podaj poprawną datę startu" };
  }

  return {
    success: true,
    data: {
      name: d.name,
      nip: d.nip || null,
      contactPerson: d.contactPerson || null,
      email: d.email || null,
      phone: d.phone || null,
      address: d.address || null,
      billingModel: d.billingModel,
      monthlyRetainerGr,
      offerTags: normalizeOfferTags(d.offerTags),
      status: d.status,
      startDate,
      notes: d.notes || null,
    },
  };
}

export async function createClientAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const result = parseClientForm(formData);
  if (!result.success) return fail(result.error);

  await db.client.create({ data: result.data });
  revalidatePath("/klienci");
  return ok("Klient został dodany");
}

export async function updateClientAction(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const result = parseClientForm(formData);
  if (!result.success) return fail(result.error);

  const existing = await db.client.findUnique({ where: { id } });
  if (!existing) return fail("Klient nie istnieje");

  await db.client.update({ where: { id }, data: result.data });
  revalidatePath("/klienci");
  return ok("Zmiany zostały zapisane");
}

export async function deleteClientAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const counts = await db.client.findUnique({
    where: { id },
    include: {
      _count: { select: { invoices: true, costs: true, timeEntries: true } },
    },
  });
  if (!counts) return fail("Klient nie istnieje");
  const { invoices, costs, timeEntries } = counts._count;
  if (invoices + costs + timeEntries > 0) {
    return fail(
      "Nie można usunąć klienta z powiązanymi fakturami, kosztami lub wpisami czasu. Zmień status na „Zakończony”."
    );
  }
  await db.client.delete({ where: { id } });
  revalidatePath("/klienci");
  return ok("Klient został usunięty");
}
