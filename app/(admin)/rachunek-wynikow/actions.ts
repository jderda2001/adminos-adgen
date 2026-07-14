"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { RW_MANUAL_METRICS, findRwCategory, type RwKind } from "@/lib/rw-types";
import { aiCategorize, isAiEnabled, type AiRowInput } from "@/lib/rw-ai";
import { netFromGrossGr, coerceVatRate, vatMatchKey } from "@/lib/rw-vat";
import type { Prisma } from "@prisma/client";

const RW_PATH = "/rachunek-wynikow";

/**
 * Zapamiętuje referencje VAT per kontrahent (RwVatRule) — po zatwierdzeniu
 * importu i edycji. Agreguje po kluczu (ostatnia stawka wygrywa), zapisuje
 * tylko wiersze z sensownym kluczem. Dzięki temu kolejny import podpowie stawkę.
 */
async function learnVatRules(
  tx: Prisma.TransactionClient,
  rows: { vatKey: string | null; vatRate: number; label: string | null }[]
): Promise<void> {
  const byKey = new Map<string, { vatRate: number; label: string | null; hits: number }>();
  for (const r of rows) {
    const key = (r.vatKey ?? "").trim();
    if (!key) continue;
    const prev = byKey.get(key);
    byKey.set(key, {
      vatRate: coerceVatRate(r.vatRate),
      label: (r.label ?? prev?.label ?? null),
      hits: (prev?.hits ?? 0) + 1,
    });
  }
  for (const [matchKey, v] of byKey) {
    await tx.rwVatRule.upsert({
      where: { matchKey },
      update: {
        vatRate: v.vatRate,
        label: v.label ?? undefined,
        hitCount: { increment: v.hits },
      },
      create: { matchKey, vatRate: v.vatRate, label: v.label, hitCount: v.hits },
    });
  }
}

export interface RwImportSummary {
  ok: true;
  batchId: string;
  kind: string;
  imported: number;
  months: number[];
  /** lata, do których trafiły operacje (wyciąg może być za poprzedni rok) */
  years: number[];
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
    grossGr: number;
    vatRate: number;
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
      grossGr: r.amountGr, // arkusz jest już netto — brutto = netto
      vatRate: 0,
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
    years: [year],
  };
}

/** Wiersz przeglądu z importu wyciągu bankowego (kwota BRUTTO z wyciągu + stawka VAT) */
export interface RwBankReviewRow {
  kind: string; // PRZYCHOD | KOSZT
  month: number; // 1–12
  category: string; // kanoniczna kategoria
  grossGr: number; // kwota BRUTTO ze znakiem (z wyciągu lub ręczny podział)
  vatRate: number; // stawka VAT w % (23|8|5|0) — netto liczone serwerowo
  description: string | null;
  account: string | null; // nr konta kontrahenta (do klucza reguły VAT)
  note: string | null;
  dateISO: string | null;
}

/**
 * Zatwierdza operacje z wyciągu bankowego (mBank) PO przeglądzie. Wyciąg może
 * pochodzić z WIELU plików/kont — kind jest per-wiersz, a partia zapamiętuje
 * listę kont (kontrola kompletności następnych importów). Kwota przychodzi
 * z klienta (wprost z wyciągu albo z ręcznego podziału na kategorie); serwer
 * waliduje typ, znak (przychód +, koszt −) i kategorię. Jedna partia (BANK).
 */
