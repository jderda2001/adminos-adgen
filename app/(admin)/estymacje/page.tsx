import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { buildForecast } from "@/lib/forecast";
import { loadForecastInput, type Horizon } from "./forecast-data";
import { EstymacjeView } from "./estymacje-view";

export const metadata: Metadata = { title: "Estymacje" };

const HORIZONS = [3, 6, 12] as const;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export default async function EstymacjePage({
  searchParams,
}: {
  searchParams: Promise<{ horyzont?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const requested = Number(params.horyzont);
  const horizon: Horizon = (HORIZONS as readonly number[]).includes(requested)
    ? (requested as Horizon)
    : 6;

  const input = await loadForecastInput(horizon);
  const result = buildForecast(input);

  // dodatkowe zapytania na potrzeby widoku (nie wchodzą do silnika)
  const [snapshots, events] = await Promise.all([
    db.cashSnapshot.findMany({ orderBy: { date: "desc" }, take: 6 }),
    db.finPlanEvent.findMany({ where: { period: { gte: input.todayIso.slice(0, 7) } }, orderBy: { period: "asc" } }),
  ]);

  const clientNames: Record<string, string> = {};
  for (const c of input.clients) clientNames[c.id] = c.name;

  return (
    <>
      <PageHeader
        title="Estymacje"
        description="Prognoza przychodów, kosztów i gotówki na kolejne miesiące — na bazie umów klientów, kosztów cyklicznych i historii płatności."
      />
      <EstymacjeView
        result={result}
        horizon={horizon}
        snapshots={snapshots.map((s) => ({
          id: s.id,
          dateIso: iso(s.date),
          balanceGr: s.balanceGr,
          note: s.note,
        }))}
        events={events.map((e) => ({
          id: e.id,
          period: e.period,
          kind: e.kind,
          label: e.label,
          amountGr: e.amountGr,
          note: e.note,
        }))}
        newBusinessGr={input.assumptions.newBusinessMonthlyGr}
        clientNames={clientNames}
        aiEnabled={Boolean(process.env.ANTHROPIC_API_KEY)}
      />
    </>
  );
}
