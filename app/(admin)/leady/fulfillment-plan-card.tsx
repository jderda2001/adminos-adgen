// Estymacja dowiezienia: brakujące leady per wertykal × CPL z ostatniego okresu
// → ile trzeba jeszcze wydać w Mecie i o ile zwiększyć budżet, by dowieźć
// zakontraktowane leady. Zasila też plan w karcie „Do końca miesiąca".

import { formatMoney } from "@/lib/format";
import type { FulfillmentPlan } from "@/lib/lead-fulfillment";

export function FulfillmentPlanCard({ plan }: { plan: FulfillmentPlan }) {
  const rows = plan.verticals.filter((v) => v.remaining > 0);

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-2 text-sm font-semibold">Ile jeszcze dowieźć</div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Wszystkie zakontraktowane leady dowiezione (brak zaległości w tym miesiącu). 🎉
        </p>
      ) : (
        <>
          <div className="space-y-2">
            {rows.map((v) => (
              <div key={v.vertical} className="rounded-lg border px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium">{v.vertical}</span>
                  <span className="text-sm tabular-nums">
                    brakuje <span className="font-semibold">{v.remaining}</span> leadów
                  </span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                  <span>CPL {v.cplGr !== null ? formatMoney(v.cplGr) : "— (brak danych)"}</span>
                  <span>
                    dołóż{" "}
                    <span className="font-medium text-primary">{formatMoney(v.budgetIncreaseGr)}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-baseline justify-between border-t pt-2 text-sm tabular-nums">
            <span className="text-muted-foreground">Łącznie do dowiezienia</span>
            <span className="font-semibold">
              {plan.totalRemaining} leadów · +{formatMoney(plan.totalBudgetIncreaseGr)}
            </span>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
            Szacunek przy CPL z ostatniego okresu (30 dni). „Dołóż" = ile jeszcze wydać w Mecie
            ponad to, co już poszło w tym miesiącu na dany wertykal.
          </p>
        </>
      )}
    </div>
  );
}
