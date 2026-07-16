"use server";

import { revalidatePath } from "next/cache";
import path from "path";
import { mkdir, unlink, writeFile } from "fs/promises";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { computeVatFromNet } from "@/lib/calc";
import { isValidNrb, normalizeAccount } from "@/lib/elixir";
import { dateFromInput, parseMoneyToGr, todayUTC } from "@/lib/format";
import { monthKey } from "@/lib/periods";
import { isVatRate, type VatRate } from "@/lib/types";
import { findRwCategory, activeCategoryName } from "@/lib/rw-types";

const KOSZTY_PATH = "/finanse/koszty";
const RW_PATH = "/rachunek-wynikow";
const ESTYMACJE_PATH = "/estymacje";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"] as const;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Parsowanie formularza kosztu ─────────────────────────────────────

const costSchema = z.object({
  supplierName: z.string().trim().min(1, "Podaj nazwę dostawcy"),
  supplierAccount: z.string().trim().optional(),
  docNumber: z.string().trim().min(1, "Podaj numer dokumentu"),
  docDate: z.string().trim().min(1, "Podaj datę dokumentu"),
  dueDate: z.string().trim().optional(),
  net: z.string().trim().min(1, "Podaj kwotę netto"),
  vatRate: z.string().trim().min(1, "Wybierz stawkę VAT"),
  categoryId: z.string().trim().min(1, "Wybierz kategorię"),
  assignment: z.string().trim().min(1, "Wybierz przypisanie kosztu"),
  paid: z.string().optional(),
  paidDate: z.string().trim().optional(),
  note: z.string().trim().optional(),
  isRecurring: z.string().optional(),
  dueDayOfMonth: z.string().trim().optional(),
});

interface CostData {
  supplierName: string;
  supplierAccount: string | null;
  docNumber: string;
  docDate: Date;
  dueDate: Date | null;
  netGr: number;
  vatRate: VatRate;
  vatGr: number;
  grossGr: number;
  categoryId: string;
  clientId: string | null;
  paid: boolean;
  paidDate: Date | null;
  note: string | null;
  isRecurring: boolean;
  dueDayOfMonth: number;
}

function parseCostForm(
  formData: FormData
): { success: false; error: string } | { success: true; data: CostData } {
  const parsed = costSchema.safeParse({
    supplierName: formData.get("supplierName"),
    supplierAccount: formData.get("supplierAccount") ?? "",
    docNumber: formData.get("docNumber"),
    docDate: formData.get("docDate"),
    dueDate: formData.get("dueDate") ?? "",
    net: formData.get("net"),
    vatRate: formData.get("vatRate"),
    categoryId: formData.get("categoryId"),
    assignment: formData.get("assignment"),
    paid: formData.get("paid") ?? "",
    paidDate: formData.get("paidDate") ?? "",
    note: formData.get("note") ?? "",
    isRecurring: formData.get("isRecurring") ?? "",
    dueDayOfMonth: formData.get("dueDayOfMonth") ?? "",
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza",
    };
  }
  const d = parsed.data;

  let supplierAccount: string | null = null;
  if (d.supplierAccount) {
    if (!isValidNrb(d.supplierAccount)) {
      return { success: false, error: "Numer rachunku musi mieć 26 cyfr" };
    }
    supplierAccount = normalizeAccount(d.supplierAccount);
  }

  const docDate = dateFromInput(d.docDate);
  if (!docDate) return { success: false, error: "Podaj poprawną datę dokumentu" };

  let dueDate: Date | null = null;
  if (d.dueDate) {
    dueDate = dateFromInput(d.dueDate);
    if (!dueDate) return { success: false, error: "Podaj poprawny termin płatności" };
  }

  const netGr = parseMoneyToGr(d.net);
  if (netGr === null) {
    return { success: false, error: "Podaj poprawną kwotę netto, np. 1 234,56" };
  }

  if (!isVatRate(d.vatRate)) {
    return { success: false, error: "Wybierz stawkę VAT" };
  }
  const { vatGr, grossGr } = computeVatFromNet(netGr, d.vatRate);

  const clientId = d.assignment === "OGOLNY" ? null : d.assignment;

  const paid = d.paid === "1";
  let paidDate: Date | null = null;
  if (paid) {
    if (d.paidDate) {
      paidDate = dateFromInput(d.paidDate);
      if (!paidDate) return { success: false, error: "Podaj poprawną datę zapłaty" };
    } else {
      paidDate = todayUTC();
    }
  }

  const isRecurring = d.isRecurring === "1";
  let dueDayOfMonth = 10;
  if (isRecurring) {
    const day = Number(d.dueDayOfMonth);
    if (!Number.isInteger(day) || day < 1 || day > 28) {
      return {
        success: false,
        error: "Dzień miesiąca jako termin płatności musi być liczbą od 1 do 28",
      };
    }
    dueDayOfMonth = day;
  }

  return {
    success: true,
    data: {
      supplierName: d.supplierName,
      supplierAccount,
      docNumber: d.docNumber,
      docDate,
      dueDate,
      netGr,
      vatRate: d.vatRate,
      vatGr,
      grossGr,
      categoryId: d.categoryId,
      clientId,
      paid,
      paidDate,
      note: d.note || null,
      isRecurring,
      dueDayOfMonth,
    },
  };
}

