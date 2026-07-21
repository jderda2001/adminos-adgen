// Jeden wyróżniony (fioletowy — jak kategoria „Budżet reklamowy") wiersz
// budżetu reklamowego, od sierpnia 2026. Kwota = koszt leadów, które trzeba
// jeszcze WYGENEROWAĆ w tym miesiącu (Σ zamówionych-a-niedostarczonych × CPL
// Mety). Maleje sam w miarę jak Meta generuje leady — dlatego nie odejmujemy
// osobno zasileń (te stają się właśnie wygenerowanymi leadami).

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { formatMoney } from "@/lib/format";

export function AdBudgetAutoRow({
  monthLabel,
  estimateGr,
}: {
  monthLabel: string;
  estimateGr: number; // koszt leadów jeszcze do wygenerowania × CPL
}) {
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
          Koszt leadów jeszcze do wygenerowania × CPL Mety — maleje w miarę
          generowania leadów.{" "}
          <Link href="/leady" className="underline underline-offset-2 hover:text-purple-900 dark:hover:text-purple-200">
            szczegóły w Leadach
          </Link>
        </div>
      </div>

      <div className="ml-auto text-right tabular-nums">
        <div className="text-[11px] font-medium text-purple-700 dark:text-purple-300">
          do wydania
        </div>
        <div className="text-xl font-semibold text-purple-900 dark:text-purple-100">
          {formatMoney(estimateGr)}
        </div>
      </div>
    </div>
  );
}
