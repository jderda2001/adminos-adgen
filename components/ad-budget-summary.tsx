// Karta budżetu reklamowego miesiąca: plan (Σ budżetów marek) vs wydane wg Mety
// vs ile gotówki jeszcze trzymać do końca miesiąca. Używana w Leady i jako
// banner w Kosztach (variant="banner" z linkiem do /leady).

import Link from "next/link";
import { formatMoney } from "@/lib/format";
import type { AdBudgetStatus } from "@/lib/reports";
import { cn } from "@/lib/utils";

const MONTHS_PL = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

function monthLabel(month: string): string {
  const [, m] = month.split("-").map(Number);
  return `do końca ${MONTHS_PL[m - 1] ?? month}`;
}

export function AdBudgetSummary({
  status,
  variant = "card",
}: {
  status: AdBudgetStatus;
  variant?: "card" | "banner";
}) {
  const { planGr, spentGr, remainingGr, daysLeft, dailyPaceGr } = status;
  const hasPlan = planGr > 0;
  const over = remainingGr < 0;

  const rows = (
    <div
      className={cn(
        "grid gap-x-6 gap-y-1 text-sm tabular-nums",
        variant === "banner" ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-1"
      )}
    >
      <div className={variant === "card" ? "flex items-baseline justify-between" : ""}>
        <div className="text-xs text-muted-foreground">plan (suma marek)</div>
        <div className="font-medium">{hasPlan ? formatMoney(planGr) : "—"}</div>
      </div>
      <div className={variant === "card" ? "flex items-baseline justify-between" : ""}>
        <div className="text-xs text-muted-foreground">wydane wg Mety</div>
        <div className="font-medium">{formatMoney(spentGr)}</div>
      </div>
      <div className={variant === "card" ? "flex items-baseline justify-between" : ""}>
        <div className="text-xs text-muted-foreground">
          {over ? "przepał planu" : "do wydania — trzymaj cash flow"}
        </div>
        <div
          className={cn(
            "font-semibold",
            over ? "text-red-600 dark:text-red-400" : "text-primary"
          )}
        >
          {hasPlan ? formatMoney(Math.abs(remainingGr)) : "—"}
        </div>
      </div>
      <div className={variant === "card" ? "flex items-baseline justify-between" : ""}>
        <div className="text-xs text-muted-foreground">tempo, by domknąć plan</div>
        <div className="text-muted-foreground">
          {dailyPaceGr !== null ? `≈${formatMoney(dailyPaceGr)}/dzień` : "—"}
        </div>
      </div>
    </div>
  );

  if (variant === "banner") {
    return (
      <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">
            Budżet reklamowy · {daysLeft > 0 ? `${daysLeft} dni ${monthLabel(status.month)}` : "miesiąc zamknięty"}
          </span>
          <Link href="/leady" className="text-xs text-primary underline-offset-2 hover:underline">
            plany marek w Leadach →
          </Link>
        </div>
        {hasPlan || spentGr > 0 ? (
          rows
        ) : (
          <p className="text-sm text-muted-foreground">
            Brak planów budżetu na ten miesiąc — ustaw je na kartach marek w{" "}
            <Link href="/leady" className="text-primary underline-offset-2 hover:underline">
              Leadach
            </Link>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 text-sm font-semibold">
        Do końca miesiąca{daysLeft > 0 && <> · {daysLeft} dni</>}
      </div>
      {hasPlan || spentGr > 0 ? (
        <>
          {rows}
          <p className="mt-3 text-[11px] leading-snug text-muted-foreground">
            Ta sama karta jest na górze zakładki Koszty — żebyś przy płatnościach
            widział, ile gotówki musi zostać na Metę.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Ustaw budżety marek (ołówek na kartach powyżej), a policzę, ile jeszcze
          trzeba wydać i jakie tempo dzienne domyka plan.
        </p>
      )}
    </div>
  );
}
