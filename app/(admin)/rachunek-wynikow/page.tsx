import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { buildRwReport, type RwReport } from "@/lib/rw";
import { loadPeopleRules } from "@/lib/rw-people";
import { todayUTC } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { RwView, type RwBatchRow } from "./rw-view";

export const metadata: Metadata = { title: "Rachunek wyników" };

// Rachunek wyników — najważniejsza zakładka systemu. Dane kasowe importowane
// z CSV (przychody/koszty wg kategorii arkusza RW) + metryki ręczne.
// Wszystkie wyliczenia w lib/rw.ts (silnik testowany złotym testem vs arkusz).
export default async function RachunekWynikowPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;

  // lata, dla których istnieją dane (+ bieżący rok zawsze dostępny)
  const yearsRaw = await db.rwEntry.findMany({
    select: { year: true },
    distinct: ["year"],
    orderBy: { year: "desc" },
  });
  const currentYear = todayUTC().getUTCFullYear();
  const years = [...new Set([currentYear, ...yearsRaw.map((y) => y.year)])].sort(
    (a, b) => b - a
  );

  const requested = params.rok ? parseInt(params.rok, 10) : NaN;
  const year = years.includes(requested) ? requested : years[0];

  const [entries, manual, batches] = await Promise.all([
    db.rwEntry.findMany({
      where: { year },
      select: { month: true, kind: true, category: true, amountGr: true },
    }),
    db.rwManualMetric.findMany({
      where: { year },
      select: { month: true, key: true, valueNum: true, valueText: true },
    }),
    db.rwImportBatch.findMany({
      where: { year },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const report: RwReport = buildRwReport(
    year,
    entries.map((e) => ({
      month: e.month,
      kind: e.kind as "PRZYCHOD" | "KOSZT",
      category: e.category,
      amountGr: e.amountGr,
    })),
    manual
  );

  const batchRows: RwBatchRow[] = batches.map((b) => ({
    id: b.id,
    filename: b.filename,
    kind: b.kind,
    rowCount: b.rowCount,
    createdAt: b.createdAt.toISOString(),
  }));

  return (
    <>
      <PageHeader
        title="Rachunek wyników"
        description="Najważniejsze metryki firmy — przychody, koszty per grupa, marże i wynik, liczone automatycznie z importowanych CSV"
      />
      <RwView
        report={report}
        years={years}
        batches={batchRows}
        peopleRules={loadPeopleRules()}
      />
    </>
  );
}
