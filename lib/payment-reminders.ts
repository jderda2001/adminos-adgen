// Sekwencja przypomnień o płatnościach faktur (czysty silnik, testowany).
//
// Kroki wyliczane z dueDate faktury. Model „kolejka z akceptacją": cron kolejkuje
// należny krok, admin wysyła ręcznie z osi czasu. Zasada „tylko najświeższy":
// jeśli dzień kroku minął, aktualny jest krok o NAJWIĘKSZYM offsecie ≤ dni-od-
// terminu; wcześniejsze niewykonane oznaczamy jako pominięte (bez serii wiadomości).
// Zatrzymanie sekwencji z chwilą opłacenia faktury (paid) lub pauzy (enabled=false).

import { formatDate, formatMoney } from "./format";

export type ReminderChannel = "SMS" | "EMAIL" | "PHONE";
export type ReminderStatus =
  | "QUEUED" // zakolejkowany, czeka na wysłanie przez admina
  | "SENT" // wysłany realnie
  | "SIMULATED" // „wysłany" w trybie symulacji (nic nie wyszło)
  | "SKIPPED" // pominięty (starszy krok / opłacono / pauza)
  | "FAILED" // błąd wysyłki
  | "DONE"; // wykonano (telefon)

export const CHANNEL_LABELS: Record<ReminderChannel, string> = {
  SMS: "SMS",
  EMAIL: "E-mail",
  PHONE: "Telefon",
};

export const REMINDER_STATUS_LABELS: Record<ReminderStatus, string> = {
  QUEUED: "Do wysłania",
  SENT: "Wysłane",
  SIMULATED: "Symulacja",
  SKIPPED: "Pominięte",
  FAILED: "Błąd",
  DONE: "Wykonano",
};

export interface ReminderStep {
  key: string; // "D-1" | "D0" | "D+1" | "D+2" | "D+3"
  offset: number; // dni względem dueDate faktury
  channels: ReminderChannel[];
  label: string; // etykieta w osi czasu
  isPhone: boolean; // krok z akcją telefoniczną (ręczny)
}

// Sekwencja wg procedury administracji adGen. KOLEJNOŚĆ = rosnący offset.
export const REMINDER_STEPS: readonly ReminderStep[] = [
  { key: "D-1", offset: -1, channels: ["SMS", "EMAIL"], label: "Dzień przed terminem", isPhone: false },
  { key: "D0", offset: 0, channels: ["SMS", "EMAIL"], label: "Dzień płatności", isPhone: false },
  { key: "D+1", offset: 1, channels: ["SMS", "EMAIL"], label: "1 dzień po terminie", isPhone: false },
  { key: "D+2", offset: 2, channels: ["PHONE"], label: "Telefon administracji (2 dni po terminie)", isPhone: true },
  { key: "D+3", offset: 3, channels: ["SMS", "EMAIL", "PHONE"], label: "3 dni po terminie", isPhone: true },
] as const;

export const REMINDER_STEP_BY_KEY: Record<string, ReminderStep> = Object.fromEntries(
  REMINDER_STEPS.map((s) => [s.key, s])
);

interface ReminderTemplate {
  sms?: string;
  emailSubject?: string;
  emailBody?: string;
  phoneInstruction?: string;
}

