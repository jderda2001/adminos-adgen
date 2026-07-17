// Uzgodnienie miesiąca: suma wydatków kampanii (wpisanych z Meta Ads Manager)
// vs koszty zaksięgowane w kategoriach budżetu reklamowego (moduł Koszty).
// Różnica ≈ 0 oznacza, że wpisy kampanii pokrywają realne przelewy do Mety.

import { StatusBadge } from "@/components/status-badge";
import { formatMoney } from "@/lib/format";

export function ReconciliationCard({
  campaignSpendGr,
  bookedAdCostsGr,
}: {
  campaignSpendGr: number;
  bookedAdCostsGr: number;
}) {
  const diff = bookedAdCostsGr - campaignSpendGr;
  const tone = diff === 0 ? "green" : Math.abs(diff) <= 10000 ? "amber" : "red";

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold">Uzgodnienie z Kosztami</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Kwoty netto. Różnica = przelewy do Mety zaksięgowane inaczej niż raport
        kampanii (np. niewpisana kampania albo inny miesiąc księgowania przelewu).
      </p>
      <div className="space-y-1.5 text-sm">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">Suma wydatków kampanii (wpisane)</span>
          <span className="font-medium tabular-nums">{formatMoney(campaignSpendGr)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">
            Koszty w kategoriach budżetu reklamowego (moduł Koszty)
          </span>
          <span className="font-medium tabular-nums">{formatMoney(bookedAdCostsGr)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-1.5">
          <span className="font-medium">Różnica</span>
          <StatusBadge tone={tone}>{formatMoney(diff)}</StatusBadge>
        </div>
      </div>
    </div>
  );
}
