"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { RW_MANUAL_METRICS, findRwCategory, type RwKind } from "@/lib/rw-types";

const RW_PATH = "/rachunek-wynikow";

export interface RwImportSummary {
  ok: true;
  batchId: string;
  kind: string;
  imported: number;
  months: number[];
}
export type RwImportResult = RwImportSummary | { ok: false; error: string };

/** Wiersz przeglądu przekazywany z klienta do zatwierdzenia (kategoria już wybrana) */
export interface RwReviewRow {
  month: number; // 1–12
  category: string; // kanoniczna kategoria (walidowana serwerowo)
  amountGr: number;
  description: string | null;
  contractor: string | null;
  bank: string | null;
  note: string | null;
}

/**
 * Zatwierdza zaimportowane operacje PO przeglądzie użytkownika. Parsowanie
 * i auto-przypisanie kategorii dzieje się u klienta, ale KAŻDE pole jest
 * tu walidowane serwerowo: miesiąc 1–12, kwota int, kategoria musi istnieć
 * w taksonomii dla danego rodzaju. Zapis w transakcji jako jedna partia.
 */
export async function commitRwReviewAction(input: {
  year: number;
  kind: string;
  filename: string;
  rows: RwReviewRow[];
}): Promise<RwImportResult> {
  await requireAdmin();

  const { year, kind, filename, rows } = input;
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, error: "Nieprawidłowy rok importu" };
  }
  if (kind !== "PRZYCHOD" && kind !== "KOSZT") {
    return { ok: false, error: "Nieprawidłowy rodzaj danych" };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "Brak operacji do zatwierdzenia" };
  }
  if (rows.length > 5000) {
    return { ok: false, error: "Zbyt wiele operacji naraz (limit 5000)" };
  }

  const clip = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t.slice(0, max);
  };

  const data: {
    year: number;
    month: number;
    kind: string;
    category: string;
    amountGr: number;
    description: string | null;
    contractor: string | null;
    bank: string | null;
    note: string | null;
    source: string;
    batchId: string;
  }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nr = i + 1;
    if (!Number.isInteger(r.month) || r.month < 1 || r.month > 12) {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowy miesiąc` };
    }
    if (!Number.isInteger(r.amountGr)) {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowa kwota` };
    }
    if (!findRwCategory(kind as RwKind, r.category)) {
      return {
        ok: false,
        error: `Operacja ${nr}: nieznana kategoria „${r.category}”`,
      };
    }
    data.push({
      year,
      month: r.month,
      kind,
      category: r.category,
      amountGr: r.amountGr,
      description: clip(r.description, 300),
      contractor: clip(r.contractor, 120),
      bank: clip(r.bank, 40),
      note: clip(r.note, 200),
      source: "IMPORT",
      batchId: "", // uzupełnione po utworzeniu partii
    });
  }

  const batch = await db.$transaction(async (tx) => {
    const created = await tx.rwImportBatch.create({
      data: {
        filename: (filename || "import.csv").slice(0, 200),
        kind,
        year,
        rowCount: data.length,
      },
    });
    await tx.rwEntry.createMany({
      data: data.map((d) => ({ ...d, batchId: created.id })),
    });
    return created;
  });

  revalidatePath(RW_PATH);
  return {
    ok: true,
    batchId: batch.id,
    kind,
    imported: data.length,
    months: [...new Set(data.map((d) => d.month))].sort((a, b) => a - b),
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
