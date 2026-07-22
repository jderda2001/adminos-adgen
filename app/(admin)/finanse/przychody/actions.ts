"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { dateFromInput, parseMoneyToGr, todayUTC } from "@/lib/format";
import { computeVatFromNet } from "@/lib/calc";
import { INVOICE_STATUSES, LEADS_OFFER_TAG, VAT_RATES, type VatRate } from "@/lib/types";
import { readAttachmentFromForm, removeAttachment, writeAttachment } from "@/lib/attachments";

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
  /** paczki leadów (PAKIETY LEADÓW): liczba leadów × cena — wyliczają netto */
  leadsQty?: string;
  leadUnitPrice?: string; // cena za lead NETTO w zł
  leadActivationFee?: string; // opłata aktywacyjna NETTO w zł (opcjonalna, dolicza się)
  leadGuaranteePct?: string; // % gwarancji — leady gratis PONAD zapłacone (bez wpływu na cenę)
  /** tylko przy tworzeniu: DRAFT | ISSUED | PAID */
  status?: string;
}

const invoiceSchema = z.object({
  number: z.string().trim().optional().default(""),
  clientId: z.string().trim().min(1, "Wybierz klienta"),
  label: z.string().trim().optional().default(""),
  net: z.string().trim().optional().default(""),
  vatRate: z.enum(VAT_RATES, { message: "Wybierz stawkę VAT" }),
  saleDate: z.string().trim().min(1, "Podaj datę przychodu"),
  dueDate: z.string().trim().min(1, "Podaj termin płatności"),
  offerTags: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  leadsQty: z.string().trim().optional().default(""),
  leadUnitPrice: z.string().trim().optional().default(""),
  leadActivationFee: z.string().trim().optional().default(""),
  leadGuaranteePct: z.string().trim().optional().default(""),
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
  leadsQty: number | null;
  leadUnitPriceGr: number | null;
  leadActivationFeeGr: number | null;
  leadGuaranteePct: number | null;
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
  const offerTags = normalizeTags(d.offerTags);

  // Paczki leadów: gdy oferta zawiera „PAKIETY LEADÓW" i podano oba pola,
  // netto = liczba leadów × cena jednostkowa (netto). Bez pól — netto wprost
  // (kwota z pola), co obsługuje też stare faktury bez rozbicia.
  const isLeads = offerTags
    .split(",")
    .some((t) => t.trim().toLowerCase() === LEADS_OFFER_TAG.toLowerCase());
  let leadsQty: number | null = null;
  let leadUnitPriceGr: number | null = null;
  let leadActivationFeeGr: number | null = null;
  let leadGuaranteePct: number | null = null;
  let netGr: number | null = null;

  const qtyRaw = (d.leadsQty ?? "").trim();
  const priceRaw = (d.leadUnitPrice ?? "").trim();
  if (isLeads && qtyRaw !== "" && priceRaw !== "") {
    const qty = Number(qtyRaw.replace(/\s/g, ""));
    if (!Number.isInteger(qty) || qty < 1) {
      return { success: false, error: "Liczba leadów musi być liczbą całkowitą (min. 1)" };
    }
    const priceGr = parseMoneyToGr(priceRaw);
    if (priceGr === null || priceGr < 0) {
      return { success: false, error: "Podaj poprawną cenę za lead, np. 50,00" };
    }
    // opłata aktywacyjna (opcjonalna) — dolicza się do netto paczki
    const feeRaw = (d.leadActivationFee ?? "").trim();
    if (feeRaw !== "") {
      const feeGr = parseMoneyToGr(feeRaw);
      if (feeGr === null || feeGr < 0) {
        return { success: false, error: "Podaj poprawną opłatę aktywacyjną, np. 1500,00" };
      }
      leadActivationFeeGr = feeGr;
    }
    // % gwarancji (opcjonalny) — dorzuca leady do KONTRAKTU, nie do ceny
    const pctRaw = (d.leadGuaranteePct ?? "").trim().replace("%", "");
    if (pctRaw !== "") {
      const pct = Number(pctRaw.replace(/\s/g, "").replace(",", "."));
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) {
        return {
          success: false,
          error: "Gwarancja musi być liczbą całkowitą 0–100 (%), np. 10 lub 20",
        };
      }
      leadGuaranteePct = pct > 0 ? pct : null;
    }
    leadsQty = qty;
    leadUnitPriceGr = priceGr;
    netGr = qty * priceGr + (leadActivationFeeGr ?? 0);
  } else {
    netGr = parseMoneyToGr(d.net);
  }

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
      leadsQty,
      leadUnitPriceGr,
      leadActivationFeeGr,
      leadGuaranteePct,
      status: d.status,
    },
  };
}

// ── Tworzenie i edycja ───────────────────────────────────────────────

