"use server";

// Akcje modułu Estymacje: ręczny stan kont (CashSnapshot), planowane zdarzenia
// gotówkowe (FinPlanEvent), założenie „nowy biznes" (Setting) oraz analiza AI.
// Każda akcja: requireAdmin → walidacja (komunikaty PL) → Prisma → revalidatePath.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { dateFromInput, parseMoneyToGr } from "@/lib/format";
import { PLAN_EVENT_KINDS, buildForecast } from "@/lib/forecast";
import { isAiEnabled, aiReviewForecast, type ForecastAiReview } from "@/lib/forecast-ai";
import { loadForecastInput, type Horizon } from "./forecast-data";

const PATH = "/estymacje";
const PERIOD_RE = /^\d{4}-\d{2}$/;

// ── Stan kont ────────────────────────────────────────────────────────

export async function setCashSnapshotAction(input: {
  date: string; // RRRR-MM-DD
  balance: string; // zł (może być ujemne — debet)
  note: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const date = dateFromInput(input.date);
  if (!date) return fail("Podaj poprawną datę stanu kont");
  const balanceGr = parseMoneyToGr(input.balance);
  if (balanceGr === null) return fail("Podaj poprawny stan kont, np. 50 000,00");
  const note = input.note.trim().slice(0, 200) || null;
  await db.cashSnapshot.create({ data: { date, balanceGr, note } });
  revalidatePath(PATH);
  return ok("Zapisano stan kont");
}

export async function deleteCashSnapshotAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return fail("Brak identyfikatora");
  await db.cashSnapshot.delete({ where: { id } }).catch(() => null);
  revalidatePath(PATH);
  return ok("Usunięto wpis stanu kont");
}

// ── Zdarzenia jednorazowe ────────────────────────────────────────────

const eventSchema = z.object({
  period: z.string().regex(PERIOD_RE, "Wybierz miesiąc"),
  kind: z.enum(PLAN_EVENT_KINDS, { message: "Wybierz typ (wpływ/wydatek)" }),
  label: z.string().trim().min(1, "Podaj opis zdarzenia"),
  amount: z.string().trim().min(1, "Podaj kwotę"),
  note: z.string().optional().default(""),
});

function parseEvent(input: unknown):
  | { ok: false; error: string }
  | { ok: true; data: { period: string; kind: string; label: string; amountGr: number; note: string | null } } {
  const parsed = eventSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane" };
  const amountGr = parseMoneyToGr(parsed.data.amount);
  if (amountGr === null || amountGr <= 0) return { ok: false, error: "Podaj poprawną kwotę (dodatnią)" };
  return {
    ok: true,
    data: {
      period: parsed.data.period,
      kind: parsed.data.kind,
      label: parsed.data.label.slice(0, 120),
      amountGr,
      note: parsed.data.note.trim().slice(0, 200) || null,
    },
  };
}

export async function createPlanEventAction(input: {
  period: string;
  kind: string;
  label: string;
  amount: string;
  note: string;
}): Promise<ActionResult> {
  await requireAdmin();
  const r = parseEvent(input);
  if (!r.ok) return fail(r.error);
  await db.finPlanEvent.create({ data: r.data });
  revalidatePath(PATH);
  return ok("Dodano zdarzenie");
}

export async function updatePlanEventAction(input: {
  id: string;
  period: string;
  kind: string;
  label: string;
  amount: string;
  note: string;
}): Promise<ActionResult> {
  await requireAdmin();
  if (!input.id) return fail("Brak identyfikatora");
  const r = parseEvent(input);
  if (!r.ok) return fail(r.error);
  await db.finPlanEvent.update({ where: { id: input.id }, data: r.data });
  revalidatePath(PATH);
  return ok("Zapisano zdarzenie");
}

export async function deletePlanEventAction(id: string): Promise<ActionResult> {
  await requireAdmin();
  if (!id) return fail("Brak identyfikatora");
  await db.finPlanEvent.delete({ where: { id } }).catch(() => null);
  revalidatePath(PATH);
  return ok("Usunięto zdarzenie");
}

// ── Założenie „nowy biznes / mies." ──────────────────────────────────

export async function setNewBusinessAssumptionAction(value: string): Promise<ActionResult> {
  await requireAdmin();
  const gr = parseMoneyToGr(value || "0");
  if (gr === null || gr < 0) return fail("Podaj poprawną kwotę (≥ 0)");
  await db.setting.upsert({
    where: { key: "estymacje_nowy_biznes_gr" },
    update: { value: String(gr) },
    create: { key: "estymacje_nowy_biznes_gr", value: String(gr) },
  });
  revalidatePath(PATH);
  return ok("Zapisano założenie nowego biznesu");
}

// ── Analiza AI (doradcza) ────────────────────────────────────────────

export type AiForecastResult =
  | { ok: true; review: ForecastAiReview }
  | { ok: false; error: string };

const HORIZONS: readonly number[] = [3, 6, 12];

/**
 * Uruchamia analizę AI dla wskazanego horyzontu. Serwer SAM odbudowuje wejście
 * prognozy (nie ufa klientowi), liczy baseline i wysyła go do modelu. Zwraca
 * korekty/ryzyka/komentarz — nakładane na baseline czystą funkcją po stronie
 * klienta. Nic nie zapisuje do bazy.
 */
export async function aiForecastAction(horizon: number): Promise<AiForecastResult> {
  await requireAdmin();
  if (!isAiEnabled()) {
    return { ok: false, error: "AI nie jest skonfigurowane (brak ANTHROPIC_API_KEY na serwerze)" };
  }
  const h: Horizon = (HORIZONS.includes(horizon) ? horizon : 6) as Horizon;
  try {
    const input = await loadForecastInput(h);
    const baseline = buildForecast(input);
    const review = await aiReviewForecast(baseline);
    return { ok: true, review };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: "Błędny klucz API Anthropic" };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Przekroczono limit zapytań API — spróbuj później" };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: "Brak połączenia z API Anthropic" };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Błąd API Anthropic (${e.status ?? "?"})` };
    return { ok: false, error: "Nieoczekiwany błąd analizy AI" };
  }
}
