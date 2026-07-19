"use client";

// Karta integracji Meta: „Zaciągnij z Mety" + status ostatniej synchronizacji +
// wejście do mapowania kampanii. Dane zaciągane z całego portfolio (wiele kont).

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney, formatDate } from "@/lib/format";
import type { MetaStatus } from "@/lib/reports";
import { MetaMappingDialog, type MetaCampaignRow } from "./meta-mapping-dialog";
import type { BrandOption } from "./campaign-dialog";
import { syncMetaCampaignsAction } from "./meta-actions";

export function MetaSyncCard({
  month,
  status,
  campaigns,
  brands,
  verticals,
}: {
  month: string;
  status: MetaStatus;
  campaigns: MetaCampaignRow[];
  brands: BrandOption[];
  verticals: string[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      const res = await syncMetaCampaignsAction(month);
      if (res.ok) {
        toast.success(res.message ?? "Zaciągnięto z Meta");
        router.refresh();
      } else {
        toast.error(res.error);
      }
    });
  }

  const last = status.lastRun;

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Integracja Meta Ads</h2>
            {status.mock ? (
              <StatusBadge tone="amber">tryb testowy (mock)</StatusBadge>
            ) : (
              <StatusBadge tone="green">podłączona</StatusBadge>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Wydatki i leady zaciągane z całego portfolio (wszystkie konta reklamowe).
            {status.mock && " Podłącz token na serwerze, aby przełączyć na realne dane."}
          </p>
          {last && (
            <p className="mt-2 text-xs text-muted-foreground">
              Ostatnia synchronizacja: <span className="text-foreground">{formatDate(new Date(last.ranAt))}</span>
              {" · "}
              {last.ok ? (
                <>
                  {last.campaignsPulled} kampanii, {last.mappedCount} zmapowanych
                  {last.unmappedSpendGr > 0 && (
                    <> · nieprzypisany spend {formatMoney(last.unmappedSpendGr)}</>
                  )}
                </>
              ) : (
                <span className="text-red-600 dark:text-red-400">błąd: {last.error}</span>
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <MetaMappingDialog
            campaigns={campaigns}
            brands={brands}
            verticals={verticals}
            trigger={
              <Button variant="outline" size="sm">
                <SlidersHorizontal data-icon="inline-start" />
                Mapuj kampanie
                {status.unmappedCount > 0 && (
                  <StatusBadge tone="red" className="ml-1">{status.unmappedCount}</StatusBadge>
                )}
              </Button>
            }
          />
          <Button size="sm" onClick={sync} disabled={pending}>
            <RefreshCw data-icon="inline-start" className={pending ? "animate-spin" : undefined} />
            {pending ? "Zaciągam…" : "Zaciągnij z Mety"}
          </Button>
        </div>
      </div>

      {status.unmappedCount > 0 && (
        <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          {status.unmappedCount}{" "}
          {status.unmappedCount === 1 ? "kampania czeka" : "kampanii czeka"} na przypisanie do
          marki i wertykalu — do tego czasu jej wydatki są „nieprzypisane" (nie liczą się
          klientom). Kliknij „Mapuj kampanie".
        </p>
      )}
    </div>
  );
}
