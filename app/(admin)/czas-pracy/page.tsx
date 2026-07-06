import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { resolvePeriod, type PeriodSearchParams } from "@/lib/periods";
import { effectiveRateGr, laborCostGr, type RateRecord } from "@/lib/calc";
import { TimeFilters } from "./time-filters";
import { TimeTable, type TimeAdminRow } from "./time-table";

export const metadata: Metadata = { title: "Czas pracy" };

type SearchParams = PeriodSearchParams & { osoba?: string; klient?: string };

export default async function TimeAdminPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const period = resolvePeriod(params);

  const [entries, users, clients, rates] = await Promise.all([
    db.timeEntry.findMany({
      where: {
        date: { gte: period.from, lt: period.to },
        ...(params.osoba ? { userId: params.osoba } : {}),
        ...(params.klient ? { clientId: params.klient } : {}),
      },
      include: {
        user: { select: { name: true } },
        client: { select: { name: true } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    }),
    db.user.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.client.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.hourlyRate.findMany({
      select: { userId: true, ratePerHourGr: true, validFrom: true },
    }),
  ]);

  // stawki historyczne pogrupowane po pracowniku — koszt liczony wg stawki
  // obowiązującej W DNIU wpisu
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

  const rows: TimeAdminRow[] = entries.map((e) => {
    const rate = effectiveRateGr(ratesByUser.get(e.userId) ?? [], e.date);
    return {
      id: e.id,
      date: e.date.toISOString(),
      userName: e.user.name,
      clientName: e.client.name,
      description: e.description,
      minutes: e.minutes,
      costGr: laborCostGr(e.minutes, rate),
    };
  });

  return (
    <>
      <PageHeader
        title="Czas pracy"
        description={`Wpisy czasu całego zespołu z kosztem pracy wg stawek historycznych — ${period.label}`}
      />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <PeriodFilter />
          <TimeFilters users={users} clients={clients} />
        </div>
        <TimeTable rows={rows} />
      </div>
    </>
  );
}
