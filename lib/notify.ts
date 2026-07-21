// Wysyłka powiadomień (e-mail przez SMTP, SMS przez HTTP API dostawcy).
// BRAMKA BEZPIECZEŃSTWA: sterownik zależy od ustawienia `notify_mode`.
//   "off"  → SYMULACJA: nic nie wychodzi, zwracamy { ok, simulated: true }.
//   "live" → realna wysyłka (SMTP / HTTP SMS) z danymi z Ustawień.
// Domyślnie "off". Poświadczenia trzymamy w tabeli Setting (DB gitignored).

import { getSettings } from "@/lib/settings";

export interface NotifyResult {
  ok: boolean;
  simulated: boolean;
  error?: string;
}

/** Czy wysyłka działa na żywo (poza symulacją). */
export async function isLiveNotify(): Promise<boolean> {
  const s = await getSettings();
  return s.notify_mode === "live";
}

export async function sendEmail(args: {
  to: string;
  subject: string;
  body: string;
}): Promise<NotifyResult> {
  const s = await getSettings();
  if (s.notify_mode !== "live") return { ok: true, simulated: true };
  if (!s.smtp_host || !s.smtp_from) {
    return { ok: false, simulated: false, error: "Brak konfiguracji SMTP (host/nadawca)" };
  }
  try {
    // dynamiczny import — nodemailer ładowany tylko na ścieżce „live"
    const nodemailer = (await import("nodemailer")).default;
    const transport = nodemailer.createTransport({
      host: s.smtp_host,
      port: Number(s.smtp_port) || 587,
      secure: Number(s.smtp_port) === 465,
      auth: s.smtp_user ? { user: s.smtp_user, pass: s.smtp_pass } : undefined,
    });
    await transport.sendMail({
      from: s.smtp_from,
      to: args.to,
      subject: args.subject,
      text: args.body,
    });
    return { ok: true, simulated: false };
  } catch (e) {
    return { ok: false, simulated: false, error: e instanceof Error ? e.message : "Błąd SMTP" };
  }
}

export async function sendSms(args: { to: string; body: string }): Promise<NotifyResult> {
  const s = await getSettings();
  if (s.notify_mode !== "live") return { ok: true, simulated: true };
  if (!s.sms_api_url) {
    return { ok: false, simulated: false, error: "Brak konfiguracji API SMS (endpoint)" };
  }
  try {
    // Generyczny POST JSON — kształt do dostrojenia pod konkretnego dostawcę,
    // gdy użytkownik poda API. Trzymamy klucz w nagłówku Authorization.
    const res = await fetch(s.sms_api_url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(s.sms_api_key ? { authorization: `Bearer ${s.sms_api_key}` } : {}),
      },
      body: JSON.stringify({ to: args.to, message: args.body, from: s.sms_sender || undefined }),
    });
    if (!res.ok) {
      return { ok: false, simulated: false, error: `SMS API HTTP ${res.status}` };
    }
    return { ok: true, simulated: false };
  } catch (e) {
    return { ok: false, simulated: false, error: e instanceof Error ? e.message : "Błąd API SMS" };
  }
}
