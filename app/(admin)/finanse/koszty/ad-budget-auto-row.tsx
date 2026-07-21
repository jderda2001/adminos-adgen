// Jeden wyróżniony (fioletowy — jak kategoria „Budżet reklamowy") wiersz
// budżetu reklamowego, od sierpnia 2026. Zastępuje pojedyncze wpisy kategorii:
// szacunek miesiąca (z zamówień leadów × CPL Mety) POMNIEJSZONY o zasilenia
// budżetu w tym miesiącu = ile jeszcze zostało do zapłaty (na żywo).

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { formatMoney } from "@/lib/format";

export function AdBudgetAutoRow({
  monthLabel,
  estimateGr,
  fundedGr,
}: {
  monthLabel: string;
  estimateGr: number; // szacunek z zamówień × CPL
  fundedGr: number; // zasilenia budżetu w tym miesiącu (wpisy kategorii)
}) {
  const remainingGr = Math.max(0, estimateGr - fundedGr);
  const settled = remainingGr === 0 && estimateGr > 0;

  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-purple-300 bg-purple-50 px-4 py-3 dark:border-purple-800/60 dark:bg-purple-950/30">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-purple-100 text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
        <Megaphone className="size-4.5" />
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold text-purple-900 dark:text-purple-200">
          Budżet reklamowy
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[11px] font-medium text-purple-700 dark:bg-purple-900/50 dark:text-purple-300">
            auto · {monthLabel}
          </span>
        </div>
        <div className="text-xs text-purple-700/80 dark:text-purple-300/70">
          Szacunek z zamówień leadów × CPL Mety, pomniejszany o zasilenia —{" "}
          <Link href="/leady" className="underline underline-offset-2 hover:text-purple-900 dark:hover:text-purple-200">
            szczegóły w Leadach
          </Link>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-5 tabular-nums">
        <div className="hidden text-right sm:block">
          <div className="text-[11px] text-purple-700/70 dark:text-purple-300/60">szacunek</div>
          <div className="text-sm font-medium text-purple-900/90 dark:text-purple-200/90">
            {formatMoney(estimateGr)}
          </div>
        </div>
        <div className="hidden text-right sm:block">
          <div className="text-[11px] text-purple-700/70 dark:text-purple-300/60">zasilono</div>
          <div className="text-sm font-medium text-purple-900/90 dark:text-purple-200/90">
            {formatMoney(fundedGr)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[11px] font-medium text-purple-700 dark:text-purple-300">
            {settled ? "opłacone" : "do zapłaty"}
          </div>
          <div className="text-xl font-semibold text-purple-900 dark:text-purple-100">
            {formatMoney(remainingGr)}
          </div>
        </div>
      </div>
    </div>
  );
}
