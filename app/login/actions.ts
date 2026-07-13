"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  createSession,
  destroySession,
  getCurrentUser,
  verifyPassword,
  hashPassword,
  SESSION_COOKIE,
} from "@/lib/auth";

const loginSchema = z.object({
  email: z.string().email("Podaj poprawny adres e-mail"),
  password: z.string().min(1, "Podaj hasło"),
});

// Prosty limiter prób logowania per e-mail (w pamięci procesu — wystarczające
// dla self-hosted pojedynczej instancji; przy skalowaniu przenieść do bazy).
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 60_000;
const failedLogins = new Map<string, { count: number; lockedUntil: number }>();

function loginLockedFor(email: string): number {
  const entry = failedLogins.get(email);
  if (!entry) return 0;
  const remaining = entry.lockedUntil - Date.now();
  return remaining > 0 ? remaining : 0;
}

function recordFailedLogin(email: string): void {
  const entry = failedLogins.get(email) ?? { count: 0, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOGIN_LOCK_MS;
    entry.count = 0;
  }
  failedLogins.set(email, entry);
}

export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const email = parsed.data.email.toLowerCase().trim();
  const lockedMs = loginLockedFor(email);
  if (lockedMs > 0) {
    return {
      error: `Zbyt wiele nieudanych prób. Spróbuj ponownie za ${Math.ceil(lockedMs / 1000)} s.`,
    };
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    recordFailedLogin(email);
    return { error: "Nieprawidłowy e-mail lub hasło" };
  }
  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    recordFailedLogin(email);
    return { error: "Nieprawidłowy e-mail lub hasło" };
  }
  failedLogins.delete(email);

  await createSession(user.id);
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Podaj obecne hasło"),
    password: z.string().min(8, "Hasło musi mieć co najmniej 8 znaków"),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Hasła nie są identyczne",
    path: ["confirm"],
  });

export interface ChangePasswordState {
  error?: string;
  success?: boolean;
}

/** Zmiana własnego hasła (m.in. wymuszona po zaproszeniu z hasłem tymczasowym) */
export async function changeOwnPasswordAction(
  _prev: ChangePasswordState,
  formData: FormData
): Promise<ChangePasswordState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  // weryfikacja obecnego hasła (przy pierwszym logowaniu — hasła tymczasowego)
  const dbUser = await db.user.findUnique({ where: { id: user.id } });
  if (!dbUser) redirect("/login");
  const currentValid = await verifyPassword(
    parsed.data.currentPassword,
    dbUser.passwordHash
  );
  if (!currentValid) {
    return { error: "Obecne hasło jest nieprawidłowe" };
  }

  const cookieStore = await cookies();
  const currentToken = cookieStore.get(SESSION_COOKIE)?.value;

  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(parsed.data.password),
        mustChangePassword: false,
      },
    }),
    // unieważnij wszystkie pozostałe sesje — np. założone przechwyconym
    // hasłem tymczasowym; bieżąca sesja zostaje
    db.session.deleteMany({
      where: { userId: user.id, ...(currentToken ? { NOT: { id: currentToken } } : {}) },
    }),
  ]);
  return { success: true };
}
