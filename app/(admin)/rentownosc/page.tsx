import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth";
import { getClientProfitability } from "@/lib/reports";
import { getMarginThresholdFraction } from "@/lib/settings";
import { resolvePeriod, type PeriodSearchParams } from "@/lib/periods";
import { formatMoney, formatPercent } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { KpiCard } from "@/components/kpi-card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  ProfitabilityTable,
  type ProfitabilityRow,
} from "./profitability-table";

export const metadata: Metadata = { title: "Rentowność klientów" };

// Wiersz uzgodnienia w stylu DetailRow: etykieta po lewej, kwota po prawej
// (tabular-nums), wynik pogrubiony, wartości ujemne na czerwono gdy wyróżnione.
function ReconciliationRow({
  label,
  amountGr,
  emphasized,
}: {
  label: string;
  amountGr: number;
  emphasized?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1.5 text-sm",
        emphasized && "font-semibold"
      )}
    >
      <span className={cn(!emphasized && "text-muted-foreground")}>
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums",
          emphasized && amountGr < 0 && "text-red-600 dark:text-red-400"
        )}
      >
        {formatMoney(amountGr)}
      </span>
    </div>
  );
}

export default async function ProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<PeriodSearchParams>;
}) {
  await requireAdmin();
  const period = resolvePeriod(await searchParams);

  const [prof, marginThreshold] = await Promise.all([
    getClientProfitability(period),
    getMarginThresholdFraction(),
  ]);

  const rows: ProfitabilityRow[] = prof.rows.map((r) => ({
    clientId: r.clientId,
    clientName: prof.clientNames.get(r.clientId) ?? "(nieznany klient)",
    revenueGr: r.revenueGr,
    directCostsGr: r.directCostsGr,
    allocationGr: r.allocationGr,
    leadCostGr: r.leadCostGr,
    profitGr: r.profitGr,
    marginFraction: r.marginFraction,
  }));

  const revenueGr = rows.reduce((a, r) => a + r.revenueGr, 0);
  const belowThresholdCount = rows.filter(
    (r) => r.marginFraction !== null && r.marginFraction < marginThreshold
  ).length;
  // kolumna „Koszt leadów" gdy w okresie są dostawy albo księgowania budżetu reklamowego
  const showLeadCosts = prof.leadCostsTotalGr > 0 || prof.adSpendBookedGr > 0;

  return (
    <>
      <PageHeader
        title="Rentowność klientów"
        description="Przychody, koszty i zysk per klient — kliknij wiersz, aby zobaczyć szczegóły"
      >
        <span className="text-sm font-medium text-muted-foreground">
          {period.label}
        </span>
        <PeriodFilter />
      </PageHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Przychody (okres)" value={formatMoney(revenueGr)} />
          <KpiCard
            label="Zysk firmy"
            value={formatMoney(prof.companyProfitGr)}
            sub="przychody − wszystkie koszty"
            tone={
              prof.companyProfitGr < 0
                ? "negative"
                : prof.companyProfitGr > 0
                  ? "positive"
                  : "default"
            }
          />
          <KpiCard
            label="Marża firmy"
            value={formatPercent(
              revenueGr > 0 ? prof.companyProfitGr / revenueGr : null
            )}
            sub="zysk firmy / przychody"
          />
          <KpiCard
            label="Klienci poniżej progu"
            value={String(belowThresholdCount)}
            sub={`próg marży ${formatPercent(marginThreshold)}`}
            tone={belowThresholdCount > 0 ? "warning" : "default"}
          />
        </div>

        {prof.leadWarnings.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            Część dostaw leadów nie ma kampanii do wyceny (koszt 0 lub średnia
            wertykalu) — uzupełnij kampanie w{" "}
            <a href="/leady" className="font-medium underline underline-offset-2">
              module Leady
            </a>
            .
          </div>
        )}

        <ProfitabilityTable
          rows={rows}
          allocationEnabled={prof.allocationEnabled}
          showLeadCosts={showLeadCosts}
          marginThreshold={marginThreshold}
        />

        <div className="max-w-2xl rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <div className="mb-3">
            <h2 className="font-heading text-base font-semibold">
              Uzgodnienie z zyskiem firmy
            </h2>
            <p className="text-sm text-muted-foreground">
              Okres: {period.label}
            </p>
          </div>
          <div className="space-y-0.5">
            <ReconciliationRow
              label="Suma zysków klientów"
              amountGr={prof.clientProfitSumGr}
            />
            <ReconciliationRow
              label="− Koszty ogólne niealokowane"
              amountGr={prof.unallocatedGeneralGr}
            />
            <ReconciliationRow
              label="− Wynagrodzenia niepokryte godzinami"
              amountGr={prof.salariesNotCoveredGr}
            />
            {showLeadCosts && (
              <ReconciliationRow
                label="− Nieprzypisane wydatki reklamowe"
                amountGr={prof.unassignedAdSpendGr}
              />
            )}
            <Separator className="my-1" />
            <ReconciliationRow
              label="= Zysk firmy"
              amountGr={prof.companyProfitGr}
              emphasized
            />
          </div>
          <p className="pt-3 text-xs leading-relaxed text-muted-foreground">
            Zysk firmy to ta sama wartość, co na Dashboardzie (przychody −
            wszystkie koszty). Kategoria „wynagrodzenia” nie wchodzi do kosztów
            bezpośrednich klientów ani do alokacji kosztów ogólnych, bo pensje
            są rozliczane kosztem pracy wyliczonym z godzin i stawek
            godzinowych — inaczej liczylibyśmy je podwójnie.
            {showLeadCosts && (
              <>
                {" "}
                Analogicznie przelewy z kategorii „budżet reklamowy” nie wchodzą
                do alokacji — klientom przypisywany jest koszt leadów (leady ×
                CPL z modułu Leady), a reszta wydatków to pozycja
                „nieprzypisane” (leady niesprzedane, testy, różnice zaokrągleń).
              </>
            )}
            {!prof.allocationEnabled && (
              <>
                {" "}
                Alokacja kosztów ogólnych jest wyłączona w Ustawieniach — cała
                pula kosztów ogólnych znajduje się w pozycji „niealokowane”.
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
}
