// Sekwencja przypomnień o płatnościach faktur (czysty silnik, testowany).
//
// Kroki wyliczane z dueDate faktury. Model „kolejka z akceptacją": cron kolejkuje
// należny krok, admin wysyła ręcznie z osi czasu. Zasada „tylko najświeższy":
// jeśli dzień kroku minął, aktualny jest krok o NAJWIĘKSZYM offsecie ≤ dni-od-
// terminu; wcześniejsze niewykonane oznaczamy jako pominięte (bez serii wiadomości).
// Zatrzymanie sekwencji z chwilą opłacenia faktury (paid) lub pauzy (enabled=false).

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

// Treści dokładnie wg procedury (wersja klienta). Bez interpolacji danych
// wrażliwych — wiadomości są celowo ogólne („za fakturę").
export const REMINDER_TEMPLATES: Record<string, ReminderTemplate> = {
  "D-1": {
    sms: "Przypominamy, iż termin płatności faktury upływa jutro. Prosimy o terminową wpłatę, co pozwoli nam na sprawne planowanie dalszych prac. Pozdrawiamy, Zespół adGen",
    emailSubject: "Termin płatności mija jutro | adGen",
    emailBody:
      "Dzień dobry,\n\nchcielibyśmy przypomnieć, że termin płatności za fakturę upływa w dniu jutrzejszym. Będziemy wdzięczni za terminową wpłatę, co pozwoli nam na sprawne planowanie dalszych działań i prac.",
  },
  "D0": {
    sms: "Dzisiaj upływa termin płatności faktury. Prosimy o wykonanie przelewu w dniu dzisiejszym. Dziękujemy za terminowość. Pozdrawiamy, Zespół adGen",
    emailSubject: "Dzisiaj mija termin płatności | adGen",
    emailBody:
      "Dzień dobry,\n\ninformujemy, że w dniu dzisiejszym upływa termin płatności za fakturę. Uprzejmie prosimy o uregulowanie należności. Jeśli dokonali już Państwo przelewu, będziemy wdzięczni za przesłanie potwierdzenia w wiadomości zwrotnej – pozwoli to uniknąć automatycznych powiadomień o zaległościach.",
  },
  "D+1": {
    sms: "Informujemy, iż nie odnotowaliśmy płatności za fakturę, której termin upłynął w dniu dzisiejszym. Prosimy o weryfikację statusu płatności i przesłanie potwierdzenia przelewu. Pozdrawiamy, Zespół adGen",
    emailSubject: "Termin płatności faktury upłynął | adGen",
    emailBody:
      "Dzień dobry,\n\nodnotowaliśmy, że termin płatności faktury upłynął w dniu dzisiejszym, a środki nie zostały jeszcze zaksięgowane na naszym koncie. Prosimy o pilną weryfikację statusu płatności. Jeśli przelew został już zlecony, prosimy o przesłanie potwierdzenia. W przypadku jakichkolwiek trudności, zapraszamy do kontaktu.",
  },
  "D+2": {
    phoneInstruction:
      "Telefon z działu administracyjnego w sprawie płatności. Pytanie o aktualny status płatności i termin spodziewanego przelewu. Rozmowa stanowcza, ale miła: podkreślić upływ terminu, poprosić o potwierdzenie przelewu jeśli wykonany. Jeśli nie — obligować do płatności i poprosić o dokładny termin oraz godzinę w ciągu dnia, w której wpłyną środki lub zostanie wysłane potwierdzenie z bankowości elektronicznej.",
  },
  "D+3": {
    sms: "Informujemy, iż termin płatności faktury upłynął 2 dni temu. Prosimy o niezwłoczne uregulowanie należności w celu uniknięcia opóźnień w obsłudze. Pozdrawiamy, Zespół adGen",
    emailSubject: "Zaległość w płatności – prośba o pilną wpłatę | adGen",
    emailBody:
      "Dzień dobry,\n\nzwracamy uwagę na brak zaksięgowania płatności za fakturę, której termin upłynął 3 dni temu. Prosimy o niezwłoczne uregulowanie należności lub kontakt, jeśli istnieją powody opóźnienia, o których powinniśmy wiedzieć. Zależy nam na wyjaśnieniu tej sprawy bez konieczności wdrażania dalszych procedur windykacyjnych.",
    phoneInstruction:
      "Ponowny kontakt z działu administracyjno-prawnego. Pytanie o status i czas przelewu. Podkreślić, że minęły już 3 dni. Stanowczo (ale miło) obligować do płatności i żądać konkretnej godziny przelewu. Kluczowe: odnieść się do wczorajszej rozmowy, w której klient zobowiązał się do wpłaty — wytknąć niedotrzymanie ustaleń z pewnością siebie w głosie.",
  },
};

/** Wyrenderowana wiadomość dla danego kroku i kanału. Do e-maila doklejamy stopkę. */
export function renderReminderMessage(
  stepKey: string,
  channel: ReminderChannel,
  opts?: { emailFooter?: string }
): { subject: string | null; body: string } {
  const t = REMINDER_TEMPLATES[stepKey] ?? {};
  if (channel === "SMS") return { subject: null, body: t.sms ?? "" };
  if (channel === "PHONE") return { subject: null, body: t.phoneInstruction ?? "" };
  const footer = opts?.emailFooter ? `\n\n—\n${opts.emailFooter}` : "";
  return { subject: t.emailSubject ?? "", body: (t.emailBody ?? "") + footer };
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
