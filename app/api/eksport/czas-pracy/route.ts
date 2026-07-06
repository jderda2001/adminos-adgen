// Eksport CSV czasu pracy — te same filtry co strona /czas-pracy
// (?okres=&od=&do=&osoba=&klient=). Kolumny:
// Data;Osoba;Klient;Opis;Godziny;Koszt pracy

import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatAmount, formatDate } from "@/lib/format";
import { resolvePeriod } from "@/lib/periods";
import { effectiveRateGr, laborCostGr, type RateRecord } from "@/lib/calc";

const plHours = new Intl.NumberFormat("pl-PL", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** 90 (minuty) → "1,5" — liczba godzin z przecinkiem, bez "h" */
function hoursNumber(minutes: number): string {
  return plHours.format(minutes / 60);
}

export async function GET(request: NextRequest) {
  await requireAdmin();

  const sp = request.nextUrl.searchParams;
  const period = resolvePeriod({
    okres: sp.get("okres") ?? undefined,
    od: sp.get("od") ?? undefined,
    do: sp.get("do") ?? undefined,
  });
  const osoba = sp.get("osoba");
  const klient = sp.get("klient");

  const [entries, rates] = await Promise.all([
    db.timeEntry.findMany({
      where: {
        date: { gte: period.from, lt: period.to },
        ...(osoba ? { userId: osoba } : {}),
        ...(klient ? { clientId: klient } : {}),
      },
      include: {
        user: { select: { name: true } },
        client: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    db.hourlyRate.findMany({
      select: { userId: true, ratePerHourGr: true, validFrom: true },
    }),
  ]);

  const ratesByUser = new Map<string, RateRecord[]>();
  for (const r of rates) {
    const list = ratesByUser.get(r.userId);
    const record: RateRecord = {
      ratePerHourGr: r.ratePerHourGr,
      validFrom: r.validFrom,
    };
    if (list) list.push(record);
    else ratesByUser.set(r.userId, [record]);
  }

  const rows = entries.map((e) => {
    const rate = effectiveRateGr(ratesByUser.get(e.userId) ?? [], e.date);
    return [
      formatDate(e.date),
      e.user.name,
      e.client.name,
      e.description ?? "",
      hoursNumber(e.minutes),
      formatAmount(laborCostGr(e.minutes, rate)),
    ];
  });

  const content = toCsv(
    ["Data", "Osoba", "Klient", "Opis", "Godziny", "Koszt pracy"],
    rows
  );
  return csvResponse(content, "czas-pracy.csv");
}
