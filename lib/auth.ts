import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";

export const SESSION_COOKIE = "adgen_session";
const SESSION_DAYS = 30;

/**
 * AUTH_DISABLED=1 wyłącza logowanie hasłem — każdy, kto dotrze do aplikacji,
 * działa jako pierwszy aktywny administrator. Używać WYŁĄCZNIE, gdy aplikacja
 * jest osiągalna tylko w zamkniętej sieci (Tailscale). Ustawienie odwracalne
 * przez zmianę env i restart.
 */
export function isAuthDisabled(): boolean {
  return process.env.AUTH_DISABLED === "1";
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { id: token, userId, expiresAt } });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    // secure celowo wyłączone — system self-hosted często działa po HTTP w sieci lokalnej;
    // przy wystawieniu za HTTPS ustaw AUTH_SECURE_COOKIE=1
    secure: process.env.AUTH_SECURE_COOKIE === "1",
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { id: token } });
  }
  cookieStore.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string; // ADMIN | EMPLOYEE
  mustChangePassword: boolean;
}

/** Zalogowany użytkownik albo null — wynik cache'owany w ramach żądania */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (isAuthDisabled()) {
    // sieć zamknięta: każdy działa jako pierwszy aktywny administrator
    const admin = await db.user.findFirst({
      where: { role: "ADMIN", active: true },
      orderBy: { createdAt: "asc" },
    });
    if (admin) {
      return {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        mustChangePassword: false, // bez haseł nie wymuszamy ich zmiany
      };
    }
    // brak konta admina (świeża baza) — przechodzimy do normalnego flow
  }

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { id: token },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await db.session.delete({ where: { id: token } });
    return null;
  }
  if (!session.user.active) return null;

  const { id, name, email, role, mustChangePassword } = session.user;
  return { id, name, email, role, mustChangePassword };
});

/**
 * Wymaga zalogowanego, aktywnego użytkownika (dowolna rola).
 * Używać we WSZYSTKICH akcjach serwerowych i route handlerach.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * Wymaga roli ADMIN. Aplikacja jest w całości panelem finansowym (moduł czasu
 * pracy usunięty), więc konto bez roli ADMIN nie ma dostępnych widoków —
 * jest wylogowywane. Przy AUTH_DISABLED każdy działa jako admin, więc ta gałąź
 * nie występuje w sieci zamkniętej.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    await destroySession();
    redirect("/login");
  }
  return user;
}
