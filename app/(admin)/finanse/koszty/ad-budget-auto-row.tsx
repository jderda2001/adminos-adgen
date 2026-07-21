// Wyróżniony, auto-liczony wiersz „Budżet reklamowy" (TEST od sierpnia 2026).
// Zamiast wielu ręcznych wpisów kategorii „Budżet reklamowy" — jeden punkt,
// liczony na bieżąco z zamówień leadów (Przychody) × CPL z Mety (przez
// getAdBudgetStatus/realizację kontraktów). To SZACUNEK — na razie nie wchodzi
// do sum kosztów ani rentowności (do decyzji, czy ma zastąpić realne wpisy).

import Link from "next/link";
import { Megaphone } from "lucide-react";
import { formatMoney } from "@/lib/format";

export function AdBudgetAutoRow({
  monthLabel,
  netGr,
  spentGr,
}: {
  monthLabel: string;
  netGr: number;
  spentGr: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-primary/40 bg-primary/5 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
        <Megaphone className="size-4.5" />
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-semibold">
          Budżet reklamowy
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
            auto · {monthLabel}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Liczony na bieżąco z zamówień leadów (Przychody) × CPL z Mety —{" "}
          <Link href="/leady" className="text-primary underline-offset-2 hover:underline">
            szczegóły w Leadach
          </Link>
        </div>
      </div>
      <div className="ml-auto text-right">
        <div className="text-xl font-semibold tabular-nums">{formatMoney(netGr)}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          netto · szacunek{spentGr > 0 && <> · wydane wg Mety {formatMoney(spentGr)}</>}
        </div>
      </div>
    </div>
  );
}