// ── Załączniki ───────────────────────────────────────────────────────

interface AttachmentFile {
  ext: string;
  name: string;
  bytes: Buffer;
}

async function readAttachment(
  formData: FormData
): Promise<
  { success: false; error: string } | { success: true; file: AttachmentFile | null }
> {
  const file = formData.get("attachment");
  if (!(file instanceof File) || file.size === 0 || !file.name) {
    return { success: true, file: null };
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return {
      success: false,
      error: "Niedozwolony typ załącznika — dozwolone: PDF, JPG, JPEG, PNG, WEBP",
    };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { success: false, error: "Załącznik może mieć maksymalnie 10 MB" };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return { success: true, file: { ext, name: file.name, bytes } };
}

async function removeAttachmentFile(attachmentPath: string | null): Promise<void> {
  if (!attachmentPath) return;
  await unlink(path.join(UPLOADS_DIR, path.basename(attachmentPath))).catch(
    () => {}
  );
}

/** Zapisuje plik w uploads/ pod nazwą <costId>.<ext> i aktualizuje wpis w bazie */
async function saveAttachment(
  costId: string,
  file: AttachmentFile,
  previousPath: string | null
): Promise<void> {
  const fileName = `${costId}.${file.ext}`;
  if (previousPath && previousPath !== fileName) {
    await removeAttachmentFile(previousPath);
  }
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, fileName), file.bytes);
  await db.cost.update({
    where: { id: costId },
    data: { attachmentPath: fileName, attachmentName: file.name },
  });
}

// ── Walidacja odwołań ────────────────────────────────────────────────

async function validateReferences(
  categoryId: string,
  clientId: string | null
): Promise<string | null> {
  const category = await db.costCategory.findUnique({ where: { id: categoryId } });
  if (!category) return "Wybrana kategoria nie istnieje";
  if (clientId) {
    const client = await db.client.findUnique({ where: { id: clientId } });
    if (!client) return "Wybrany klient nie istnieje";
  }
  return null;
}

// ── Akcje: koszty ────────────────────────────────────────────────────

export async function createCostAction(
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const result = parseCostForm(formData);
  if (!result.success) return fail(result.error);
  const d = result.data;

  const attachment = await readAttachment(formData);
  if (!attachment.success) return fail(attachment.error);

  const refError = await validateReferences(d.categoryId, d.clientId);
  if (refError) return fail(refError);

  // Szablon cykliczny: baza numeru dokumentu z placeholderem {MM/RRRR}
  let recurringCostId: string | null = null;
  if (d.isRecurring) {
    const mm = String(d.docDate.getUTCMonth() + 1).padStart(2, "0");
    const yyyy = d.docDate.getUTCFullYear();
    const docNumberBase = d.docNumber
      .split(`${mm}/${yyyy}`)
      .join("{MM/RRRR}");
    const template = await db.recurringCost.create({
      data: {
        supplierName: d.supplierName,
        supplierAccount: d.supplierAccount,
        docNumber: docNumberBase,
        netGr: d.netGr,
        vatRate: d.vatRate,
        categoryId: d.categoryId,
        clientId: d.clientId,
        dueDayOfMonth: d.dueDayOfMonth,
        note: d.note,
        // miesiąc dokumentu, nie dzisiejszy: koszt z poprzedniego miesiąca
        // oznaczony jako cykliczny ma dostać kopię już za bieżący miesiąc
        lastGeneratedPeriod: monthKey(d.docDate),
      },
    });
    recurringCostId = template.id;
  }

  const cost = await db.cost.create({
    data: {
      supplierName: d.supplierName,
      supplierAccount: d.supplierAccount,
      docNumber: d.docNumber,
      docDate: d.docDate,
      dueDate: d.dueDate,
      netGr: d.netGr,
      vatRate: d.vatRate,
      vatGr: d.vatGr,
      grossGr: d.grossGr,
      categoryId: d.categoryId,
      clientId: d.clientId,
      paid: d.paid,
      paidDate: d.paidDate,
      note: d.note,
      recurringCostId,
    },
  });

  if (attachment.file) {
    await saveAttachment(cost.id, attachment.file, null);
  }

  revalidatePath(KOSZTY_PATH);
  return ok(
    d.isRecurring
      ? "Koszt został dodany wraz z szablonem cyklicznym"
      : "Koszt został dodany"
  );
}