// Treści wg procedury. Placeholdery {kwota} (brutto do zapłaty) i {termin}
// (data płatności) są ZAWSZE podstawiane przez renderReminderMessage — każda
// wiadomość (SMS/e-mail) niesie kwotę i termin, żeby całość była zautomatyzowana.
export const REMINDER_TEMPLATES: Record<string, ReminderTemplate> = {
  "D-1": {
    sms: "Przypominamy: termin płatności faktury na kwotę {kwota} upływa jutro ({termin}). Prosimy o terminową wpłatę. Pozdrawiamy, Zespół adGen",
    emailSubject: "Przypomnienie — termin płatności {termin} | adGen",
    emailBody:
      "Dzień dobry,\n\nprzypominamy, że termin płatności faktury na kwotę {kwota} upływa jutro, {termin}. Będziemy wdzięczni za terminową wpłatę, co pozwoli nam na sprawne planowanie dalszych działań i prac.",
  },
  "D0": {
    sms: "Dzisiaj ({termin}) upływa termin płatności faktury na kwotę {kwota}. Prosimy o wykonanie przelewu w dniu dzisiejszym. Dziękujemy, Zespół adGen",
    emailSubject: "Dzisiaj mija termin płatności ({termin}) | adGen",
    emailBody:
      "Dzień dobry,\n\ninformujemy, że dziś, {termin}, upływa termin płatności faktury na kwotę {kwota}. Uprzejmie prosimy o uregulowanie należności. Jeśli dokonali już Państwo przelewu, prosimy o przesłanie potwierdzenia w wiadomości zwrotnej – pozwoli to uniknąć automatycznych powiadomień o zaległościach.",
  },
  "D+1": {
    sms: "Nie odnotowaliśmy płatności faktury na kwotę {kwota}, której termin upłynął {termin}. Prosimy o pilną wpłatę i przesłanie potwierdzenia przelewu. Pozdrawiamy, Zespół adGen",
    emailSubject: "Termin płatności ({termin}) upłynął | adGen",
    emailBody:
      "Dzień dobry,\n\nodnotowaliśmy, że termin płatności faktury na kwotę {kwota} upłynął {termin}, a środki nie zostały jeszcze zaksięgowane na naszym koncie. Prosimy o pilną weryfikację statusu płatności. Jeśli przelew został już zlecony, prosimy o przesłanie potwierdzenia. W razie trudności — zapraszamy do kontaktu.",
  },
  "D+2": {
    phoneInstruction:
      "Kwota do zapłaty: {kwota}, termin płatności był {termin}. Telefon z działu administracyjnego: pytanie o aktualny status płatności i termin spodziewanego przelewu. Rozmowa stanowcza, ale miła: podkreślić upływ terminu, poprosić o potwierdzenie przelewu jeśli wykonany. Jeśli nie — obligować do płatności i poprosić o dokładny termin oraz godzinę, w której wpłyną środki lub zostanie wysłane potwierdzenie z bankowości elektronicznej.",
  },
  "D+3": {
    sms: "Faktura na kwotę {kwota} (termin {termin}) pozostaje nieopłacona. Prosimy o niezwłoczne uregulowanie należności, aby uniknąć opóźnień w obsłudze. Pozdrawiamy, Zespół adGen",
    emailSubject: "Zaległość w płatności — prośba o pilną wpłatę | adGen",
    emailBody:
      "Dzień dobry,\n\nfaktura na kwotę {kwota} z terminem płatności {termin} pozostaje nieopłacona, a środki nie zostały zaksięgowane na naszym koncie. Prosimy o niezwłoczne uregulowanie należności lub kontakt, jeśli istnieją powody opóźnienia, o których powinniśmy wiedzieć. Zależy nam na wyjaśnieniu tej sprawy bez wdrażania dalszych procedur windykacyjnych.",
    phoneInstruction:
      "Kwota do zapłaty: {kwota}, termin płatności był {termin}. Ponowny kontakt z działu administracyjno-prawnego: pytanie o status i czas przelewu. Podkreślić, że termin minął. Stanowczo (ale miło) obligować do płatności i żądać konkretnej godziny przelewu. Kluczowe: odnieść się do wcześniejszej rozmowy, w której klient zobowiązał się do wpłaty — wytknąć niedotrzymanie ustaleń.",
  },
};

/** Kontekst do podstawienia w treści: kwota brutto do zapłaty + termin płatności. */
export interface ReminderContext {
  amountGr: number; // brutto do zapłaty
  dueDate: Date; // termin płatności
}

function fill(text: string, ctx?: ReminderContext): string {
  const kwota = ctx ? formatMoney(ctx.amountGr) : "—";
  const termin = ctx ? formatDate(ctx.dueDate) : "—";
  return text.replace(/\{kwota\}/g, kwota).replace(/\{termin\}/g, termin);
}

/** Wyrenderowana wiadomość dla danego kroku i kanału. {kwota}/{termin} podstawiane
 * z ctx; do e-maila doklejamy stopkę. */
export function renderReminderMessage(
  stepKey: string,
  channel: ReminderChannel,
  opts?: { emailFooter?: string; ctx?: ReminderContext }
): { subject: string | null; body: string } {
  const t = REMINDER_TEMPLATES[stepKey] ?? {};
  const ctx = opts?.ctx;
  if (channel === "SMS") return { subject: null, body: fill(t.sms ?? "", ctx) };
  if (channel === "PHONE") return { subject: null, body: fill(t.phoneInstruction ?? "", ctx) };
  const footer = opts?.emailFooter ? `\n\n—\n${opts.emailFooter}` : "";
  return { subject: fill(t.emailSubject ?? "", ctx), body: fill(t.emailBody ?? "", ctx) + footer };
}

// ── Wyliczanie osi czasu ─────────────────────────────────────────────

