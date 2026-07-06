import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { dateToInput, formatDate, todayUTC } from "@/lib/format";
import { TimeEntryForm, type ClientOption } from "./time-entry-form";
import { TimerBanner } from "./timer-banner";
import { WeekView, type DayGroup, type EntryRow } from "./week-view";

export const metadata: Metadata = { title: "Mój czas" };

const DAY_NAMES_PL = [
  "niedziela",
  "poniedziałek",
  "wtorek",
  "środa",
  "czwartek",
  "piątek",
  "sobota",
];

/** "poniedziałek, 30.06" */
function dayLabel(date: Date): string {
  const d = String(date.getUTCDate()).padStart(2, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${DAY_NAMES_PL[date.getUTCDay()]}, ${d}.${m}`;
}

export default async function MyTimePage({
  searchParams,
}: {
  searchParams: Promise<{ tydzien?: string }>;
}) {
  // KAŻDY zalogowany (także admin) widzi tu wyłącznie SWOJE wpisy
  const user = await requireUser();
  const params = await searchParams;

  const rawOffset = Number(params.tydzien);
  const weekOffset =
    Number.isInteger(rawOffset) && rawOffset < 0 ? rawOffset : 0;

  const today = todayUTC();
  const dow = (today.getUTCDay() + 6) % 7; // 0 = poniedziałek
  const monday = new Date(
    today.getTime() - dow * 86_400_000 + weekOffset * 7 * 86_400_000
  );
  const sunday = new Date(monday.getTime() + 6 * 86_400_000);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);

  const [activeClients, timer, entries] = await Promise.all([
    db.client.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.activeTimer.findUnique({
      where: { userId: user.id },
      include: { client: { select: { name: true } } },
    }),
    db.timeEntry.findMany({
      where: { userId: user.id, date: { gte: monday, lt: nextMonday } },
      include: { client: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  // opcje selecta w edycji: aktywni klienci + klienci istniejących wpisów
  const clientOptions: ClientOption[] = [...activeClients];
  for (const e of entries) {
    if (!clientOptions.some((c) => c.id === e.clientId)) {
      clientOptions.push({ id: e.clientId, name: e.client.name });
    }
  }

  // grupowanie wpisów po dniu (pon–niedz, tylko dni z wpisami)
  const byDay = new Map<string, EntryRow[]>();
  for (const e of entries) {
    const key = e.date.toISOString();
    const row: EntryRow = {
      id: e.id,
      clientId: e.clientId,
      clientName: e.client.name,
      description: e.description,
      date: key,
      minutes: e.minutes,
    };
    const list = byDay.get(key);
    if (list) list.push(row);
    else byDay.set(key, [row]);
  }

  const days: DayGroup[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(monday.getTime() + i * 86_400_000);
    const iso = day.toISOString();
    const dayEntries = byDay.get(iso);
    if (!dayEntries) continue;
    days.push({
      iso,
      label: dayLabel(day),
      isToday: day.getTime() === today.getTime(),
      totalMinutes: dayEntries.reduce((sum, e) => sum + e.minutes, 0),
      entries: dayEntries,
    });
  }
  const weekTotalMinutes = entries.reduce((sum, e) => sum + e.minutes, 0);
  const weekLabel = `${formatDate(monday)} – ${formatDate(sunday)}`;

  return (
    <>
      <PageHeader
        title="Mój czas pracy"
        description="Rejestruj czas dla klientów — szybki wpis Enterem albo timer Start/Stop"
      />
      <div className="space-y-4">
        {timer && (
          <TimerBanner
            clientName={timer.client.name}
            description={timer.description}
            startedAt={timer.startedAt.toISOString()}
          />
        )}
        <TimeEntryForm
          clients={activeClients}
          hasActiveTimer={timer !== null}
          defaultDate={dateToInput(today)}
        />
        <WeekView
          days={days}
          weekLabel={weekLabel}
          weekOffset={weekOffset}
          weekTotalMinutes={weekTotalMinutes}
          clients={clientOptions}
        />
      </div>
    </>
  );
}
