import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { effectiveRateGr, laborCostGr } from "@/lib/calc";
import { resolvePeriod, type PeriodSearchParams } from "@/lib/periods";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { Button } from "@/components/ui/button";
import {
  SettlementTable,
  type SettlementRow,
  type WeekColumn,
} from "./settlement-table";

export const metadata: Metadata = { title: "Rozliczenie zespołu" };

const DAY_MS = 86_400_000;

/**
 * Fragmenty tygodni (pon–niedz) przycięte do miesiąca [from, to).
 * Tydzień zaczyna się w poniedziałek (UTC). Segmenty pokrywają wszystkie dni
 * miesiąca rozłącznie, więc każdy wpis trafia dokładnie do jednego segmentu.
 * Zwraca zakresy półotwarte [start, end) północ UTC.
 */
function monthWeekSegments(
  from: Date,
  to: Date
): { start: Date; end: Date }[] {
  const segments: { start: Date; end: Date }[] = [];
  let cursor = from;
  while (cursor.getTime() < to.getTime()) {
    // koniec tygodnia = najbliższy poniedziałek po `cursor` (pon jako początek)
    const dow = (cursor.getUTCDay() + 6) % 7; // 0 = poniedziałek
    const nextMonday = new Date(cursor.getTime() + (7 - dow) * DAY_MS);
    const end = nextMonday.getTime() < to.getTime() ? nextMonday : to;
    segments.push({ start: cursor, end });
    cursor = end;
  }
  return segments;
}

export default async function TeamSettlementPage({
  searchParams,
}: {
  searchParams: Promise<PeriodSearchParams>;
}) {
  await requireAdmin();

  // wymuszamy tryb miesiąca — rozliczenie liczy tygodnie w obrębie miesiąca
  const raw = await searchParams;
  const period = resolvePeriod({ okres: "miesiac", od: raw.od });
  const { from, to } = period;

  const [users, entries] = await Promise.all([
    db.user.findMany({
      where: { role: { in: ["EMPLOYEE", "ADMIN"] } },
      include: { rates: { orderBy: { validFrom: "desc" } } },
      orderBy: { name: "asc" },
    }),
    db.timeEntry.findMany({
      where: { date: { gte: from, lt: to } },
      select: { userId: true, minutes: true, date: true },
    }),
  ]);

  const segments = monthWeekSegments(from, to);

  const weekColumns: WeekColumn[] = segments.map((s, i) => {
    const lastDay = new Date(s.end.getTime() - DAY_MS);
    // krótki zakres "01–06.07" (segmenty są przycięte do miesiąca → ten sam miesiąc);
    // koniec segmentu jest wyłączny, więc ostatni dzień = end − 1
    const dd = (d: Date) => String(d.getUTCDate()).padStart(2, "0");
    const mm = String(s.start.getUTCMonth() + 1).padStart(2, "0");
    return {
      index: i,
      label: `Tydz. ${i + 1}`,
      range: `${dd(s.start)}–${dd(lastDay)}.${mm}`,
    };
  });

  // koszt pracy per pracownik per segment tygodnia
  const perUserWeeks = new Map<string, number[]>();
  const rateMap = new Map(users.map((u) => [u.id, u.rates]));

  function weekIndexFor(date: Date): number {
    const t = date.getTime();
    for (let i = 0; i < segments.length; i++) {
      if (t >= segments[i].start.getTime() && t < segments[i].end.getTime()) {
        return i;
      }
    }
    return -1; // poza miesiącem (nie powinno wystąpić przy filtrze [from, to))
  }

  for (const e of entries) {
    const rates = rateMap.get(e.userId);
    if (!rates) continue; // wpis pracownika spoza listy (np. nietypowa rola)
    const idx = weekIndexFor(e.date);
    if (idx < 0) continue;
    const cost = laborCostGr(e.minutes, effectiveRateGr(rates, e.date));
    let arr = perUserWeeks.get(e.userId);
    if (!arr) {
      arr = new Array(segments.length).fill(0);
      perUserWeeks.set(e.userId, arr);
    }
    arr[idx] += cost;
  }

  const rows: SettlementRow[] = users.map((u) => {
    const weeks = perUserWeeks.get(u.id) ?? new Array(segments.length).fill(0);
    const totalGr = weeks.reduce((sum, w) => sum + w, 0);
    return {
      userId: u.id,
      name: u.name,
      budgetGr: u.monthlyBudgetGr,
      weeks,
      totalGr,
    };
  });

  const sumLiveGr = rows.reduce((sum, r) => sum + r.totalGr, 0);
  const sumBudgetGr = rows.reduce((sum, r) => sum + (r.budgetGr ?? 0), 0);
  const differenceGr = sumBudgetGr - sumLiveGr;

  return (
    <>
      <PageHeader
        title="Rozliczenie zespołu"
        description="Koszt pracy pracowników w rozbiciu na tygodnie miesiąca vs. założenie (budżet wypłaty)"
      >
        <Button asChild variant="outline" size="sm">
          <Link href="/zespol">
            <ArrowLeft className="size-4" /> Zespół
          </Link>
        </Button>
        <PeriodFilter />
      </PageHeader>

      <SettlementTable
        rows={rows}
        weekColumns={weekColumns}
        periodLabel={period.label}
        sumLiveGr={sumLiveGr}
        sumBudgetGr={sumBudgetGr}
        differenceGr={differenceGr}
      />
    </>
  );
}