export async function updateCostAction(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const result = parseCostForm(formData);
  if (!result.success) return fail(result.error);
  const d = result.data;

  const existing = await db.cost.findUnique({ where: { id } });
  if (!existing) return fail("Koszt nie istnieje");

  const attachment = await readAttachment(formData);
  if (!attachment.success) return fail(attachment.error);

  const refError = await validateReferences(d.categoryId, d.clientId);
  if (refError) return fail(refError);

  await db.cost.update({
    where: { id },
    data: {
      supplierName: d.supplierName,
      supplierAccount: d.supplierAccount,
      docNumber: d.docNumber,
      docDate: d.docDate,
      dueDate: d.dueDate,
      netGr: d.netGr,
      vatRate: d.vatRate,
      vatGr: d.vatGr,
      grossGr: d.grossGr,
      categoryId: d.categoryId,
      clientId: d.clientId,
      paid: d.paid,
      paidDate: d.paidDate,
      note: d.note,
    },
  });

  if (attachment.file) {
    await saveAttachment(id, attachment.file, existing.attachmentPath);
  }

  revalidatePath(KOSZTY_PATH);
  return ok("Zmiany zostały zapisane");
}

export async function deleteCostAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await db.cost.findUnique({ where: { id } });
  if (!existing) return fail("Koszt nie istnieje");

  await db.cost.delete({ where: { id } });
  await removeAttachmentFile(existing.attachmentPath);

  revalidatePath(KOSZTY_PATH);
  return ok("Koszt został usunięty");
}

export async function togglePaidAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await db.cost.findUnique({ where: { id } });
  if (!existing) return fail("Koszt nie istnieje");

  const paid = !existing.paid;
  await db.cost.update({
    where: { id },
    data: { paid, paidDate: paid ? todayUTC() : null },
  });

  revalidatePath(KOSZTY_PATH);
  return ok(
    paid ? "Koszt oznaczony jako zapłacony" : "Cofnięto oznaczenie zapłaty"
  );
}

/** Przełącz akceptację do płatności ("Brak działań" ↔ "Można płacić") */
export async function toggleApprovalAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await db.cost.findUnique({ where: { id } });
  if (!existing) return fail("Koszt nie istnieje");
  if (existing.paid) return fail("Koszt jest już opłacony");

  const approvedForPayment = !existing.approvedForPayment;
  await db.cost.update({ where: { id }, data: { approvedForPayment } });

  revalidatePath(KOSZTY_PATH);
  revalidatePath("/platnosci");
  return ok(
    approvedForPayment
      ? "Oznaczono: można płacić"
      : "Cofnięto do „Brak działań”"
  );
}

// ── Akcje: potwierdzanie kopii cyklicznych ───────────────────────────

export async function confirmCostAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await db.cost.findUnique({ where: { id } });
  if (!existing) return fail("Koszt nie istnieje");
  if (!existing.needsConfirmation) return fail("Ten koszt jest już zatwierdzony");

  await db.cost.update({ where: { id }, data: { needsConfirmation: false } });
  revalidatePath(KOSZTY_PATH);
  return ok("Koszt został zatwierdzony");
}

export async function rejectCostAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  const existing = await db.cost.findUnique({ where: { id } });
  if (!existing) return fail("Koszt nie istnieje");
  if (!existing.needsConfirmation) {
    return fail("Można odrzucać tylko koszty oczekujące na zatwierdzenie");
  }

  await db.cost.delete({ where: { id } });
  await removeAttachmentFile(existing.attachmentPath);
  revalidatePath(KOSZTY_PATH);
  return ok("Kopia kosztu została odrzucona");
}

