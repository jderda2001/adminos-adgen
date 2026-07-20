import "server-only";

// Przepływ OAuth „Zaloguj przez Facebooka" dla Meta Marketing API.
// App ID/Secret trzymane w bazie (Ustawienia → Integracje) lub w env (fallback).
// Callback wymienia `code` na token krótkotrwały → długotrwały (~60 dni), który
// zapisujemy jako ustawienie meta_access_token. Zakresy: ads_read + business_management.

import { getSetting } from "./settings";

const OAUTH_SCOPES = "ads_read,business_management";
export const META_CALLBACK_PATH = "/api/meta/oauth/callback";

function apiVersion(): string {
  return process.env.META_API_VERSION || "v21.0";
}

/** App ID + App Secret: z bazy (UI), a w razie braku z env. */
export async function getMetaAppCreds(): Promise<{ appId: string; appSecret: string }> {
  const appId = (await getSetting("meta_app_id")).trim() || process.env.META_APP_ID?.trim() || "";
  const appSecret =
    (await getSetting("meta_app_secret")).trim() || process.env.META_APP_SECRET?.trim() || "";
  return { appId, appSecret };
}

/**
 * Bazowy origin HTTPS do redirectu OAuth. Priorytet: ustawienie
 * meta_oauth_base_url; w razie braku — z nagłówków żądania (proxy tailscale serve
 * przekazuje host + x-forwarded-proto).
 */
export async function resolveOAuthBase(request: Request): Promise<string> {
  const configured = (await getSetting("meta_oauth_base_url")).trim();
  if (configured) return configured.replace(/\/+$/, "");
  const h = request.headers;
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  return `${proto}://${host}`.replace(/\/+$/, "");
}

export function callbackUrl(base: string): string {
  return `${base}${META_CALLBACK_PATH}`;
}

/** URL dialogu logowania Facebooka. */
export function buildAuthUrl(appId: string, redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${apiVersion()}/dialog/oauth`);
  u.searchParams.set("client_id", appId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", OAUTH_SCOPES);
  return u.toString();
}

interface TokenResponse {
  access_token?: string;
  error?: { message?: string };
}

async function oauthTokenGet(params: Record<string, string>): Promise<string> {
  const u = new URL(`https://graph.facebook.com/${apiVersion()}/oauth/access_token`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { cache: "no-store" });
  const json = (await res.json()) as TokenResponse;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error?.message ?? `Meta OAuth ${res.status}`);
  }
  return json.access_token;
}

/** Wymiana `code` (z callbacku) na token krótkotrwały. */
export function exchangeCodeForToken(
  appId: string,
  appSecret: string,
  redirectUri: string,
  code: string
): Promise<string> {
  return oauthTokenGet({
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code,
  });
}

/** Wymiana tokena krótkotrwałego na długotrwały (~60 dni). */
export function exchangeForLongLived(
  appId: string,
  appSecret: string,
  shortToken: string
): Promise<string> {
  return oauthTokenGet({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
}
