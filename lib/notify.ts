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

/** Numer w formacie akceptowanym przez smsplanet: cyfry z kodem kraju (bez +). */
function normalizeMsisdn(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  return digits; // np. "+48 500 600 700" → "48500600700"
}

// SMS przez smsplanet.pl (API2, uwierzytelnienie Bearer). Endpoint w ustawieniu
// sms_api_url (domyślnie https://api2.smsplanet.pl/sms). Pola: from (zarejestrowany
// nadawca), to, msg. Odpowiedź 2xx = przyjęto; body zawiera messageId lub errorMsg.
export async function sendSms(args: { to: string; body: string }): Promise<NotifyResult> {
  const s = await getSettings();
  if (s.notify_mode !== "live") return { ok: true, simulated: true };
  const url = s.sms_api_url || "https://api2.smsplanet.pl/sms";
  if (!s.sms_api_key) {
    return { ok: false, simulated: false, error: "Brak klucza API SMS (smsplanet)" };
  }
  if (!s.sms_sender) {
    return { ok: false, simulated: false, error: "Brak nadawcy SMS (zarejestrowany w smsplanet)" };
  }
  try {
    const form = new URLSearchParams({
      from: s.sms_sender,
      to: normalizeMsisdn(args.to),
      msg: args.body,
    });
    const res = await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${s.sms_api_key}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    const text = await res.text();
    // smsplanet zwraca JSON; błąd sygnalizuje polem errorMsg/errorCode nawet przy 200
    if (!res.ok || /error/i.test(text)) {
      return { ok: false, simulated: false, error: `smsplanet: ${text.slice(0, 200)}` };
    }
    return { ok: true, simulated: false };
  } catch (e) {
    return { ok: false, simulated: false, error: e instanceof Error ? e.message : "Błąd API SMS" };
  }
}