export async function confirmAllCostsAction(): Promise<ActionResult> {
  await requireAdmin();
  const updated = await db.cost.updateMany({
    where: { needsConfirmation: true },
    data: { needsConfirmation: false },
  });
  revalidatePath(KOSZTY_PATH);
  if (updated.count === 0) return fail("Brak kosztów do zatwierdzenia");
  return ok(
    updated.count === 1
      ? "Zatwierdzono 1 koszt"
      : `Zatwierdzono koszty: ${updated.count}`
  );
}

// ── Akcje: szablony kosztów cyklicznych ──────────────────────────────

const recurringSchema = z.object({
  net: z.string().trim().min(1, "Podaj kwotę netto"),
  dueDayOfMonth: z.string().trim().min(1, "Podaj dzień miesiąca"),
});

export async function updateRecurringCostAction(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = recurringSchema.safeParse({
    net: formData.get("net"),
    dueDayOfMonth: formData.get("dueDayOfMonth"),
  });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza"
    );
  }

  const netGr = parseMoneyToGr(parsed.data.net);
  if (netGr === null) {
    return fail("Podaj poprawną kwotę netto, np. 1 234,56");
  }
  const day = Number(parsed.data.dueDayOfMonth);
  if (!Number.isInteger(day) || day < 1 || day > 28) {
    return fail("Dzień miesiąca jako termin płatności musi być liczbą od 1 do 28");
  }

  // koniec generowania (raty/leasingi): "RRRR-MM" albo puste = bez końca
  const endRaw = String(formData.get("endPeriod") ?? "").trim();
  let endPeriod: string | null = null;
  if (endRaw) {
    if (!/^\d{4}-\d{2}$/.test(endRaw)) return fail("Nieprawidłowy miesiąc końca");
    endPeriod = endRaw;
  }

  const existing = await db.recurringCost.findUnique({ where: { id } });
  if (!existing) return fail("Szablon nie istnieje");

  await db.recurringCost.update({
    where: { id },
    data: { netGr, dueDayOfMonth: day, endPeriod },
  });
  revalidatePath(KOSZTY_PATH);
  return ok("Szablon został zaktualizowany");
}

export async function toggleRecurringActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult> {
  await requireAdmin();
  const existing = await db.recurringCost.findUnique({ where: { id } });
  if (!existing) return fail("Szablon nie istnieje");

  await db.recurringCost.update({ where: { id }, data: { active } });
  revalidatePath(KOSZTY_PATH);
  return ok(
    active
      ? "Szablon aktywny — kopie będą generowane co miesiąc"
      : "Szablon wyłączony — generowanie zatrzymane"
  );
}

export async function deleteRecurringCostAction(
  id: string
): Promise<ActionResult> {
  await requireAdmin();
  const existing = await db.recurringCost.findUnique({ where: { id } });
  if (!existing) return fail("Szablon nie istnieje");

  // powiązane koszty zostają (recurringCostId → null przez onDelete: SetNull)
  await db.recurringCost.delete({ where: { id } });
  revalidatePath(KOSZTY_PATH);
  return ok("Szablon został usunięty");
}

// ── Import CSV kosztów (backfill historyczny) ────────────────────────
// Każdy wiersz tworzy dokument Cost (rejestr operacyjny) ORAZ wpis RwEntry
// (rok/miesiąc z daty) — dane widoczne i w Kosztach (Dashboard/Rentowność),
// i w Rachunku wyników + Estymacjach. Kategoria z przeglądu to kategoria RW;
// CostCategory tworzymy/dobieramy po tej samej nazwie (upsert), co ujednolica
// taksonomię. Koszty historyczne oznaczamy jako opłacone.

export interface CostImportRow {
  dateISO: string; // "RRRR-MM-DD"
  year: number;
  month: number; // 1–12
  supplier: string;
  category: string; // kategoria RW wybrana w przeglądzie
  netGr: number; // dodatnie
  vatRate: string; // 23 | 8 | 5 | 0 | ZW
}

export type CostImportResult =
  | { ok: true; imported: number; years: number[] }
  | { ok: false; error: string };

const FALLBACK_COST_CATEGORY = "Pozostałe wydatki operacyjne";

