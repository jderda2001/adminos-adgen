"use server";

// Akcje panelu pracownika "Mój czas" — KAŻDA operuje wyłącznie na danych
// zalogowanego użytkownika (userId z sesji, nigdy z formularza).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  dateFromInput,
  formatHours,
  parseHoursToMinutes,
  todayUTC,
} from "@/lib/format";

// ── Walidacja wpisu czasu ────────────────────────────────────────────

const entrySchema = z.object({
  clientId: z.string().min(1, "Wybierz klienta"),
  description: z.string().trim().optional(),
  hours: z.string().trim().min(1, "Podaj liczbę godzin, np. 1,5"),
  date: z.string().trim().min(1, "Podaj datę"),
});

interface EntryData {
  clientId: string;
  description: string | null;
  minutes: number;
  date: Date;
}

function parseEntryForm(
  formData: FormData
): { success: false; error: string } | { success: true; data: EntryData } {
  const parsed = entrySchema.safeParse({
    clientId: formData.get("clientId") ?? "",
    description: formData.get("description") ?? "",
    hours: formData.get("hours") ?? "",
    date: formData.get("date") ?? "",
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza",
    };
  }
  const d = parsed.data;

  const minutes = parseHoursToMinutes(d.hours);
  if (minutes === null) {
    return { success: false, error: "Podaj liczbę godzin, np. 1,5" };
  }

  const date = dateFromInput(d.date);
  if (!date) return { success: false, error: "Podaj poprawną datę" };

  return {
    success: true,
    data: {
      clientId: d.clientId,
      description: d.description || null,
      minutes,
      date,
    },
  };
}

async function clientExists(clientId: string): Promise<boolean> {
  const client = await db.client.findUnique({
    where: { id: clientId },
    select: { id: true },
  });
  return client !== null;
}

// ── Szybki wpis ──────────────────────────────────────────────────────

export async function addTimeEntryAction(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const result = parseEntryForm(formData);
  if (!result.success) return fail(result.error);
  if (!(await clientExists(result.data.clientId))) {
    return fail("Wybrany klient nie istnieje");
  }

  await db.timeEntry.create({
    data: { userId: user.id, ...result.data },
  });
  revalidatePath("/moj-czas");
  return ok(`Dodano wpis (${formatHours(result.data.minutes)})`);
}

export async function updateTimeEntryAction(
  entryId: string,
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const result = parseEntryForm(formData);
  if (!result.success) return fail(result.error);
  if (!(await clientExists(result.data.clientId))) {
    return fail("Wybrany klient nie istnieje");
  }

  // updateMany z warunkiem userId — pracownik nie zmodyfikuje cudzego wpisu
  const updated = await db.timeEntry.updateMany({
    where: { id: entryId, userId: user.id },
    data: result.data,
  });
  if (updated.count === 0) return fail("Wpis nie istnieje");

  revalidatePath("/moj-czas");
  return ok("Zmiany zostały zapisane");
}

export async function deleteTimeEntryAction(
  entryId: string
): Promise<ActionResult> {
  const user = await requireUser();

  const deleted = await db.timeEntry.deleteMany({
    where: { id: entryId, userId: user.id },
  });
  if (deleted.count === 0) return fail("Wpis nie istnieje");

  revalidatePath("/moj-czas");
  return ok("Wpis został usunięty");
}

// ── Timer start/stop ─────────────────────────────────────────────────

const timerSchema = z.object({
  clientId: z.string().min(1, "Wybierz klienta, aby wystartować timer"),
  description: z.string().trim().optional(),
});

export async function startTimerAction(
  formData: FormData
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = timerSchema.safeParse({
    clientId: formData.get("clientId") ?? "",
    description: formData.get("description") ?? "",
  });
  if (!parsed.success) {
    return fail(
      parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza"
    );
  }
  if (!(await clientExists(parsed.data.clientId))) {
    return fail("Wybrany klient nie istnieje");
  }

  await db.activeTimer.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      clientId: parsed.data.clientId,
      description: parsed.data.description || null,
    },
    update: {
      clientId: parsed.data.clientId,
      description: parsed.data.description || null,
      startedAt: new Date(),
    },
  });
  revalidatePath("/moj-czas");
  return ok("Timer wystartował");
}

export async function stopTimerAction(): Promise<ActionResult> {
  const user = await requireUser();

  const timer = await db.activeTimer.findUnique({
    where: { userId: user.id },
  });
  if (!timer) return fail("Brak aktywnego timera");

  const minutes = Math.max(
    1,
    Math.round((Date.now() - timer.startedAt.getTime()) / 60_000)
  );
  // data wpisu = dzień kalendarzowy startu timera (północ UTC, jak todayUTC)
  const s = timer.startedAt;
  const date = new Date(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()));

  await db.$transaction([
    db.timeEntry.create({
      data: {
        userId: user.id,
        clientId: timer.clientId,
        description: timer.description,
        date,
        minutes,
      },
    }),
    db.activeTimer.deleteMany({ where: { userId: user.id } }),
  ]);

  revalidatePath("/moj-czas");
  return ok(`Timer zatrzymany — zapisano ${formatHours(minutes)}`);
}

export async function cancelTimerAction(): Promise<ActionResult> {
  const user = await requireUser();
  await db.activeTimer.deleteMany({ where: { userId: user.id } });
  revalidatePath("/moj-czas");
  return ok("Timer został anulowany bez zapisu");
}

// ── Kopiowanie wczorajszego dnia ─────────────────────────────────────

export type CopyYesterdayResult =
  | { ok: true; message: string; copied: number }
  | { ok: false; error: string };

function entriesLabel(n: number): string {
  if (n === 1) return "wpis";
  const d = n % 10;
  const h = n % 100;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "wpisy";
  return "wpisów";
}

export async function copyYesterdayAction(): Promise<CopyYesterdayResult> {
  const user = await requireUser();

  const today = todayUTC();
  const yesterday = new Date(today.getTime() - 86_400_000);

  const entries = await db.timeEntry.findMany({
    where: { userId: user.id, date: yesterday },
    select: { clientId: true, description: true, minutes: true },
  });
  if (entries.length === 0) {
    return {
      ok: true,
      copied: 0,
      message: "Brak wczorajszych wpisów do skopiowania",
    };
  }

  await db.timeEntry.createMany({
    data: entries.map((e) => ({
      userId: user.id,
      clientId: e.clientId,
      description: e.description,
      minutes: e.minutes,
      date: today,
    })),
  });

  revalidatePath("/moj-czas");
  return {
    ok: true,
    copied: entries.length,
    message: `Skopiowano ${entries.length} ${entriesLabel(entries.length)} z wczoraj`,
  };
}
