"use client";

// Lista klientów na stronie niszy: pasek postępu dowiezienia, inline-edytowalne
// „dowiezione" (przypisujecie leady ręcznie) i „paczka dostarczona" (ustawia
// dowiezione = całe zobowiązanie: kontrakt + dług z poprzednich miesięcy).

import { useState, useTransition } from "react";
import { Check, PackageCheck, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { ProgressBar } from "@/components/progress-bar";
import { formatMoney } from "@/lib/format";
import { setDeliveredAction } from "../actions";

export interface NicheClientRow {
  clientId: string;
  clientName: string;
  vertical: string;
  owed: number; // zobowiązanie (kontrakt + dług z poprzednich miesięcy; może być ujemne = nadwyżka)
  delivered: number;
  balance: number; // >0 dług, <0 nadwyżka, 0 rozliczone
  costGr: number; // dowiezione × CPL niszy
  estimated: boolean; // dostawa auto-przeniesiona z poprzedniego miesiąca (do potwierdzenia)
}

function ClientRow({ month, row }: { month: string; row: NicheClientRow }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(row.delivered));

  function commit(value: string) {
    startTransition(async () => {
      const res = await setDeliveredAction({
        period: month,
        clientId: row.clientId,
        vertical: row.vertical,
        leads: value,
      });
      if (res.ok) {
        toast.success(res.message ?? "Zapisano");
        setEditing(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function saveEdit() {
    const next = draft.trim();
    if (next === "" || next === String(row.delivered)) {
      setEditing(false);
      setDraft(String(row.delivered));
      return;
    }
    commit(next);
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{row.clientName}</span>
          {row.estimated && <StatusBadge tone="amber">estymacja</StatusBadge>}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatMoney(row.costGr)}
        </span>
      </div>

      <div className="mt-3 flex items-baseline gap-1 tabular-nums">
        <span className="text-2xl font-semibold tracking-tight">{row.delivered}</span>
        {row.owed > 0 ? (
          <span className="text-sm text-muted-foreground">/ {row.owed}</span>
        ) : (
          <span className="text-sm text-muted-foreground">z zapasu</span>
        )}
      </div>
      {/* nadwyżka bez kontraktu (owed ≤ 0) → pełny niebieski pasek zamiast „0 / −5" */}
      {row.owed > 0 ? (
        <ProgressBar value={row.delivered} max={row.owed} className="mt-2" />
      ) : (
        <ProgressBar value={1} max={1} tone="blue" className="mt-2" />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <Input
              autoFocus
              inputMode="numeric"
              value={draft}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(String(row.delivered));
                }
              }}
              className="h-7 w-20 text-right tabular-nums"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={saveEdit}
              disabled={pending}
              aria-label="Zapisz dowiezione"
            >
              <Check />
            </Button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(String(row.delivered));
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums transition-colors hover:bg-muted disabled:opacity-50"
          >
            {row.delivered}
            <Pencil className="size-3 text-muted-foreground" />
          </button>
        )}

        {row.balance > 0 ? (
          <StatusBadge tone="amber">−{row.balance}</StatusBadge>
        ) : row.balance < 0 ? (
          <StatusBadge tone="blue">+{-row.balance}</StatusBadge>
        ) : (
          <StatusBadge tone="green" dot>
            rozliczone
          </StatusBadge>
        )}

        {row.balance > 0 && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-primary"
            disabled={pending}
            onClick={() => commit(String(row.owed))}
            title="Ustaw dowiezione = całe zobowiązanie (kontrakt + dług)"
          >
            <PackageCheck data-icon="inline-start" /> paczka dostarczona
          </Button>
        )}
      </div>
    </div>
  );
}

export function ClientList({ month, rows }: { month: string; rows: NicheClientRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((r) => (
        <ClientRow key={r.clientId} month={month} row={r} />
      ))}
    </div>
  );
}
