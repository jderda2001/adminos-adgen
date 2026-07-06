"use client";

// Sekcja "Do potwierdzenia" — kopie kosztów cyklicznych wygenerowane za bieżący
// miesiąc; nie liczą się do agregatów, dopóki nie zostaną zatwierdzone.

import { useMemo, useTransition } from "react";
import { Check, CheckCheck, Repeat, X } from "lucide-react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatMoney, pluralPl } from "@/lib/format";
import {
  confirmAllCostsAction,
  confirmCostAction,
  rejectCostAction,
} from "./actions";

export interface PendingCostRow {
  id: string;
  supplierName: string;
  docNumber: string;
  grossGr: number;
  categoryName: string;
}

export function PendingCosts({ items }: { items: PendingCostRow[] }) {
  const [pending, startTransition] = useTransition();

  const totalGr = useMemo(
    () => items.reduce((acc, i) => acc + i.grossGr, 0),
    [items]
  );

  function run(
    action: () => Promise<{ ok: boolean; message?: string; error?: string }>
  ) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge tone="amber">
            <Repeat className="size-3.5" /> Do potwierdzenia
          </StatusBadge>
          <div className="text-sm text-muted-foreground">
            {items.length}{" "}
            {pluralPl(items.length, "kopia", "kopie", "kopii")} kosztów
            cyklicznych za bieżący miesiąc ·{" "}
            <span className="font-medium tabular-nums text-foreground">
              {formatMoney(totalGr)}
            </span>{" "}
            brutto
          </div>
        </div>
        <Button
          size="sm"
          disabled={pending}
          onClick={() => run(confirmAllCostsAction)}
        >
          <CheckCheck className="size-4" /> Zatwierdź wszystkie
        </Button>
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{item.supplierName}</span>
              <span className="text-sm text-muted-foreground">
                {item.docNumber}
              </span>
              <StatusBadge tone="neutral">{item.categoryName}</StatusBadge>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium tabular-nums">
                {formatMoney(item.grossGr)}
              </span>
              <div className="flex gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  disabled={pending}
                  onClick={() => run(() => confirmCostAction(item.id))}
                >
                  <Check className="size-3.5" /> Zatwierdź
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  disabled={pending}
                  onClick={() => run(() => rejectCostAction(item.id))}
                >
                  <X className="size-3.5" /> Odrzuć
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
