// Callback OAuth: weryfikuje `state` (CSRF), wymienia `code` na token
// długotrwały i zapisuje go jako ustawienie meta_access_token. Na końcu wraca
// do /ustawienia z komunikatem. Wymaga zalogowanego admina.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { setSetting } from "@/lib/settings";
import {
  getMetaAppCreds,
  resolveOAuthBase,
  callbackUrl,
  exchangeCodeForToken,
  exchangeForLongLived,
} from "@/lib/meta-oauth";

export async function GET(request: Request): Promise<Response> {
  await requireAdmin();

  const base = await resolveOAuthBase(request);
  const back = (status: string) =>
    NextResponse.redirect(new URL(`/ustawienia?meta=${status}`, base));

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) return back("odrzucono");

  const store = await cookies();
  const expected = store.get("meta_oauth_state")?.value;
  if (!code || !state || !expected || state !== expected) {
    return back("blad_state");
  }

  const { appId, appSecret } = await getMetaAppCreds();
  if (!appId || !appSecret) return back("brak_app_id");

  try {
    const redirectUri = callbackUrl(base);
    const shortToken = await exchangeCodeForToken(appId, appSecret, redirectUri, code);
    const longToken = await exchangeForLongLived(appId, appSecret, shortToken);
    await setSetting("meta_access_token", longToken);

    revalidatePath("/ustawienia");
    revalidatePath("/leady");

    const res = back("connected");
    res.cookies.delete("meta_oauth_state");
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "nieznany błąd";
    return NextResponse.redirect(
      new URL(`/ustawienia?meta=blad&msg=${encodeURIComponent(msg.slice(0, 200))}`, base)
    );
  }
}