const DAY_MS = 86_400_000;
function dayOnly(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}
/** Data przesunięta o `n` dni (na północy UTC). */
export function addDaysUTC(d: Date, n: number): Date {
  return new Date(dayOnly(d) + n * DAY_MS);
}
/** Liczba pełnych dni od `from` do `to` (data-tylko, UTC). */
export function daysBetweenUTC(from: Date, to: Date): number {
  return Math.round((dayOnly(to) - dayOnly(from)) / DAY_MS);
}

/** Krok „aktualny" dla danej liczby dni od terminu: największy offset ≤ dni.
 * null gdy nic jeszcze nie przypada (przed D-1). */
export function currentStepFor(daysFromDue: number): ReminderStep | null {
  let found: ReminderStep | null = null;
  for (const s of REMINDER_STEPS) {
    if (s.offset <= daysFromDue) found = s;
  }
  return found;
}

export interface ExistingReminder {
  stepKey: string;
  channel: ReminderChannel;
  status: ReminderStatus;
  sentAt?: string | null;
  note?: string | null;
  actedByName?: string | null;
}

export type DisplayStatus = ReminderStatus | "PENDING"; // PENDING = jeszcze nie czas

export interface TimelineChannel {
  channel: ReminderChannel;
  status: DisplayStatus;
  actionable: boolean; // pokazać „Wyślij"/„Oznacz wykonany"
  sentAt: string | null;
  note: string | null;
  actedByName: string | null;
}
export interface TimelineStep {
  key: string;
  label: string;
  offset: number;
  dateIso: string; // dueDate + offset
  isPhone: boolean;
  isCurrent: boolean;
  channels: TimelineChannel[];
}
export interface ReminderTimeline {
  steps: TimelineStep[];
  currentStepKey: string | null;
  daysFromDue: number;
  stopped: boolean; // opłacona lub pauza
}

/**
 * Oś czasu przypomnień dla faktury. Łączy istniejące wpisy (co realnie wysłano)
 * z wyliczonym stanem domyślnym. „Tylko najświeższy": aktualny jest jeden krok;
 * starsze niewykonane → SKIPPED, przyszłe → PENDING. Gdy stopped (opłacona/pauza)
 * nic nie jest actionable, a niewysłane kroki pokazujemy jako SKIPPED/PENDING.
 */
export function buildReminderTimeline(
  dueDate: Date,
  today: Date,
  existing: readonly ExistingReminder[],
  opts: { paid: boolean; enabled: boolean }
): ReminderTimeline {
  const daysFromDue = daysBetweenUTC(dueDate, today);
  const stopped = opts.paid || !opts.enabled;
  const current = stopped ? null : currentStepFor(daysFromDue);
  const currentOffset = current?.offset ?? Number.NEGATIVE_INFINITY;

  const findRow = (stepKey: string, channel: ReminderChannel) =>
    existing.find((e) => e.stepKey === stepKey && e.channel === channel);

  const steps: TimelineStep[] = REMINDER_STEPS.map((step) => {
    const isCurrent = current?.key === step.key;
    const channels: TimelineChannel[] = step.channels.map((channel) => {
      const row = findRow(step.key, channel);
      if (row) {
        // istnieje wpis — pokaż jego status; actionable tylko gdy wciąż QUEUED,
        // to aktualny krok i sekwencja nie jest zatrzymana
        const actionable = !stopped && row.status === "QUEUED" && isCurrent;
        return {
          channel,
          status: row.status,
          actionable,
          sentAt: row.sentAt ?? null,
          note: row.note ?? null,
          actedByName: row.actedByName ?? null,
        };
      }
      // brak wpisu — stan wyliczony
      let status: DisplayStatus;
      let actionable = false;
      if (stopped) {
        status = step.offset <= daysFromDue ? "SKIPPED" : "PENDING";
      } else if (isCurrent) {
        status = "QUEUED";
        actionable = true; // można wysłać/oznaczyć od ręki
      } else if (step.offset < currentOffset) {
        status = "SKIPPED"; // starszy, niewykonany → pominięty
      } else {
        status = "PENDING"; // przyszły
      }
      return { channel, status, actionable, sentAt: null, note: null, actedByName: null };
    });
    return {
      key: step.key,
      label: step.label,
      offset: step.offset,
      dateIso: addDaysUTC(dueDate, step.offset).toISOString(),
      isPhone: step.isPhone,
      isCurrent,
      channels,
    };
  });

  return { steps, currentStepKey: current?.key ?? null, daysFromDue, stopped };
}
