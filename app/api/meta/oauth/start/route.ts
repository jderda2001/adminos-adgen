// Start OAuth „Zaloguj przez Facebooka": ustawia losowy `state` (CSRF) w cookie
// i przekierowuje do dialogu logowania Meta. Wymaga zalogowanego admina i App ID.

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  getMetaAppCreds,
  resolveOAuthBase,
  callbackUrl,
  buildAuthUrl,
} from "@/lib/meta-oauth";

export async function GET(request: Request): Promise<Response> {
  await requireAdmin();

  const base = await resolveOAuthBase(request);
  const { appId } = await getMetaAppCreds();
  if (!appId) {
    return NextResponse.redirect(new URL("/ustawienia?meta=brak_app_id", base));
  }

  const state = randomUUID();
  const authUrl = buildAuthUrl(appId, callbackUrl(base), state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min na dokończenie logowania
  });
  return res;
}
