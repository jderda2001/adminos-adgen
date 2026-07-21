"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { getSettings } from "@/lib/settings";
import { sendEmail, sendSms } from "@/lib/notify";
import { renderReminderEmailHtml } from "@/lib/email-template";
import { readAttachmentBuffer, readEmailLogo } from "@/lib/attachments";
import { formatDate, formatMoney } from "@/lib/format";
import {
  REMINDER_STEP_BY_KEY,
  renderReminderMessage,
  type ReminderChannel,
} from "@/lib/payment-reminders";

const CHANNELS = ["SMS", "EMAIL", "PHONE"] as const;
const stepChannelSchema = z.object({
  invoiceId: z.string().trim().min(1),
  stepKey: z.string().trim().min(1),
  channel: z.enum(CHANNELS),
});

/** Wyślij (SMS/e-mail) należny krok. W trybie symulacji zapisuje SIMULATED. */
export async function sendReminderStepAction(input: {
  invoiceId: string;
  stepKey: string;
  channel: ReminderChannel;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const parsed = stepChannelSchema.safeParse(input);
  if (!parsed.success) return fail("Nieprawidłowe dane kroku");
  const { invoiceId, stepKey, channel } = parsed.data;
  if (channel === "PHONE") return fail("Telefon oznacz jako wykonany, nie wysyłaj");

  const step = REMINDER_STEP_BY_KEY[stepKey];
  if (!step || !step.channels.includes(channel)) return fail("Ten krok nie ma tego kanału");

  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    include: { client: true },
  });
  if (!invoice) return fail("Pozycja nie istnieje");
  if (invoice.status === "PAID") return fail("Faktura opłacona — sekwencja wstrzymana");
  if (!invoice.remindersEnabled) return fail("Przypomnienia dla tej faktury są wstrzymane");

  const to = channel === "SMS" ? invoice.client?.phone : invoice.client?.email;
  if (!to) {
    return fail(
      channel === "SMS"
        ? "Klient nie ma numeru telefonu (uzupełnij w Klientach)"
        : "Klient nie ma adresu e-mail (uzupełnij w Klientach)"
    );
  }

  const settings = await getSettings();
  const footer = [settings.company_name, settings.company_address, settings.reminder_email_footer]
    .filter(Boolean)
    .join("\n");
  // kwota brutto + termin płatności trafiają do KAŻDEJ treści (SMS/e-mail)
  const ctx = { amountGr: invoice.grossGr, dueDate: invoice.dueDate };
  // wersja tekstowa (fallback + snapshot w bazie) — z doklejoną stopką
  const msg = renderReminderMessage(stepKey, channel, { emailFooter: footer, ctx });

  let result;
  if (channel === "SMS") {
    result = await sendSms({ to, body: msg.body });
  } else {
    // e-mail: brandowany HTML (styl Apple, logo inline) + załącznik faktury
    const raw = renderReminderMessage(stepKey, "EMAIL", { ctx }); // treść bez stopki
    const file = await readAttachmentBuffer(invoice.attachmentPath, invoice.attachmentName);
    const logo = await readEmailLogo();
    const LOGO_CID = "adgen-logo";
    const html = renderReminderEmailHtml({
      subject: raw.subject ?? "",
      bodyText: raw.body,
      footerText: footer,
      hasAttachment: Boolean(file),
      amountText: formatMoney(invoice.grossGr),
      dueText: formatDate(invoice.dueDate),
      logoCid: logo ? LOGO_CID : undefined,
    });
    const attachments = [
      ...(logo
        ? [{ filename: "adgen-logo.png", content: logo, contentType: "image/png", cid: LOGO_CID }]
        : []),
      ...(file
        ? [{ filename: file.filename, content: file.buffer, contentType: file.contentType }]
        : []),
    ];
    result = await sendEmail({
      to,
      subject: msg.subject ?? "",
      body: msg.body,
      html,
      attachments: attachments.length ? attachments : undefined,
    });
  }

  const status = !result.ok ? "FAILED" : result.simulated ? "SIMULATED" : "SENT";
  const data = {
    invoiceId,
    stepKey,
    channel,
    dueOn: addOffset(invoice.dueDate, step.offset),
    status,
    toAddress: to,
    subject: msg.subject,
    body: msg.body,
    note: result.error ?? null,
    actedByName: me.name,
    sentAt: new Date(),
  };
  // upsert po kluczu (invoiceId, stepKey, channel)
  await db.invoiceReminder.upsert({
    where: { invoiceId_stepKey_channel: { invoiceId, stepKey, channel } },
    create: data,
    update: { status, toAddress: to, subject: msg.subject, body: msg.body, note: result.error ?? null, actedByName: me.name, sentAt: new Date() },
  });

  revalidatePath("/finanse/przychody");
  if (!result.ok) return fail(`Nie udało się wysłać: ${result.error ?? "błąd"}`);
  return ok(result.simulated ? "Zapisano (symulacja — nic nie wysłano)" : "Wysłano");
}

/** Oznacz krok telefoniczny jako wykonany (z opcjonalną notatką). */
export async function markPhoneStepDoneAction(input: {
  invoiceId: string;
  stepKey: string;
  note?: string;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  const parsed = z
    .object({ invoiceId: z.string().min(1), stepKey: z.string().min(1), note: z.string().optional() })
    .safeParse(input);
  if (!parsed.success) return fail("Nieprawidłowe dane");
  const { invoiceId, stepKey, note } = parsed.data;

  const step = REMINDER_STEP_BY_KEY[stepKey];
  if (!step?.channels.includes("PHONE")) return fail("Ten krok nie jest telefoniczny");
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return fail("Pozycja nie istnieje");

  await db.invoiceReminder.upsert({
    where: { invoiceId_stepKey_channel: { invoiceId, stepKey, channel: "PHONE" } },
    create: {
      invoiceId,
      stepKey,
      channel: "PHONE",
      dueOn: addOffset(invoice.dueDate, step.offset),
      status: "DONE",
      note: note?.trim() || null,
      actedByName: me.name,
      sentAt: new Date(),
    },
    update: { status: "DONE", note: note?.trim() || null, actedByName: me.name, sentAt: new Date() },
  });

  revalidatePath("/finanse/przychody");
  return ok("Oznaczono telefon jako wykonany");
}

/** Wstrzymaj/wznów sekwencję przypomnień dla faktury. */
export async function toggleInvoiceRemindersAction(
  invoiceId: string,
  enabled: boolean
): Promise<ActionResult> {
  await requireAdmin();
  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return fail("Pozycja nie istnieje");
  await db.invoice.update({ where: { id: invoiceId }, data: { remindersEnabled: enabled } });
  if (!enabled) {
    await db.invoiceReminder.updateMany({
      where: { invoiceId, status: "QUEUED" },
      data: { status: "SKIPPED", note: "wstrzymano ręcznie" },
    });
  }
  revalidatePath("/finanse/przychody");
  return ok(enabled ? "Wznowiono przypomnienia" : "Wstrzymano przypomnienia");
}

/** dzień kroku (data-tylko, UTC) = dueDate + offset */
function addOffset(dueDate: Date, offset: number): Date {
  const base = Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate());
  return new Date(base + offset * 86_400_000);
}
