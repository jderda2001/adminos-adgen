"use server";

import { revalidatePath } from "next/cache";
import { randomInt } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { hashPassword, requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import {
  dateFromInput,
  formatDate,
  parseMoneyToGr,
  todayUTC,
} from "@/lib/format";
import { ROLES } from "@/lib/types";

// Wynik akcji zwracających hasło tymczasowe — hasło jest widoczne dokładnie raz,
// w odpowiedzi tej akcji; nigdzie nie jest zapisywane jawnym tekstem.
export type TempPasswordResult =
  | { ok: true; tempPassword: string }
  | { ok: false; error: string };

// ── Generator czytelnego hasła tymczasowego (słowo+słowo+cyfry, min. 12 znaków)

const PASSWORD_WORDS = [
  "Sosna",
  "Klon",
  "Brzoza",
  "Topola",
  "Jawor",
  "Olcha",
  "Jesion",
  "Kasztan",
  "Wilk",
  "Sowa",
  "Kruk",
  "Bocian",
  "Foka",
  "Bizon",
  "Puma",
  "Panda",
  "Delfin",
  "Zebra",
  "Tygrys",
  "Lampart",
  "Rzeka",
  "Burza",
  "Wiatr",
  "Skala",
];

function generateTempPassword(): string {
  const first = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
  let second = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
  while (second === first) {
    second = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
  }
  const digits = randomInt(1000, 10000); // 4 cyfry
  return `${first}${second}${digits}`;
}

// ── Walidacja danych pracownika ──────────────────────────────────────

const memberSchema = z.object({
  name: z.string().trim().min(1, "Podaj imię i nazwisko"),
  email: z
    .string()
    .trim()
    .min(1, "Podaj adres e-mail")
    .refine(
      (v) => z.string().email().safeParse(v).success,
      "Podaj poprawny adres e-mail"
    ),
  role: z.enum(ROLES, { message: "Wybierz rolę" }),
});

function parseMemberForm(formData: FormData):
  | { success: false; error: string }
  | { success: true; data: { name: string; email: string; role: string } } {
  const parsed = memberSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Nieprawidłowe dane formularza",
    };
  }
  // Normalizacja e-maila do lower-case: logowanie lowercase'uje adres, więc konto
  // zapisane z wielką literą nigdy by się nie zalogowało. Trim robi już schema.
  return {
    success: true,
    data: { ...parsed.data, email: parsed.data.email.toLowerCase() },
  };
}

// ── Zapraszanie pracownika ───────────────────────────────────────────

export async function inviteMemberAction(
  formData: FormData
): Promise<TempPasswordResult> {
  await requireAdmin();

  const result = parseMemberForm(formData);
  if (!result.success) return { ok: false, error: result.error };
  const { name, email, role } = result.data;

  // Opcjonalna stawka początkowa
  const rateRaw = String(formData.get("initialRate") ?? "").trim();
  let initialRate: { ratePerHourGr: number; validFrom: Date } | null = null;
  if (rateRaw !== "") {
    const rateGr = parseMoneyToGr(rateRaw);
    if (rateGr === null || rateGr <= 0) {
      return { ok: false, error: "Podaj poprawną stawkę, np. 120,00" };
    }
    const fromRaw = String(formData.get("rateFrom") ?? "").trim();
    const validFrom = fromRaw ? dateFromInput(fromRaw) : todayUTC();
    if (!validFrom) {
      return {
        ok: false,
        error: "Podaj poprawną datę obowiązywania stawki",
      };
    }
    initialRate = { ratePerHourGr: rateGr, validFrom };
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return {
      ok: false,
      error: "Użytkownik z tym adresem e-mail już istnieje",
    };
  }

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.user.create({
    data: {
      name,
      email,
      role,
      passwordHash,
      mustChangePassword: true,
      ...(initialRate ? { rates: { create: initialRate } } : {}),
    },
  });

  revalidatePath("/zespol");
  return { ok: true, tempPassword };
}

// ── Edycja danych pracownika ─────────────────────────────────────────

export async function updateMemberAction(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const result = parseMemberForm(formData);
  if (!result.success) return fail(result.error);
  const { name, email, role } = result.data;

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return fail("Użytkownik nie istnieje");

  if (id === admin.id && role !== "ADMIN") {
    return fail("Nie możesz odebrać sobie roli administratora");
  }

  const emailTaken = await db.user.findFirst({
    where: { email, NOT: { id } },
  });
  if (emailTaken) return fail("Użytkownik z tym adresem e-mail już istnieje");

  await db.user.update({ where: { id }, data: { name, email, role } });
  revalidatePath("/zespol");
  return ok("Zmiany zostały zapisane");
}

// ── Aktywacja / dezaktywacja konta ───────────────────────────────────

export async function setMemberActiveAction(
  id: string,
  active: boolean
): Promise<ActionResult> {
  const admin = await requireAdmin();

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return fail("Użytkownik nie istnieje");

  if (!active && id === admin.id) {
    return fail("Nie możesz dezaktywować własnego konta");
  }

  await db.user.update({ where: { id }, data: { active } });
  if (!active) {
    // Dezaktywacja natychmiast wylogowuje pracownika ze wszystkich urządzeń
    await db.session.deleteMany({ where: { userId: id } });
  }

  revalidatePath("/zespol");
  return ok(
    active ? "Konto zostało aktywowane" : "Konto zostało dezaktywowane"
  );
}

// ── Reset hasła (nowe hasło tymczasowe) ──────────────────────────────

export async function resetPasswordAction(
  id: string
): Promise<TempPasswordResult> {
  await requireAdmin();

  const user = await db.user.findUnique({ where: { id } });
  if (!user) return { ok: false, error: "Użytkownik nie istnieje" };

  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  await db.user.update({
    where: { id },
    data: { passwordHash, mustChangePassword: true },
  });
  // Unieważnij wszystkie dotychczasowe sesje użytkownika
  await db.session.deleteMany({ where: { userId: id } });

  revalidatePath("/zespol");
  return { ok: true, tempPassword };
}

// ── Historia stawek ──────────────────────────────────────────────────

export async function addRateAction(
  userId: string,
  formData: FormData
): Promise<ActionResult> {
  await requireAdmin();

  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return fail("Użytkownik nie istnieje");

  const rateGr = parseMoneyToGr(String(formData.get("rate") ?? ""));
  if (rateGr === null || rateGr <= 0) {
    return fail("Podaj poprawną stawkę, np. 120,00");
  }

  const validFrom = dateFromInput(String(formData.get("validFrom") ?? ""));
  if (!validFrom) {
    return fail("Podaj poprawną datę, od której obowiązuje stawka");
  }

  const duplicate = await db.hourlyRate.findFirst({
    where: { userId, validFrom },
  });
  if (duplicate) {
    return fail(
      `Stawka obowiązująca od ${formatDate(validFrom)} już istnieje — usuń ją lub wybierz inną datę`
    );
  }

  await db.hourlyRate.create({
    data: { userId, ratePerHourGr: rateGr, validFrom },
  });
  revalidatePath("/zespol");
  return ok("Stawka została dodana");
}

export async function deleteRateAction(rateId: string): Promise<ActionResult> {
  await requireAdmin();

  const rate = await db.hourlyRate.findUnique({ where: { id: rateId } });
  if (!rate) return fail("Pozycja historii stawek nie istnieje");

  await db.hourlyRate.delete({ where: { id: rateId } });
  revalidatePath("/zespol");
  return ok("Stawka została usunięta");
}