export async function commitRwBankReviewAction(input: {
  year: number;
  filename: string;
  rows: RwBankReviewRow[];
  /** konta z preambuł wyciągów: [{name, number}] — zapamiętywane w partii */
  accounts?: { name: string; number: string }[];
}): Promise<RwImportResult> {
  await requireAdmin();

  const { year, filename, rows } = input;
  const accounts = (Array.isArray(input.accounts) ? input.accounts : [])
    .filter(
      (a) =>
        a &&
        typeof a.name === "string" &&
        typeof a.number === "string" &&
        /^\d{10,34}$/.test(a.number.replace(/\D/g, ""))
    )
    .slice(0, 20)
    .map((a) => ({ name: a.name.slice(0, 80), number: a.number.replace(/\D/g, "") }));
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    return { ok: false, error: "Nieprawidłowy rok importu" };
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
    grossGr: number;
    vatRate: number;
    vatKey: string | null;
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
    if (r.kind !== "PRZYCHOD" && r.kind !== "KOSZT") {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowy kierunek` };
    }
    if (!Number.isInteger(r.month) || r.month < 1 || r.month > 12) {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowy miesiąc` };
    }
    if (!Number.isInteger(r.grossGr) || r.grossGr === 0) {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowa kwota brutto` };
    }
    // netto liczone SERWEROWO z brutto + stawki (autorytatywnie, bez zaufania do klienta)
    const vatRate = coerceVatRate(r.vatRate);
    const amountGr = netFromGrossGr(r.grossGr, vatRate);
    if (amountGr === 0) {
      return { ok: false, error: `Operacja ${nr}: kwota netto wyszła zerowa` };
    }
    // znak netto musi odpowiadać kierunkowi (przychód +, koszt −)
    if (r.kind === "PRZYCHOD" && amountGr <= 0) {
      return { ok: false, error: `Operacja ${nr}: przychód musi być dodatni` };
    }
    if (r.kind === "KOSZT" && amountGr >= 0) {
      return { ok: false, error: `Operacja ${nr}: koszt musi być ujemny` };
    }
    if (!findRwCategory(r.kind as RwKind, r.category)) {
      return { ok: false, error: `Operacja ${nr}: nieznana kategoria „${r.category}”` };
    }
    // ROK z daty operacji (wyciąg może być za poprzednie miesiące/lata);
    // gdy brak daty (np. ręczny podział) — rok wybrany na stronie
    let rowYear = year;
    if (typeof r.dateISO === "string") {
      const m = r.dateISO.match(/^(\d{4})-/);
      if (m) {
        const y = parseInt(m[1], 10);
        if (y >= 2020 && y <= 2100) rowYear = y;
      }
    }
    // ślad pochodzenia w uwadze: data operacji z wyciągu
    const userNote = clip(r.note, 160);
    const dateNote = r.dateISO ? `wyciąg ${r.dateISO}` : null;
    const note = [userNote, dateNote].filter(Boolean).join(" · ") || null;
    const description = clip(r.description, 300);
    data.push({
      year: rowYear,
      month: r.month,
      kind: r.kind,
      category: r.category,
      amountGr,
      grossGr: Math.trunc(r.grossGr),
      vatRate,
      vatKey: vatMatchKey({ description, account: r.account }) || null,
      description,
      contractor: null,
      bank: "mBank",
      note,
      source: "IMPORT_MBANK",
      batchId: "",
    });
  }

  // partia filowana pod rok dominujący wśród wierszy (najczęstszy)
  const yearCounts = new Map<number, number>();
  for (const d of data) yearCounts.set(d.year, (yearCounts.get(d.year) ?? 0) + 1);
  const batchYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? year;

  const batch = await db.$transaction(async (tx) => {
    const created = await tx.rwImportBatch.create({
      data: {
        filename: (filename || "wyciąg mBank.csv").slice(0, 200),
        kind: "BANK",
        year: batchYear,
        rowCount: data.length,
        accountsJson: accounts.length > 0 ? JSON.stringify(accounts) : null,
      },
    });
    await tx.rwEntry.createMany({
      data: data.map((d) => ({ ...d, batchId: created.id })),
    });
    await learnVatRules(
      tx,
      data.map((d) => ({ vatKey: d.vatKey, vatRate: d.vatRate, label: d.description }))
    );
    return created;
  });

  revalidatePath(RW_PATH);
  return {
    ok: true,
    batchId: batch.id,
    kind: "BANK",
    imported: data.length,
    months: [...new Set(data.map((d) => d.month))].sort((a, b) => a - b),
    years: [...new Set(data.map((d) => d.year))].sort((a, b) => a - b),
  };
}

// ── Edycja zaimportowanej partii ─────────────────────────────────────

/** Wiersz partii do edycji (odczyt z bazy → klient) */
export interface RwBatchEditRow {
  year: number;
  month: number;
  kind: string; // PRZYCHOD | KOSZT
  category: string;
  amountGr: number; // NETTO ze znakiem (przychód +, koszt −)
  grossGr: number | null; // BRUTTO ze znakiem; null dla starych wpisów (= amountGr)
  vatRate: number | null; // stawka %; null = nieustalona (traktuj jak brutto=netto)
  vatKey: string | null; // klucz reguły VAT (spójny import↔edycja)
  description: string | null;
  contractor: string | null;
  bank: string | null;
  note: string | null;
}

export type RwBatchEditData =
  | { ok: true; batch: { id: string; kind: string; filename: string }; rows: RwBatchEditRow[] }
  | { ok: false; error: string };

/** Wczytuje partię i jej wpisy do edycji w przeglądzie. */
export async function getRwBatchForEditAction(batchId: string): Promise<RwBatchEditData> {
  await requireAdmin();
  const batch = await db.rwImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, error: "Import nie istnieje" };
  const entries = await db.rwEntry.findMany({
    where: { batchId },
    orderBy: [{ month: "asc" }, { id: "asc" }],
    select: {
      year: true,
      month: true,
      kind: true,
      category: true,
      amountGr: true,
      grossGr: true,
      vatRate: true,
      vatKey: true,
      description: true,
      contractor: true,
      bank: true,
      note: true,
    },
  });
  return {
    ok: true,
    batch: { id: batch.id, kind: batch.kind, filename: batch.filename },
    rows: entries,
  };
}

/**
 * Zapisuje edycję partii: podmienia WSZYSTKIE jej wpisy (usuń + wstaw) w jednej
 * transakcji, zachowując id/nazwę partii. Rok i miesiąc wpisów są zachowane
 * (edycja nie zmienia dat) — zmienia się kategoria/kwota, można też usunąć
 * wiersze. Pusta lista = cofnięcie całej partii (usunięcie partii i wpisów).
 */
export async function updateRwBatchAction(input: {
  batchId: string;
  rows: RwBatchEditRow[];
}): Promise<RwImportResult> {
  await requireAdmin();
  const { batchId, rows } = input;
  const batch = await db.rwImportBatch.findUnique({ where: { id: batchId } });
  if (!batch) return { ok: false, error: "Import nie istnieje" };
  if (!Array.isArray(rows)) return { ok: false, error: "Brak danych" };
  if (rows.length > 5000) {
    return { ok: false, error: "Zbyt wiele operacji naraz (limit 5000)" };
  }

  const clip = (v: unknown, max: number): string | null => {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t === "" ? null : t.slice(0, max);
  };
  const source = batch.kind === "BANK" ? "IMPORT_MBANK" : "IMPORT";

  const data: {
    year: number;
    month: number;
    kind: string;
    category: string;
    amountGr: number;
    grossGr: number;
    vatRate: number;
    vatKey: string | null;
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
    if (r.kind !== "PRZYCHOD" && r.kind !== "KOSZT") {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowy kierunek` };
    }
    if (!Number.isInteger(r.year) || r.year < 2020 || r.year > 2100) {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowy rok` };
    }
    if (!Number.isInteger(r.month) || r.month < 1 || r.month > 12) {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowy miesiąc` };
    }
    // brutto: wprost z klienta, albo (stare wpisy bez brutto) = kwota netto;
    // netto liczone SERWEROWO z brutto + stawki
    const grossGr = Number.isInteger(r.grossGr) ? (r.grossGr as number) : r.amountGr;
    if (!Number.isInteger(grossGr) || grossGr === 0) {
      return { ok: false, error: `Operacja ${nr}: nieprawidłowa kwota brutto` };
    }
    const vatRate = coerceVatRate(r.vatRate);
    const amountGr = netFromGrossGr(grossGr, vatRate);
    if (amountGr === 0) {
      return { ok: false, error: `Operacja ${nr}: kwota netto wyszła zerowa` };
    }
    if (r.kind === "PRZYCHOD" && amountGr <= 0) {
      return { ok: false, error: `Operacja ${nr}: przychód musi być dodatni` };
    }
    if (r.kind === "KOSZT" && amountGr >= 0) {
      return { ok: false, error: `Operacja ${nr}: koszt musi być ujemny` };
    }
    if (!findRwCategory(r.kind as RwKind, r.category)) {
      return { ok: false, error: `Operacja ${nr}: nieznana kategoria „${r.category}”` };
    }
    const description = clip(r.description, 300);
    const vatKey =
      (typeof r.vatKey === "string" && r.vatKey.trim()) ||
      vatMatchKey({ description }) ||
      null;
    data.push({
      year: r.year,
      month: r.month,
      kind: r.kind,
      category: r.category,
      amountGr,
      grossGr,
      vatRate,
      vatKey,
      description,
      contractor: clip(r.contractor, 120),
      bank: clip(r.bank, 40),
      note: clip(r.note, 300),
      source,
      batchId,
    });
  }

  await db.$transaction(async (tx) => {
    await tx.rwEntry.deleteMany({ where: { batchId } });
    if (data.length === 0) {
      await tx.rwImportBatch.delete({ where: { id: batchId } });
      return;
    }
    await tx.rwEntry.createMany({ data });
    await learnVatRules(
      tx,
      data.map((d) => ({ vatKey: d.vatKey, vatRate: d.vatRate, label: d.description }))
    );
    await tx.rwImportBatch.update({
      where: { id: batchId },
      data: { rowCount: data.length },
    });
  });

  revalidatePath(RW_PATH);
  return {
    ok: true,
    batchId,
    kind: batch.kind,
    imported: data.length,
    months: [...new Set(data.map((d) => d.month))].sort((a, b) => a - b),
    years: [...new Set(data.map((d) => d.year))].sort((a, b) => a - b),
  };
}