export async function commitCostImportAction(input: {
  filename: string;
  rows: CostImportRow[];
}): Promise<CostImportResult> {
  await requireAdmin();
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (rows.length === 0) return { ok: false, error: "Brak wierszy do zaimportowania" };
  if (rows.length > 5000) return { ok: false, error: "Zbyt wiele wierszy naraz (limit 5000)" };

  interface Prepared {
    year: number;
    month: number;
    dateISO: string;
    supplier: string;
    rwCategory: string;
    netGr: number;
    vatRate: VatRate;
    vatGr: number;
    grossGr: number;
  }
  const prepared: Prepared[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nr = i + 1;
    if (!Number.isInteger(r.year) || r.year < 2020 || r.year > 2100) {
      return { ok: false, error: `Wiersz ${nr}: nieprawidłowy rok` };
    }
    if (!Number.isInteger(r.month) || r.month < 1 || r.month > 12) {
      return { ok: false, error: `Wiersz ${nr}: nieprawidłowy miesiąc` };
    }
    if (!Number.isInteger(r.netGr) || r.netGr <= 0) {
      return { ok: false, error: `Wiersz ${nr}: nieprawidłowa kwota` };
    }
    const vatRate: VatRate = isVatRate(r.vatRate) ? (r.vatRate as VatRate) : "0";
    // kategoria RW: zmapuj zdeprecjonowaną → aktywną; nieznaną → fallback operacyjny
    const active = activeCategoryName("KOSZT", (r.category ?? "").trim());
    const rwCategory = findRwCategory("KOSZT", active) ? active : FALLBACK_COST_CATEGORY;
    const { vatGr, grossGr } = computeVatFromNet(r.netGr, vatRate);
    prepared.push({
      year: r.year,
      month: r.month,
      dateISO: r.dateISO,
      supplier: (r.supplier || "—").slice(0, 200),
      rwCategory,
      netGr: r.netGr,
      vatRate,
      vatGr,
      grossGr,
    });
  }

  // upsert kategorii kosztowych po nazwie (ujednolicenie z taksonomią RW)
  const catNames = [...new Set(prepared.map((p) => p.rwCategory))];
  const catId = new Map<string, string>();
  const maxPos = (await db.costCategory.aggregate({ _max: { position: true } }))._max.position ?? 0;
  let pos = maxPos;
  for (const name of catNames) {
    const cat = await db.costCategory.upsert({
      where: { name },
      update: {},
      create: { name, position: ++pos, isSalary: name.startsWith("Wypłaty") },
    });
    catId.set(name, cat.id);
  }

  // rok partii = dominujący wśród wierszy
  const yearCounts = new Map<number, number>();
  for (const p of prepared) yearCounts.set(p.year, (yearCounts.get(p.year) ?? 0) + 1);
  const batchYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

  await db.$transaction(async (tx) => {
    const batch = await tx.rwImportBatch.create({
      data: {
        filename: (input.filename || "koszty.csv").slice(0, 200),
        kind: "KOSZT",
        year: batchYear,
        rowCount: prepared.length,
      },
    });
    await tx.rwEntry.createMany({
      data: prepared.map((p) => ({
        year: p.year,
        month: p.month,
        kind: "KOSZT",
        category: p.rwCategory,
        amountGr: -p.netGr,
        grossGr: -p.grossGr,
        vatRate: p.vatRate === "ZW" ? 0 : parseInt(p.vatRate, 10),
        description: p.supplier,
        bank: null,
        note: `import kosztów ${p.dateISO}`,
        source: "IMPORT",
        batchId: batch.id,
      })),
    });
    await tx.cost.createMany({
      data: prepared.map((p) => {
        const [y, m, d] = p.dateISO.split("-").map(Number);
        const docDate = new Date(Date.UTC(y, m - 1, d));
        return {
          supplierName: p.supplier,
          docNumber: "",
          docDate,
          dueDate: docDate,
          netGr: p.netGr,
          vatRate: p.vatRate,
          vatGr: p.vatGr,
          grossGr: p.grossGr,
          categoryId: catId.get(p.rwCategory) as string,
          clientId: null,
          paid: true,
          paidDate: docDate,
          approvedForPayment: true,
          needsConfirmation: false,
          note: "import CSV",
        };
      }),
    });
  });

  revalidatePath(KOSZTY_PATH);
  revalidatePath(RW_PATH);
  revalidatePath(ESTYMACJE_PATH);
  const years = [...new Set(prepared.map((p) => p.year))].sort((a, b) => a - b);
  return { ok: true, imported: prepared.length, years };
}
