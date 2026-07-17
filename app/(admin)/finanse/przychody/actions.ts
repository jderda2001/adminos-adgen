"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { dateFromInput, parseMoneyToGr } from "@/lib/format";
import { computeVatFromNet } from "@/lib/calc";
import { VAT_RATES, type VatRate } from "@/lib/types";

// ── Wejście formularza (rejestr przychodów — jedna kwota, bez pozycji) ──
// Program zastępuje arkusz przychodów: wpisujemy pojedynczą kwotę netto,
// nie „wystawiamy" faktury z pozycjami. Numer faktury jest opcjonalny.

export interface InvoiceFormInput {
  number: string; // opcjonalny nr faktury; "" = „bez fv"
  clientId: string;
  label: string; // opis pozycji, np. „Klient | SKD" (opcjonalny)
  net: string; // kwota netto w zł, np. „12 000,00"
  vatRate: string;
  saleDate: string; // „RRRR-MM-DD" — data przychodu (= issueDate)
  dueDate: string; // termin płatności
  offerTags: string; // tagi po przecinku
  notes: string;
  /** tylko przy tworzeniu: DRAFT | ISSUED | PAID */
  status?: string;
}

const invoiceSchema = z.object({
  number: z.string().trim().optional().default(""),
  clientId: z.string().trim().min(1, "Wybierz klienta"),
  label: z.string().trim().optional().default(""),
  net: z.string().trim().min(1, "Podaj kwotę netto"),
  vatRate: z.enum(VAT_RATES, { message: "Wybierz stawkę VAT" }),
  saleDate: z.string().trim().min(1, "Podaj datę przychodu"),
  dueDate: z.string().trim().min(1, "Podaj termin płatności"),
  offerTags: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  status: z
    .enum(["DRAFT", "NOT_ISSUED", "WAITING", "ISSUED", "NO_INVOICE", "PAID"], {
      message: "Wybierz status",
    })
    .optional(),
});

interface ParsedInvoice {
  number: string | null;
  clientId: string;
  label: string | null;
  netGr: number;
  vatGr: number;
  grossGr: number;
  vatRate: VatRate;
  saleDate: Date;
  dueDate: Date;
  offerTags: string | null;
  notes: string | null;
  status?: "DRAFT" | "NOT_ISSUED" | "WAITING" | "ISSUED" | "NO_INVOICE" | "PAID";
}

/** Tagi „a, b ,c" → „a,c" (trim, bez pustych, bez duplikatów) */
function normalizeTags(raw: string): string {
  const tags: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (t && !tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t);
  }
  return tags.join(",");
}

function parseInvoiceInput(
  input: InvoiceFormInput
): { success: false; error: string } | { success: true; data: ParsedInvoice } {
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza",
    };
  }
  const d = parsed.data;

  const netGr = parseMoneyToGr(d.net);
  if (netGr === null || netGr < 0) {
    return { success: false, error: "Podaj poprawną kwotę netto, np. 12 000,00" };
  }

  const saleDate = dateFromInput(d.saleDate);
  if (!saleDate) {
    return { success: false, error: "Podaj poprawną datę przychodu" };
  }
  const dueDate = dateFromInput(d.dueDate);
  if (!dueDate) {
    return { success: false, error: "Podaj poprawny termin płatności" };
  }

  // Jedna kwota — VAT i brutto z computeVatFromNet (bez pozycji faktury)
  const amounts = computeVatFromNet(netGr, d.vatRate);
  const number = d.number.trim();
  const label = d.label.trim();
  const offerTags = normalizeTags(d.offerTags);
  const notes = d.notes.trim();

  return {
    success: true,
    data: {
      number: number || null,
      clientId: d.clientId,
      label: label || null,
      netGr: amounts.netGr,
      vatGr: amounts.vatGr,
      grossGr: amounts.grossGr,
      vatRate: d.vatRate,
      saleDate,
      dueDate,
      offerTags: offerTags || null,
      notes: notes || null,
      status: d.status,
    },
  };
}

// ── Tworzenie i edycja ───────────────────────────────────────────────

