"use client";

// Mapowanie kampanii Meta → marka + wertykal. Kampanie z całego portfolio,
// grupowane po koncie reklamowym; niezmapowane na górze. Autozapis przy zmianie.

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import type { BrandOption } from "./campaign-dialog";
import { setCampaignMappingAction } from "./meta-actions";

export interface MetaCampaignRow {
  id: string;
  metaCampaignId: string;
  metaCampaignName: string;
  adAccountId: string;
  adAccountName: string;
  brandId: string | null;
  vertical: string | null;
  ignored: boolean;
}

const NONE = "__none__";

function MappingRow({
  row,
  brands,
  verticals,
}: {
  row: MetaCampaignRow;
  brands: BrandOption[];
  verticals: string[];
}) {
  const [brandId, setBrandId] = useState(row.brandId ?? NONE);
  const [vertical, setVertical] = useState(row.vertical ?? NONE);
  const [ignored, setIgnored] = useState(row.ignored);
  const [pending, startTransition] = useTransition();

  function save(next: { brandId?: string; vertical?: string; ignored?: boolean }) {
    const payload = {
      metaCampaignId: row.metaCampaignId,
      brandId: (next.brandId ?? brandId) === NONE ? "" : (next.brandId ?? brandId),
      vertical: (next.vertical ?? vertical) === NONE ? "" : (next.vertical ?? vertical),
      ignored: next.ignored ?? ignored,
    };
    startTransition(async () => {
      const res = await setCampaignMappingAction(payload);
      if (res.ok) toast.success(res.message ?? "Zapisano");
      else toast.error(res.error);
    });
  }

  const unmapped = !ignored && (brandId === NONE || vertical === NONE);

  return (
    <div className="rounded-lg border px-3 py-2.5" data-unmapped={unmapped}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{row.metaCampaignName}</span>
            {unmapped && <StatusBadge tone="red">do zmapowania</StatusBadge>}
          </div>
          <div className="text-xs text-muted-foreground">{row.adAccountName}</div>
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          ignoruj
          <Switch
            checked={ignored}
            disabled={pending}
            onCheckedChange={(v) => {
              setIgnored(v);
              save({ ignored: v });
            }}
            aria-label={`Ignoruj kampanię ${row.metaCampaignName}`}
          />
        </label>
      </div>
      {!ignored && (
        <div className="grid grid-cols-2 gap-2">
          <Select
            value={brandId}
            disabled={pending}
            onValueChange={(v) => {
              setBrandId(v);
              save({ brandId: v });
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Marka" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— marka —</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={vertical}
            disabled={pending}
            onValueChange={(v) => {
              setVertical(v);
              save({ vertical: v });
            }}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Wertykal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— wertykal —</SelectItem>
              {verticals.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export function MetaMappingDialog({
  campaigns,
  brands,
  verticals,
  trigger,
}: {
  campaigns: MetaCampaignRow[];
  brands: BrandOption[];
  verticals: string[];
  trigger: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Mapowanie kampanii Meta</DialogTitle>
          <DialogDescription>
            Przypisz każdą kampanię do marki i wertykalu (albo „ignoruj"). Zmiany
            zapisują się od razu; kliknij „Zaciągnij z Mety" ponownie, aby
            przeliczyć wydatki wg mapowania.
          </DialogDescription>
        </DialogHeader>
        {campaigns.length === 0 ? (
          <EmptyState
            title="Brak kampanii"
            description={'Kliknij „Zaciągnij z Mety”, aby pobrać listę kampanii ze wszystkich kont.'}
          />
        ) : (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {campaigns.map((c) => (
              <MappingRow key={c.id} row={c} brands={brands} verticals={verticals} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
