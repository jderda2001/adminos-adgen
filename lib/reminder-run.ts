// Silnik kolejkowania przypomnień o płatnościach (cron, „kolejka z akceptacją").
// Dla faktur w zakresie (Wystawiona/Przeterminowana, remindersEnabled, nie
// opłacone) ustala KROK AKTUALNY (tylko najświeższy) i zakłada dla jego kanałów
// wiersze QUEUED. Zdezaktualizowane QUEUED (z wcześniejszego kroku) → SKIPPED.
// NIE wysyła — wysyłkę robi admin ręcznie z osi czasu (reminder-actions.ts).

import { db } from "@/lib/db";
import { addDaysUTC, currentStepFor, daysBetweenUTC } from "@/lib/payment-reminders";

const SCOPE_STATUSES = ["ISSUED", "OVERDUE"] as const;

export interface ReminderRunSummary {
  scanned: number; // faktury w zakresie
  queued: number; // nowe wiersze QUEUED
  superseded: number; // stare QUEUED oznaczone SKIPPED
}

export async function runPaymentReminders(today: Date): Promise<ReminderRunSummary> {
  const invoices = await db.invoice.findMany({
    where: { status: { in: [...SCOPE_STATUSES] }, remindersEnabled: true },
    select: { id: true, dueDate: true, reminders: true },
  });

  let queued = 0;
  let superseded = 0;

  for (const inv of invoices) {
    const daysFromDue = daysBetweenUTC(inv.dueDate, today);
    const current = currentStepFor(daysFromDue); // null przed D-1

    // 1) zdezaktualizowane QUEUED (inny krok niż aktualny) → SKIPPED
    for (const r of inv.reminders) {
      if (r.status === "QUEUED" && r.stepKey !== current?.key) {
        await db.invoiceReminder.update({
          where: { id: r.id },
          data: { status: "SKIPPED", note: "pominięte — nowszy krok sekwencji" },
        });
        superseded += 1;
      }
    }

    if (!current) continue; // jeszcze nic nie przypada (przed D-1)

    // 2) załóż QUEUED dla kanałów aktualnego kroku, których jeszcze nie ma
    const dueOn = addDaysUTC(inv.dueDate, current.offset);
    for (const channel of current.channels) {
      const exists = inv.reminders.some(
        (r) => r.stepKey === current.key && r.channel === channel
      );
      if (exists) continue;
      await db.invoiceReminder.create({
        data: { invoiceId: inv.id, stepKey: current.key, channel, dueOn, status: "QUEUED" },
      });
      queued += 1;
    }
  }

  return { scanned: invoices.length, queued, superseded };
}
