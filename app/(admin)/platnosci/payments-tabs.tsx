"use client";

// Zakładki modułu Płatności — segmentowany pasek (spójny z finance-tabs):
// rounded-lg border bg-card p-1, aktywna bg-primary text-primary-foreground,
// z licznikami. Stan kliencki zsynchronizowany z parametrem URL ?zakladka=
// (replaceState, bez przeładowania po stronie serwera).

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PayablesTable, type PayableRow } from "./payables-table";
import { ReceivablesTable, type ReceivableRow } from "./receivables-table";

export type PaymentsTab = "do-zaplaty" | "do-sciagniecia";

export function PaymentsTabs({
  defaultTab,
  payables,
  receivables,
}: {
  defaultTab: PaymentsTab;
  payables: PayableRow[];
  receivables: ReceivableRow[];
}) {
  const [tab, setTab] = useState<PaymentsTab>(defaultTab);

  function handleChange(value: PaymentsTab) {
    setTab(value);
    const url = new URL(window.location.href);
    url.searchParams.set("zakladka", value);
    window.history.replaceState(null, "", url.toString());
  }

  const tabs: { value: PaymentsTab; label: string; count: number }[] = [
    { value: "do-zaplaty", label: "Do zapłaty", count: payables.length },
    {
      value: "do-sciagniecia",
      label: "Do ściągnięcia",
      count: receivables.length,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-1 rounded-lg border bg-card p-1 shadow-[var(--shadow-card)]">
        {tabs.map((t) => {
          const active = tab === t.value;
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => handleChange(t.value)}
              className={cn(
                "inline-flex items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-xs tabular-nums",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {t.count}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "do-zaplaty" ? (
        <PayablesTable payables={payables} />
      ) : (
        <ReceivablesTable receivables={receivables} />
      )}
    </div>
  );
}
