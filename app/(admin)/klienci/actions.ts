"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { parseMoneyToGr, dateFromInput } from "@/lib/format";
import {
  BILLING_MODELS,
  BILLING_TIMINGS,
  CLIENT_STATUSES,
  CONTRACT_TYPES,
  CONTRACT_TYPE_NOTICE_MONTHS,
  CONTRACT_TYPE_FIXED_MONTHS,
  type ContractType,
} from "@/lib/types";

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
  contractType: z.enum(CONTRACT_TYPES, { message: "Wybierz typ umowy" }),
  billingTiming: z.enum(BILLING_TIMINGS, { message: "Wybierz rozliczenie" }),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
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
  contractType: string;
  billingTiming: string;
  startDate: Date | null;
  endDate: Date | null;
  noticeMonths: number | null;
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
    contractType: formData.get("contractType"),
    billingTiming: formData.get("billingTiming"),
    startDate: formData.get("startDate") ?? "",
    endDate: formData.get("endDate") ?? "",
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

  let endDate: Date | null = null;
  if (d.endDate) {
    endDate = dateFromInput(d.endDate);
    if (!endDate) return { success: false, error: "Podaj poprawną datę zakończenia" };
  }
  // umowa terminowa (np. 3 msc bez przedłużenia): jeśli nie podano daty końca,
  // wyliczamy ją z daty startu — ostatni dzień N-tego miesiąca współpracy.
  const fixedMonths = CONTRACT_TYPE_FIXED_MONTHS[d.contractType as ContractType];
  if (fixedMonths && startDate && !endDate) {
    endDate = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + fixedMonths, 0)
    );
  }
  if (startDate && endDate && endDate < startDate) {
    return { success: false, error: "Data zakończenia nie może być przed datą startu" };
  }

  // okres wypowiedzenia wyprowadzony z typu umowy (spójne z Estymacjami)
  const noticeMonths = CONTRACT_TYPE_NOTICE_MONTHS[d.contractType as ContractType];

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
      contractType: d.contractType,
      billingTiming: d.billingTiming,
      startDate,
      endDate,
      noticeMonths,
      notes: d.notes || null,
    },
  };
}

/**
 * „Złożył wypowiedzenie" — ustawia datę zakończenia współpracy na podstawie
 * daty wypowiedzenia i okresu wypowiedzenia (z typu umowy). Rozliczamy z góry,
 * więc np. wypowiedzenie 29.06 (1-mies.) → ostatni miesiąc świadczenia/faktury
 * = lipiec → endDate = 31.07. Pusta data czyści wypowiedzenie (przywraca bieg).
 */
export async function setNoticeGivenAction(
  id: string,
  dateInput: string
): Promise<ActionResult> {
  await requireAdmin();
  const client = await db.client.findUnique({ where: { id } });
  if (!client) return fail("Klient nie istnieje");

  if (!dateInput.trim()) {
    await db.client.update({
      where: { id },
      data: { noticeGivenDate: null, endDate: null },
    });
    revalidatePath("/klienci");
    revalidatePath("/estymacje");
    return ok("Cofnięto wypowiedzenie");
  }

  const notice = dateFromInput(dateInput);
  if (!notice) return fail("Podaj poprawną datę wypowiedzenia");
  const noticeMonths =
    client.noticeMonths ?? CONTRACT_TYPE_NOTICE_MONTHS[client.contractType as ContractType] ?? 0;
  // ostatni miesiąc = miesiąc wypowiedzenia + okres wypowiedzenia; endDate = jego ostatni dzień
  const y = notice.getUTCFullYear();
  const m = notice.getUTCMonth() + noticeMonths;
  const endDate = new Date(Date.UTC(y, m + 1, 0)); // dzień 0 następnego = ostatni dzień docelowego

  await db.client.update({
    where: { id },
    data: { noticeGivenDate: notice, endDate },
  });
  revalidatePath("/klienci");
  revalidatePath("/estymacje");
  return ok("Zapisano wypowiedzenie — ustawiono datę zakończenia");
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
