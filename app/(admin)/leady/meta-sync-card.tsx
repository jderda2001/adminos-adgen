"use client";

// Pasek integracji Meta: status + ostatnia synchronizacja + „Przypisz" (konta
// i kampanie) + „Zaciągnij z Mety". Celowo jednolinijkowy — szczegóły liczbowe
// są na kartach marek, nie tutaj.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatDate } from "@/lib/format";
import type { MetaStatus } from "@/lib/reports";
import {
  MetaMappingDialog,
  type MetaAccountRowUi,
  type MetaCampaignRowUi,
} from "./meta-mapping-dialog";
import type { BrandOption } from "./campaign-dialog";
import { syncMetaCampaignsAction } from "./meta-actions";

export function MetaSyncCard({
  month,
  status,
  accounts,
  campaigns,
  brands,
  verticals,
}: {
  month: string;
  status: MetaStatus;
  accounts: MetaAccountRowUi[];
  campaigns: MetaCampaignRowUi[];
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-4 py-2.5 shadow-[var(--shadow-card)]">
      <span className="text-sm font-semibold">Meta Ads</span>
      {status.mock ? (
        <StatusBadge tone="amber">dane testowe</StatusBadge>
      ) : (
        <StatusBadge tone="green" dot>
          połączona
        </StatusBadge>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {last
          ? last.ok
            ? `synchronizacja: ${formatDate(new Date(last.ranAt))} · ${last.campaignsPulled} kampanii`
            : `błąd synchronizacji: ${last.error}`
          : "jeszcze nie zaciągnięto danych"}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <MetaMappingDialog
          accounts={accounts}
          campaigns={campaigns}
          brands={brands}
          verticals={verticals}
          trigger={
            <Button variant="outline" size="sm">
              <SlidersHorizontal data-icon="inline-start" />
              Przypisz
              {status.pendingTotal > 0 && (
                <StatusBadge tone="amber" className="ml-1">
                  {status.pendingTotal}
                </StatusBadge>
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
  );
}
