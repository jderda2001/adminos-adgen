"use client";

// Oś czasu przypomnień o płatności w szczegółach pozycji — pionowy „rail" z
// kropkami statusu. Jeden wiersz na krok; akcje (Wyślij / Oznacz wykonany) tylko
// przy kroku AKTUALNYM, treść wiadomości schowana pod przełącznikiem „Podgląd".

import { useState, useTransition } from "react";
import { Mail, MessageSquare, Phone, Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/action-result";
import {
  buildReminderTimeline,
  renderReminderMessage,
  CHANNEL_LABELS,
  type ReminderChannel,
  type ExistingReminder,
  type TimelineStep,
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

type StepState = "done" | "current" | "skipped" | "pending";
function stepState(step: TimelineStep): StepState {
  if (step.isCurrent) return "current";
  if (step.channels.some((c) => ["SENT", "SIMULATED", "DONE"].includes(c.status))) return "done";
  if (step.channels.some((c) => c.status === "SKIPPED")) return "skipped";
  return "pending";
}

const DOT: Record<StepState, string> = {
  done: "bg-emerald-500",
  current: "bg-primary ring-4 ring-primary/15",
  skipped: "bg-muted-foreground/30",
  pending: "border border-border bg-card",
};

export interface ReminderTimelineProps {
  invoiceId: string;
  dueDateIso: string;
  grossGr: number;
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
  grossGr,
  status,
  remindersEnabled,
  reminders,
  todayIso,
  clientHasEmail,
  clientHasPhone,
}: ReminderTimelineProps) {
  const [pending, startTransition] = useTransition();
  const [noteOpen, setNoteOpen] = useState(false); // edytor notatki telefonu (krok aktualny)
  const [noteText, setNoteText] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  const msgCtx = { amountGr: grossGr, dueDate: new Date(dueDateIso) };
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

  function missing(channel: ReminderChannel) {
    return (channel === "SMS" && !clientHasPhone) || (channel === "EMAIL" && !clientHasEmail);
  }

  return (
    <div className="mt-4 border-t pt-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Przypomnienia o płatności</h4>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {remindersEnabled ? "Automatyzacja wł." : "Wstrzymana"}
          <Switch
            checked={remindersEnabled}
            disabled={pending || paid}
            onCheckedChange={(v) => run(() => toggleInvoiceRemindersAction(invoiceId, v))}
          />
        </label>
      </div>

      {paid && (
        <div className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
          Faktura opłacona — automatyzacja wstrzymana.
        </div>
      )}

      <ol>
        {tl.steps.map((step, i) => {
          const state = stepState(step);
          const last = i === tl.steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3">
              {/* rail: kropka + linia */}
              <div className="flex flex-col items-center pt-1">
                <span className={cn("size-2.5 shrink-0 rounded-full", DOT[state])} />
                {!last && <span className="mt-1 w-px flex-1 bg-border" />}
              </div>

              <div className={cn("flex-1", last ? "pb-0" : "pb-5")}>
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className={cn(
                      "text-sm",
                      step.isCurrent ? "font-semibold" : "font-medium text-muted-foreground"
                    )}
                  >
                    {step.label}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {formatDate(new Date(step.dateIso))}
                  </span>
                </div>

                {/* kanały */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                  {step.channels.map((ch) => {
                    const Icon = CHANNEL_ICON[ch.channel];
                    const acted = ["SENT", "SIMULATED", "DONE"].includes(ch.status);
                    // krok aktualny → akcja
                    if (step.isCurrent && ch.actionable) {
                      if (ch.channel === "PHONE") {
                        return (
                          <Button
                            key={ch.channel}
                            size="xs"
                            variant="outline"
                            disabled={pending || noteOpen}
                            onClick={() => {
                              setNoteOpen(true);
                              setNoteText("");
                            }}
                          >
                            <Phone data-icon="inline-start" /> Oznacz telefon
                          </Button>
                        );
                      }
                      return (
                        <span key={ch.channel} className="inline-flex flex-col">
                          <Button
                            size="xs"
                            disabled={pending || missing(ch.channel)}
                            title={missing(ch.channel) ? "Uzupełnij dane kontaktowe klienta" : undefined}
                            onClick={() =>
                              run(() =>
                                sendReminderStepAction({ invoiceId, stepKey: step.key, channel: ch.channel })
                              )
                            }
                          >
                            <Icon data-icon="inline-start" /> Wyślij {CHANNEL_LABELS[ch.channel]}
                          </Button>
                          {missing(ch.channel) && (
                            <span className="mt-0.5 text-[10px] text-amber-600 dark:text-amber-400">
                              brak {ch.channel === "SMS" ? "telefonu" : "e-maila"}
                            </span>
                          )}
                        </span>
                      );
                    }
                    // wysłane/wykonane → zielony ptaszek
                    if (acted) {
                      return (
                        <span key={ch.channel} className="inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                          <Check className="size-3.5" />
                          {CHANNEL_LABELS[ch.channel]}
                          {ch.status === "SIMULATED" && " (symulacja)"}
                          {ch.sentAt && (
                            <span className="text-muted-foreground"> · {formatDate(new Date(ch.sentAt))}</span>
                          )}
                        </span>
                      );
                    }
                    // pominięte / zaplanowane → wyszarzone
                    return (
                      <span
                        key={ch.channel}
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground/70"
                      >
                        <Icon className="size-3.5" />
                        {CHANNEL_LABELS[ch.channel]}
                      </span>
                    );
                  })}
                  {!step.isCurrent && state === "pending" && (
                    <span className="text-xs text-muted-foreground/60">· zaplanowane</span>
                  )}
                  {!step.isCurrent && state === "skipped" && (
                    <span className="text-xs text-muted-foreground/60">· pominięte</span>
                  )}
                </div>

                {/* notatka z wykonanego telefonu */}
                {step.channels.find((c) => c.channel === "PHONE")?.note && !step.isCurrent && (
                  <p className="mt-1 whitespace-pre-line text-[11px] leading-snug text-muted-foreground">
                    Notatka: {step.channels.find((c) => c.channel === "PHONE")?.note}
                  </p>
                )}

                {/* AKTUALNY krok: podgląd treści (chowany) + edytor notatki telefonu */}
                {step.isCurrent && (
                  <div className="mt-2 space-y-2">
                    {!noteOpen &&
                      step.channels.some((c) => c.actionable && c.channel !== "PHONE") && (
                        <button
                          type="button"
                          onClick={() => setShowPreview((v) => !v)}
                          className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          {showPreview ? "Ukryj treść" : "Podgląd treści"}
                        </button>
                      )}
                    {showPreview && !noteOpen && (
                      <div className="space-y-2 rounded-lg bg-muted/40 p-2.5">
                        {step.channels
                          .filter((c) => c.channel !== "PHONE")
                          .map((c) => {
                            const m = renderReminderMessage(step.key, c.channel, { ctx: msgCtx });
                            return (
                              <div key={c.channel} className="text-[11px] leading-snug">
                                <div className="mb-0.5 font-medium text-muted-foreground">
                                  {CHANNEL_LABELS[c.channel]}
                                  {m.subject ? ` — ${m.subject}` : ""}
                                </div>
                                <div className="whitespace-pre-line text-foreground/80">{m.body}</div>
                              </div>
                            );
                          })}
                      </div>
                    )}
                    {/* instrukcja telefonu (gdy krok telefoniczny) */}
                    {step.isPhone && !noteOpen && (
                      <p className="whitespace-pre-line text-[11px] leading-snug text-muted-foreground">
                        {renderReminderMessage(step.key, "PHONE", { ctx: msgCtx }).body}
                      </p>
                    )}
                    {noteOpen && (
                      <div className="space-y-2">
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
                                if (r.ok) setNoteOpen(false);
                                return r;
                              })
                            }
                          >
                            Zapisz
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setNoteOpen(false)}>
                            Anuluj
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
