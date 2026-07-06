import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "./db";

export const SESSION_COOKIE = "adgen_session";
const SESSION_DAYS = 30;

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
 * Wymaga roli ADMIN. Pracownik jest odsyłany do swojego panelu czasu —
 * egzekwowane na poziomie API (akcje serwerowe, route handlery), nie tylko UI.
 */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") redirect("/moj-czas");
  return user;
}
