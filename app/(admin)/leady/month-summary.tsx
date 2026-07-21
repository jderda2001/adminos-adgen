// Podsumowanie miesiąca w 3 kartach z wykresami donut (minimum tekstu):
// pula z Mety (przypisane/wygenerowane), dowiezienie kontraktów i budżet
// do końca miesiąca. Szczegóły per nisza są na kartach nisz.

import { formatMoney } from "@/lib/format";
import { DonutChart } from "@/components/donut-chart";
import type { ProgressTone } from "@/components/progress-bar";
import type { AdBudgetStatus } from "@/lib/reports";
import type { FulfillmentPlan } from "@/lib/lead-fulfillment";

function SummaryCard({
  label,
  value,
  valueSuffix,
  donutValue,
  donutMax,
  tone,
  foot,
}: {
  label: string;
  value: string;
  valueSuffix?: string;
  donutValue: number;
  donutMax: number;
  tone: ProgressTone;
  foot: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <DonutChart value={donutValue} max={donutMax} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className="mt-1 truncate text-xl font-semibold tabular-nums tracking-tight">
          {value}
          {valueSuffix && (
            <span className="ml-1 text-sm font-normal text-muted-foreground">{valueSuffix}</span>
          )}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground tabular-nums">{foot}</div>
      </div>
    </div>
  );
}

export function MonthSummary({
  generated,
  poolAssigned,
  unassigned,
  covered,
  owed,
  plan,
  budget,
}: {
  generated: number; // Σ leadów wygenerowanych w Mecie (ten miesiąc)
  poolAssigned: number; // Σ min(przypisane, wygenerowane) per nisza — do donuta puli
  unassigned: number; // Σ max(0, wygenerowane − przypisane) per nisza (leżące)
  covered: number; // Σ min(dowiezione, zobowiązanie) per klient — do donuta dowiezienia
  owed: number; // Σ dodatnich zobowiązań (kontrakt + dług)
  plan: FulfillmentPlan;
  budget: AdBudgetStatus;
}) {
  const over = budget.remainingGr < 0;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
      <SummaryCard
        label="Wygenerowane w Mecie"
        value={String(generated)}
        valueSuffix="leadów"
        donutValue={poolAssigned}
        donutMax={generated}
        tone="blue"
        foot={
          unassigned > 0 ? (
            <>
              leży <span className="font-medium text-blue-600 dark:text-blue-400">{unassigned}</span>{" "}
              · wydane {formatMoney(budget.spentGr)}
            </>
          ) : (
            <>wszystkie rozdane · wydane {formatMoney(budget.spentGr)}</>
          )
        }
      />
      <SummaryCard
        label="Dowiezienie kontraktów"
        value={String(covered)}
        valueSuffix={`/ ${owed}`}
        donutValue={covered}
        donutMax={owed}
        tone="auto"
        foot={
          plan.totalRemaining > 0 ? (
            <>
              brakuje <span className="font-medium text-amber-600 dark:text-amber-400">{plan.totalRemaining}</span>{" "}
              {plan.totalBudgetIncreaseGr > 0
                ? `· dołóż ≈${formatMoney(plan.totalBudgetIncreaseGr)}`
                : "· pula pokrywa"}
            </>
          ) : owed > 0 ? (
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              wszystko dowiezione
            </span>
          ) : (
            <>brak kontraktów w tym miesiącu</>
          )
        }
      />
      <SummaryCard
        label={budget.daysLeft > 0 ? `Budżet · ${budget.daysLeft} dni do końca` : "Budżet · miesiąc zamknięty"}
        value={formatMoney(budget.spentGr)}
        valueSuffix={budget.planGr > 0 ? `/ ${formatMoney(budget.planGr)}` : undefined}
        donutValue={budget.spentGr}
        donutMax={budget.planGr}
        tone={over ? "red" : "primary"}
        foot={
          over ? (
            <span className="font-medium text-red-600 dark:text-red-400">
              przepał {formatMoney(-budget.remainingGr)}
            </span>
          ) : (
            <>
              trzymaj <span className="font-medium text-foreground">{formatMoney(budget.remainingGr)}</span>
              {budget.dailyPaceGr !== null && <> · ≈{formatMoney(budget.dailyPaceGr)}/dzień</>}
            </>
          )
        }
      />
    </div>
  );
}
