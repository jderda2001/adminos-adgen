// Karty nisz (wertykałów) na widoku głównym Leadów — celowo minimalne:
// nazwa + CPL, duże „dowiezione / zobowiązanie", pasek postępu i jedna
// stopka (leżące leady / ile dołożyć / dowiezione). Klik = osobna strona
// niszy (/leady/nisza?w=…) z klientami i edycją dostaw.

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { ProgressBar } from "@/components/progress-bar";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";

export interface VerticalCardData {
  vertical: string;
  cplGr: number | null;
  generated: number; // wygenerowane w Mecie (ten miesiąc)
  assigned: number; // Σ dowiezionych klientom
  unassigned: number; // generated − assigned
  owed: number; // Σ dodatnich zobowiązań klientów (kontrakt + dług)
  delivered: number; // Σ min(dowiezione, zobowiązanie) per klient — pasek nie nettuje nadwyżek
  remaining: number; // brakujące leady (Σ dodatnich bilansów)
  addSpendGr: number; // ile dołożyć w Mecie (remaining × CPL)
  clientCount: number;
}

export function VerticalCards({ month, cards }: { month: string; cards: VerticalCardData[] }) {
  if (cards.length === 0) {
    return (
      <EmptyState
        title="Brak nisz w tym miesiącu"
        description={'Dodaj fakturę „PAKIETY LEADÓW” w Przychodach albo zaciągnij kampanie z Mety.'}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((c) => (
        <Link
          key={c.vertical}
          href={`/leady/nisza?w=${encodeURIComponent(c.vertical)}&od=${month}`}
          className="group rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 hover:bg-muted/30"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm font-semibold">{c.vertical}</span>
            <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
              {c.cplGr !== null && <>CPL {formatMoney(c.cplGr)}</>}
              <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>

          {c.owed > 0 ? (
            <>
              <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
                {c.delivered}
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ {c.owed}</span>
              </div>
              <ProgressBar value={c.delivered} max={c.owed} className="mt-2" />
            </>
          ) : (
            <>
              <div className="mt-3 text-2xl font-semibold tabular-nums tracking-tight">
                {c.generated}
                <span className="ml-1 text-sm font-normal text-muted-foreground">wygenerowanych</span>
              </div>
              <ProgressBar value={c.assigned} max={c.generated} tone="blue" className="mt-2" />
            </>
          )}

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs tabular-nums">
            {c.remaining > 0 ? (
              <>
                <StatusBadge tone="amber">−{c.remaining}</StatusBadge>
                {c.addSpendGr > 0 && (
                  <span className="text-muted-foreground">
                    dołóż <span className="font-medium text-primary">{formatMoney(c.addSpendGr)}</span>
                  </span>
                )}
              </>
            ) : c.owed > 0 ? (
              <StatusBadge tone="green" dot>
                dowiezione
              </StatusBadge>
            ) : null}
            {c.unassigned > 0 && <StatusBadge tone="blue">leży {c.unassigned}</StatusBadge>}
            {c.remaining === 0 && c.owed === 0 && c.unassigned <= 0 && (
              <span className="text-muted-foreground">bez kontraktów</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}