export async function createInvoiceAction(
  input: InvoiceFormInput
): Promise<ActionResult> {
  await requireAdmin();
  const result = parseInvoiceInput(input);
  if (!result.success) return fail(result.error);
  const d = result.data;

  const client = await db.client.findUnique({ where: { id: d.clientId } });
  if (!client) return fail("Wybrany klient nie istnieje");

  // Numer opcjonalny; jeśli podany — musi być unikalny
  if (d.number) {
    const duplicate = await db.invoice.findUnique({ where: { number: d.number } });
    if (duplicate) {
      return fail(`Pozycja o numerze „${d.number}” już istnieje — podaj inny numer`);
    }
  }

  await db.invoice.create({
    data: {
      number: d.number,
      clientId: d.clientId,
      label: d.label,
      // Data przychodu jest jednocześnie datą wystawienia (rejestr, nie fakturowanie)
      issueDate: d.saleDate,
      saleDate: d.saleDate,
      dueDate: d.dueDate,
      status: d.status ?? "ISSUED",
      paidDate: d.status === "PAID" ? d.saleDate : null,
      netGr: d.netGr,
      vatGr: d.vatGr,
      grossGr: d.grossGr,
      offerTags: d.offerTags,
      notes: d.notes,
    },
  });

  revalidatePath("/finanse/przychody");
  return ok("Przychód został dodany");
}

export async function updateInvoiceAction(
  id: string,
  input: InvoiceFormInput
): Promise<ActionResult> {
  await requireAdmin();
  const result = parseInvoiceInput(input);
  if (!result.success) return fail(result.error);
  const d = result.data;

  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing) return fail("Pozycja nie istnieje");

  const client = await db.client.findUnique({ where: { id: d.clientId } });
  if (!client) return fail("Wybrany klient nie istnieje");

  if (d.number) {
    const duplicate = await db.invoice.findUnique({ where: { number: d.number } });
    if (duplicate && duplicate.id !== id) {
      return fail(`Pozycja o numerze „${d.number}” już istnieje — podaj inny numer`);
    }
  }

  // Rejestr trzyma pojedynczą kwotę zbiorczą — usuwamy ewentualne stare pozycje
  await db.$transaction([
    db.invoiceItem.deleteMany({ where: { invoiceId: id } }),
    db.invoice.update({
      where: { id },
      data: {
        number: d.number,
        clientId: d.clientId,
        label: d.label,
        issueDate: d.saleDate,
        saleDate: d.saleDate,
        dueDate: d.dueDate,
        netGr: d.netGr,
        vatGr: d.vatGr,
        grossGr: d.grossGr,
        offerTags: d.offerTags,
        notes: d.notes,
      },
    }),
  ]);

  revalidatePath("/finanse/przychody");
  return ok("Zmiany zostały zapisane");
}

// ── Zmiany statusu ───────────────────────────────────────────────────

export async function markInvoiceIssuedAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return fail("Pozycja nie istnieje");
  if (invoice.status !== "DRAFT") {
    return fail("Tylko pozycję bez FV można oznaczyć jako wysłaną");
  }

  await db.invoice.update({ where: { id }, data: { status: "ISSUED" } });
  revalidatePath("/finanse/przychody");
  return ok("Pozycja została oznaczona jako wysłana");
}

export async function markInvoicePaidAction(
  id: string,
  paidDateInput: string
): Promise<ActionResult> {
  await requireAdmin();
  const paidDate = dateFromInput(paidDateInput);
  if (!paidDate) return fail("Podaj poprawną datę zapłaty");

  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return fail("Pozycja nie istnieje");
  if (invoice.status === "PAID") {
    return fail("Pozycja jest już oznaczona jako opłacona");
  }

  // Bez FV → od razu opłacona: rejestr dopuszcza opłatę na dowolnym etapie
  await db.invoice.update({
    where: { id },
    data: { status: "PAID", paidDate },
  });
  revalidatePath("/finanse/przychody");
  return ok("Pozycja została oznaczona jako opłacona");
}

export async function undoInvoicePaymentAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return fail("Pozycja nie istnieje");
  if (invoice.status !== "PAID") {
    return fail("Tylko opłaconą pozycję można cofnąć do wysłanej");
  }

  // Po cofnięciu refreshInvoiceStatuses ustawi OVERDUE, jeśli termin już minął
  await db.invoice.update({
    where: { id },
    data: { status: "ISSUED", paidDate: null },
  });
  revalidatePath("/finanse/przychody");
  return ok("Zapłata została cofnięta");
}

// ── Usuwanie ─────────────────────────────────────────────────────────

export async function deleteInvoiceAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return fail("Pozycja nie istnieje");

  // Ewentualne pozycje usuwa kaskada (onDelete: Cascade w schemacie)
  await db.invoice.delete({ where: { id } });
  revalidatePath("/finanse/przychody");
  return ok("Pozycja została usunięta");
}