/** Wiersz wysyłany do AI-doprecyzowania kategorii (klient → akcja) */
export interface RwAiRequestRow {
  index: number; // pozycja wiersza w przeglądzie (identyfikator odpowiedzi)
  kind: string; // PRZYCHOD | KOSZT
  description: string | null;
  amountGr: number;
}

export type RwAiResult =
  | {
      ok: true;
      suggestions: {
        index: number;
        category: string;
        confidence: "high" | "medium" | "low";
      }[];
    }
  | { ok: false; error: string };

/**
 * Pass AI: kategoryzuje przez Claude operacje, których silnik reguł nie
 * rozpoznał pewnie. Wymaga ANTHROPIC_API_KEY na serwerze (klucz nigdy nie
 * trafia do klienta). Zwrócone kategorie są zwalidowane względem taksonomii
 * (lib/rw-ai.ts) — i tak lądują w edytowalnych dropdownach przeglądu.
 */
export async function aiCategorizeAction(rows: RwAiRequestRow[]): Promise<RwAiResult> {
  await requireAdmin();
  if (!isAiEnabled()) {
    return { ok: false, error: "AI nie jest skonfigurowane (brak ANTHROPIC_API_KEY na serwerze)" };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "Brak operacji do analizy" };
  }
  if (rows.length > 400) {
    return { ok: false, error: "Zbyt wiele operacji naraz (limit 400)" };
  }

  const inputs: AiRowInput[] = [];
  for (const r of rows) {
    if (
      !Number.isInteger(r.index) ||
      r.index < 0 ||
      (r.kind !== "PRZYCHOD" && r.kind !== "KOSZT") ||
      !Number.isInteger(r.amountGr)
    ) {
      return { ok: false, error: "Nieprawidłowe dane operacji" };
    }
    inputs.push({
      index: r.index,
      kind: r.kind,
      description: typeof r.description === "string" ? r.description : "",
      amountGr: r.amountGr,
    });
  }

  try {
    const suggestions = await aiCategorize(inputs);
    return { ok: true, suggestions };
  } catch (e) {
    // typowane wyjątki SDK — od najbardziej szczegółowych
    if (e instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "Nieprawidłowy klucz API (ANTHROPIC_API_KEY)" };
    }
    if (e instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Limit zapytań API — spróbuj za chwilę" };
    }
    if (e instanceof Anthropic.APIConnectionError) {
      return { ok: false, error: "Brak połączenia z API Anthropic" };
    }
    if (e instanceof Anthropic.APIError) {
      return { ok: false, error: `Błąd API Anthropic (${e.status ?? "?"})` };
    }
    return { ok: false, error: "Nieoczekiwany błąd analizy AI" };
  }
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
