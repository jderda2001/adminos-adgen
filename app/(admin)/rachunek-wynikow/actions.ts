"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { parseRwCsv } from "@/lib/rw-parse";
import { RW_MANUAL_METRICS } from "@/lib/rw-types";

const RW_PATH = "/rachunek-wynikow";
const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB

export interface RwImportSummary {
  ok: true;
  batchId: string;
  kind: string;
  imported: number;
  warnings: number;
  months: number[];
}
export type RwImportResult = RwImportSummary | { ok: false; error: string };

/**
 * Import CSV rachunku wyników (przychody lub koszty — format wykrywany
 * z nagłówka). Plik jest parsowany SERWEROWO (podgląd u klienta jest tylko
 * informacyjny). Import odrzucany w całości, jeśli jakikolwiek wiersz ma błąd —
 * częściowe importy utrudniałyby uzgadnianie z arkuszem.
 */
export async function importRwCsvAction(
  formData: FormData
): Promise<RwImportResult> {
  await requireAdmin();

  const yearRaw = formData.get("year");
  const year = typeof yearRaw === "string" ? parseInt(yearRaw, 10) : NaN;
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, error: "Nieprawidłowy rok importu" };
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return { ok: false, error: "Nie przekazano pliku" };
  }
  if (file.size === 0) return { ok: false, error: "Plik jest pusty" };
  if (file.size > MAX_CSV_BYTES) {
    return { ok: false, error: "Plik jest za duży (limit 5 MB)" };
  }

  const text = await file.text();
  const parsed = parseRwCsv(text);
  if ("formatError" in parsed) return { ok: false, error: parsed.formatError };
  if (parsed.errors.length > 0) {
    const first = parsed.errors
      .slice(0, 5)
      .map((e) => `linia ${e.line}: ${e.message}`)
      .join("; ");
    return {
      ok: false,
      error: `Plik zawiera ${parsed.errors.length} błędnych wierszy — import odrzucony w całości. Pierwsze błędy: ${first}`,
    };
  }
  if (parsed.entries.length === 0) {
    return { ok: false, error: "Plik nie zawiera żadnych wierszy z danymi" };
  }

  const batch = await db.$transaction(async (tx) => {
    const created = await tx.rwImportBatch.create({
      data: {
        filename: file.name.slice(0, 200),
        kind: parsed.kind,
        year,
        rowCount: parsed.entries.length,
      },
    });
    await tx.rwEntry.createMany({
      data: parsed.entries.map((e) => ({
        year,
        month: e.month,
        kind: e.kind,
        category: e.category,
        amountGr: e.amountGr,
        description: e.description,
        contractor: e.contractor,
        bank: e.bank,
        note: e.note,
        source: "IMPORT",
        batchId: created.id,
      })),
    });
    return created;
  });

  revalidatePath(RW_PATH);
  return {
    ok: true,
    batchId: batch.id,
    kind: parsed.kind,
    imported: parsed.entries.length,
    warnings: parsed.warnings.length,
    months: [...new Set(parsed.entries.map((e) => e.month))].sort((a, b) => a - b),
  };
}

/** Cofa import — usuwa partię wraz ze wszystkimi jej wpisami */
export async function deleteRwBatchAction(batchId: string): Promise<ActionResult> {
  await requireAdmin();
  const batch = await db.rwImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return fail("Import nie istnieje");

  await db.$transaction([
    db.rwEntry.deleteMany({ where: { batchId } }),
    db.rwImportBatch.delete({ where: { id: batchId } }),
  ]);
  revalidatePath(RW_PATH);
  return ok(`Cofnięto import „${batch.filename}” (${batch.rowCount} wierszy)`);
}

const manualMetricSchema = z.object({
  year: z.number().int().min(2020).max(2100),
  month: z.number().int().min(1).max(12),
  key: z.string(),
  value: z.string().trim().max(100),
});

const MANUAL_KEYS = new Set<string>(RW_MANUAL_METRICS.map((m) => m.key));
// metryki liczbowo-tekstowe (np. "2,19 ETH") trzymamy też jako tekst
const TEXT_KEYS = new Set<string>(["eth_saved", "ltv", "churn_kwartalny"]);

/**
 * Zapis metryki ręcznej (estymacja zysku, nowi klienci, windykacja…).
 * Pusta wartość usuwa metrykę. Wartości liczbowe akceptują przecinek.
 */
export async function setRwManualMetricAction(
  year: number,
  month: number,
  key: string,
  value: string
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = manualMetricSchema.safeParse({ year, month, key, value });
  if (!parsed.success) return fail("Nieprawidłowe dane metryki");
  if (!MANUAL_KEYS.has(key)) return fail(`Nieznana metryka: ${key}`);

  const trimmed = parsed.data.value;
  if (trimmed === "") {
    await db.rwManualMetric.deleteMany({ where: { year, month, key } });
    revalidatePath(RW_PATH);
    return ok("Usunięto wartość");
  }

  // walidacja CAŁEGO ciągu (parseFloat parsowałby sam prefiks: "123abc" → 123)
  const cleaned = trimmed.replace(/[\s  ]/g, "").replace(",", ".");
  const isFullNumber = /^-?\d+(\.\d+)?$/.test(cleaned);

  let valueNum: number | null = null;
  let valueText: string | null = null;
  if (TEXT_KEYS.has(key)) {
    valueText = trimmed;
    if (isFullNumber) valueNum = parseFloat(cleaned);
  } else {
    if (!isFullNumber) {
      return fail("Podaj wartość liczbową, np. 12 000 albo 12000,50");
    }
    valueNum = parseFloat(cleaned);
  }

  await db.rwManualMetric.upsert({
    where: { year_month_key: { year, month, key } },
    create: { year, month, key, valueNum, valueText },
    update: { valueNum, valueText },
  });
  revalidatePath(RW_PATH);
  return ok("Zapisano");
}