export async function createInvoiceAction(
  input: InvoiceFormInput
): Promise<ActionResult & { id?: string }> {
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

  const created = await db.invoice.create({
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
      leadsQty: d.leadsQty,
      leadUnitPriceGr: d.leadUnitPriceGr,
      leadActivationFeeGr: d.leadActivationFeeGr,
      leadGuaranteePct: d.leadGuaranteePct,
      offerTags: d.offerTags,
      notes: d.notes,
    },
    select: { id: true },
  });

  revalidatePath("/finanse/przychody");
  return { ...ok("Przychód został dodany"), id: created.id };
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

  // status edytowalny również przy edycji (ścieżka wyjścia z „Czekamy"/„Nie
  // wystawiona"); paidDate spójny ze statusem
  const status = d.status ?? existing.status;
  const paidDate =
    status === "PAID" ? (existing.paidDate ?? d.saleDate) : null;

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
        status,
        paidDate,
        netGr: d.netGr,
        vatGr: d.vatGr,
        grossGr: d.grossGr,
        leadsQty: d.leadsQty,
        leadUnitPriceGr: d.leadUnitPriceGr,
        leadActivationFeeGr: d.leadActivationFeeGr,
        leadGuaranteePct: d.leadGuaranteePct,
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
  // Wpłata wstrzymuje sekwencję przypomnień: niewysłane kroki (QUEUED) → SKIPPED
  await db.invoiceReminder.updateMany({
    where: { invoiceId: id, status: "QUEUED" },
    data: { status: "SKIPPED", note: "opłacona — automatyzacja wstrzymana" },
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

// ── Załącznik faktury (plik dołączany do maili przypomnień) ──────────

export async function uploadInvoiceAttachmentAction(
  invoiceId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return fail("Pozycja nie istnieje");

  const read = await readAttachmentFromForm(formData, "attachment");
  if (!read.ok) return fail(read.error);
  if (!read.file) return fail("Nie wybrano pliku");

  const saved = await writeAttachment(invoiceId, read.file, invoice.attachmentPath);
  await db.invoice.update({
    where: { id: invoiceId },
    data: { attachmentPath: saved.attachmentPath, attachmentName: saved.attachmentName },
  });
  revalidatePath("/finanse/przychody");
  return ok("Faktura została wgrana");
}

export async function removeInvoiceAttachmentAction(invoiceId: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return fail("Pozycja nie istnieje");
  await removeAttachment(invoice.attachmentPath);
  await db.invoice.update({
    where: { id: invoiceId },
    data: { attachmentPath: null, attachmentName: null },
  });
  revalidatePath("/finanse/przychody");
  return ok("Załącznik usunięty");
}

// ── Usuwanie ─────────────────────────────────────────────────────────

export async function deleteInvoiceAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await db.invoice.findUnique({ where: { id } });
  if (!invoice) return fail("Pozycja nie istnieje");

  // usuń plik faktury z dysku, potem wpis (pozycje usuwa kaskada)
  await removeAttachment(invoice.attachmentPath);
  await db.invoice.delete({ where: { id } });
  revalidatePath("/finanse/przychody");
  return ok("Pozycja została usunięta");
}

// ── Akcje masowe (zaznaczone pozycje) ────────────────────────────────
// Belka akcji z listy przychodów operuje na tablicy ID pozycji. Pozycje
// „Estymacja" (syntetyczne id `est-…`) nie istnieją w bazie — UI ich nie
// zaznacza, a walidacja i tak zadziała po znalezionych realnych wpisach.

const idsSchema = z
  .array(z.string().trim().min(1))
  .min(1, "Nie zaznaczono żadnej pozycji")
  .max(500, "Zbyt wiele pozycji naraz (limit 500)");

/** Przesunięcie daty o N miesięcy (UTC), z docięciem dnia do końca miesiąca. */
function addMonthsUTC(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

export async function bulkDeleteInvoicesAction(ids: string[]): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Błędne dane");

  const invoices = await db.invoice.findMany({
    where: { id: { in: parsed.data } },
    select: { id: true, attachmentPath: true },
  });
  if (invoices.length === 0) return fail("Nie znaleziono pozycji do usunięcia");

  // pliki faktur z dysku; wpisy (pozycje/przypomnienia) usuwa kaskada
  for (const inv of invoices) await removeAttachment(inv.attachmentPath);
  const { count } = await db.invoice.deleteMany({
    where: { id: { in: invoices.map((i) => i.id) } },
  });

  revalidatePath("/finanse/przychody");
  return ok(`Usunięto ${count} ${pluralInvoices(count)}`);
}

export async function bulkSetInvoiceStatusAction(
  ids: string[],
  status: string
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Błędne dane");
  if (!(INVOICE_STATUSES as readonly string[]).includes(status)) {
    return fail("Nieznany status");
  }
  const where = { id: { in: parsed.data } };
  const now = todayUTC();

  if (status === "PAID") {
    // opłacona: uzupełnij datę zapłaty tam, gdzie jej brak; wstrzymaj przypomnienia
    await db.$transaction([
      db.invoice.updateMany({
        where: { ...where, paidDate: null },
        data: { paidDate: now },
      }),
      db.invoice.updateMany({ where, data: { status: "PAID" } }),
      db.invoiceReminder.updateMany({
        where: { invoiceId: { in: parsed.data }, status: "QUEUED" },
        data: { status: "SKIPPED", note: "opłacona — automatyzacja wstrzymana" },
      }),
    ]);
  } else {
    // każdy inny status = nieopłacona: wyczyść datę zapłaty
    await db.invoice.updateMany({ where, data: { status, paidDate: null } });
  }

  revalidatePath("/finanse/przychody");
  return ok(`Zmieniono status (${countLabel(parsed.data.length)})`);
}

export async function bulkSetInvoiceTagsAction(
  ids: string[],
  tags: string
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Błędne dane");
  const normalized = normalizeTags(tags ?? "");

  const { count } = await db.invoice.updateMany({
    where: { id: { in: parsed.data } },
    data: { offerTags: normalized || null },
  });

  revalidatePath("/finanse/przychody");
  return ok(
    normalized
      ? `Ustawiono tagi „${normalized}" (${countLabel(count)})`
      : `Wyczyszczono tagi (${countLabel(count)})`
  );
}

export async function bulkSetInvoiceAmountAction(
  ids: string[],
  net: string,
  vatRate: string
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Błędne dane");
  if (!(VAT_RATES as readonly string[]).includes(vatRate)) {
    return fail("Wybierz stawkę VAT");
  }
  const netGr = parseMoneyToGr(net);
  if (netGr === null || netGr < 0) {
    return fail("Podaj poprawną kwotę netto, np. 12 000,00");
  }
  const amounts = computeVatFromNet(netGr, vatRate as VatRate);

  // ustawienie kwoty wprost kasuje rozbicie paczek leadów (staje się nieaktualne)
  const { count } = await db.invoice.updateMany({
    where: { id: { in: parsed.data } },
    data: {
      netGr: amounts.netGr,
      vatGr: amounts.vatGr,
      grossGr: amounts.grossGr,
      leadsQty: null,
      leadUnitPriceGr: null,
      leadActivationFeeGr: null,
      leadGuaranteePct: null,
    },
  });

  revalidatePath("/finanse/przychody");
  return ok(`Ustawiono kwotę netto (${countLabel(count)})`);
}

export async function bulkDuplicateInvoicesAction(
  ids: string[],
  months: number
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = idsSchema.safeParse(ids);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Błędne dane");
  const n = Number.isInteger(months) ? months : 1;
  if (n < 1 || n > 12) return fail("Podaj liczbę miesięcy 1–12");

  const invoices = await db.invoice.findMany({ where: { id: { in: parsed.data } } });
  if (invoices.length === 0) return fail("Nie znaleziono pozycji do duplikowania");

  // Dla każdej pozycji tworzymy kopie na kolejne 1..N miesięcy. Kopie są świeże:
  // bez numeru FV (unikat), bez płatności/załącznika/przypomnień; status Wystawiona.
  const data = invoices.flatMap((inv) =>
    Array.from({ length: n }, (_, k) => {
      const shift = k + 1;
      const saleDate = addMonthsUTC(inv.saleDate, shift);
      return {
        number: null,
        clientId: inv.clientId,
        label: inv.label,
        issueDate: saleDate,
        saleDate,
        dueDate: addMonthsUTC(inv.dueDate, shift),
        status: "ISSUED",
        paidDate: null,
        netGr: inv.netGr,
        vatGr: inv.vatGr,
        grossGr: inv.grossGr,
        leadsQty: inv.leadsQty,
        leadUnitPriceGr: inv.leadUnitPriceGr,
        leadActivationFeeGr: inv.leadActivationFeeGr,
        leadGuaranteePct: inv.leadGuaranteePct,
        offerTags: inv.offerTags,
        notes: inv.notes,
      };
    })
  );
  const { count } = await db.invoice.createMany({ data });

  revalidatePath("/finanse/przychody");
  const label =
    n === 1 ? "na następny miesiąc" : `na kolejne ${n} miesiące`;
  return ok(`Zduplikowano ${count} ${pluralInvoices(count)} ${label}`);
}

// pomocnicze etykiety PL (odmiana „pozycja")
function pluralInvoices(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "pozycji";
  if (last > 1 && last < 5) return "pozycje";
  if (last === 1) return "pozycję";
  return "pozycji";
}
function countLabel(n: number): string {
  return `${n} ${pluralInvoices(n)}`;
}
