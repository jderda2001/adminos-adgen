"use client";

// Oś czasu sekwencji przypomnień o płatności w szczegółach pozycji przychodu.
// Pokazuje 5 kroków (SMS/e-mail/telefon) z terminami i statusem; dla aktualnego
// kroku pozwala wysłać (SMS/e-mail) lub oznaczyć telefon jako wykonany. Wysyłka
// zależy od trybu (symulacja/na żywo) — logika po stronie serwera (notify).

import { useState, useTransition } from "react";
import { Mail, MessageSquare, Phone } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import type { ActionResult } from "@/lib/action-result";
import {
  buildReminderTimeline,
  renderReminderMessage,
  CHANNEL_LABELS,
  REMINDER_STATUS_LABELS,
  type ReminderChannel,
  type ReminderStatus,
  type DisplayStatus,
  type ExistingReminder,
} from "@/lib/payment-reminders";
import {
  markPhoneStepDoneAction,
  sendReminderStepAction,
  toggleInvoiceRemindersAction,
} from "./reminder-actions";

const CHANNEL_ICON: Record<ReminderChannel, typeof Mail> = {
  SMS: MessageSquare,
  EMAIL: Mail,
  PHONE: Phone,
};

function toneFor(s: DisplayStatus): StatusTone {
  switch (s) {
    case "SENT":
    case "DONE":
      return "green";
    case "SIMULATED":
      return "blue";
    case "QUEUED":
      return "amber";
    case "FAILED":
      return "red";
    default:
      return "neutral"; // SKIPPED, PENDING
  }
}
function statusLabel(s: DisplayStatus): string {
  return s === "PENDING" ? "Zaplanowane" : REMINDER_STATUS_LABELS[s as ReminderStatus];
}

export interface ReminderTimelineProps {
  invoiceId: string;
  dueDateIso: string;
  status: string; // status faktury (PAID → sekwencja wstrzymana)
  remindersEnabled: boolean;
  reminders: ExistingReminder[];
  todayIso: string;
  clientHasEmail: boolean;
  clientHasPhone: boolean;
}

export function ReminderTimeline({
  invoiceId,
  dueDateIso,
  status,
  remindersEnabled,
  reminders,
  todayIso,
  clientHasEmail,
  clientHasPhone,
}: ReminderTimelineProps) {
  const [pending, startTransition] = useTransition();
  const [noteFor, setNoteFor] = useState<string | null>(null); // stepKey telefonu w edycji
  const [noteText, setNoteText] = useState("");

  const paid = status === "PAID";
  const tl = buildReminderTimeline(new Date(dueDateIso), new Date(todayIso), reminders, {
    paid,
    enabled: remindersEnabled,
  });

  function run(action: () => Promise<ActionResult>) {
    startTransition(async () => {
      const r = await action();
      if (r.ok) toast.success(r.message);
      else toast.error(r.error);
    });
  }

  return (
    <div className="mt-4 border-t pt-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Przypomnienia o płatności</h4>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {remindersEnabled ? "Automatyzacja wł." : "Wstrzymana"}
          <Switch
            checked={remindersEnabled}
            disabled={pending || paid}
            onCheckedChange={(v) =>
              run(() => toggleInvoiceRemindersAction(invoiceId, v))
            }
          />
        </label>
      </div>

      {paid && (
        <div className="mb-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/30 dark:text-emerald-300">
          Faktura opłacona — automatyzacja przypomnień wstrzymana.
        </div>
      )}

      <ol className="space-y-3">
        {tl.steps.map((step) => (
          <li
            key={step.key}
            className={
              "rounded-xl border p-3 " +
              (step.isCurrent
                ? "border-primary/40 bg-primary/5"
                : "border-border/60 bg-card")
            }
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{step.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatDate(new Date(step.dateIso))}
              </span>
            </div>

            <div className="mt-2 space-y-2">
              {step.channels.map((ch) => {
                const Icon = CHANNEL_ICON[ch.channel];
                const preview =
                  ch.actionable && ch.channel !== "PHONE"
                    ? renderReminderMessage(step.key, ch.channel)
                    : null;
                const phoneInstruction =
                  ch.actionable && ch.channel === "PHONE"
                    ? renderReminderMessage(step.key, "PHONE").body
                    : null;
                const missingContact =
                  (ch.channel === "SMS" && !clientHasPhone) ||
                  (ch.channel === "EMAIL" && !clientHasEmail);
                return (
                  <div key={ch.channel} className="rounded-lg bg-muted/40 px-2.5 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Icon className="size-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium">{CHANNEL_LABELS[ch.channel]}</span>
                      <StatusBadge tone={toneFor(ch.status)} className="text-[10px]">
                        {statusLabel(ch.status)}
                      </StatusBadge>
                      {ch.sentAt && (
                        <span className="text-[11px] text-muted-foreground">
                          {formatDate(new Date(ch.sentAt))}
                          {ch.actedByName ? ` · ${ch.actedByName}` : ""}
                        </span>
                      )}
                      {ch.actionable && ch.channel !== "PHONE" && (
                        <Button
                          size="sm"
                          className="ml-auto h-7"
                          disabled={pending || missingContact}
                          title={missingContact ? "Uzupełnij dane kontaktowe klienta" : undefined}
                          onClick={() =>
                            run(() =>
                              sendReminderStepAction({
                                invoiceId,
                                stepKey: step.key,
                                channel: ch.channel,
                              })
                            )
                          }
                        >
                          Wyślij
                        </Button>
                      )}
                      {ch.actionable && ch.channel === "PHONE" && noteFor !== step.key && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto h-7"
                          disabled={pending}
                          onClick={() => {
                            setNoteFor(step.key);
                            setNoteText("");
                          }}
                        >
                          Oznacz wykonany
                        </Button>
                      )}
                    </div>

                    {missingContact && ch.actionable && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        Brak {ch.channel === "SMS" ? "numeru telefonu" : "adresu e-mail"} klienta.
                      </p>
                    )}
                    {preview && (
                      <div className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                        {preview.subject && (
                          <div className="font-medium text-foreground/70">{preview.subject}</div>
                        )}
                        <div className="whitespace-pre-line">{preview.body}</div>
                      </div>
                    )}
                    {phoneInstruction && noteFor !== step.key && (
                      <p className="mt-1.5 whitespace-pre-line text-[11px] leading-snug text-muted-foreground">
                        {phoneInstruction}
                      </p>
                    )}
                    {ch.note && !ch.actionable && (
                      <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-muted-foreground">
                        {ch.channel === "PHONE" ? "Notatka: " : ""}
                        {ch.note}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* edytor notatki telefonu */}
            {noteFor === step.key && (
              <div className="mt-2 space-y-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Notatka z rozmowy (opcjonalna): ustalony termin, deklaracje klienta…"
                  rows={3}
                  className="text-xs"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="h-7"
                    disabled={pending}
                    onClick={() =>
                      run(async () => {
                        const r = await markPhoneStepDoneAction({
                          invoiceId,
                          stepKey: step.key,
                          note: noteText,
                        });
                        if (r.ok) setNoteFor(null);
                        return r;
                      })
                    }
                  >
                    Zapisz
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => setNoteFor(null)}
                  >
                    Anuluj
                  </Button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
