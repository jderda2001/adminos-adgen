"use client";

// Mapowanie kampanii Meta → marka + wertykal. Najpierw wybór konta reklamowego,
// potem tylko jego kampanie. Przypisane chowają się do zwartego podsumowania,
// pasek postępu pokazuje ile zostało. Autozapis (optymistyczny) przy zmianie.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Pencil, Undo2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { cn } from "@/lib/utils";
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

interface MapValue {
  brandId: string | null;
  vertical: string | null;
  ignored: boolean;
}

const isDone = (v: MapValue) => v.ignored || (!!v.brandId && !!v.vertical);

// ── Pojedyncza kampania ──────────────────────────────────────────────
function CampaignRow({
  row,
  value,
  brands,
  verticals,
  onChange,
}: {
  row: MetaCampaignRow;
  value: MapValue;
  brands: BrandOption[];
  verticals: string[];
  onChange: (patch: Partial<MapValue>) => void;
}) {
  const done = isDone(value);
  const [editing, setEditing] = useState(false);
  const brandName = brands.find((b) => b.id === value.brandId)?.name;

  // widok zwarty — kampania już przypisana lub pominięta
  if (done && !editing) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/25">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.metaCampaignName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {value.ignored ? "pominięta (nie liczę do kosztów)" : `${brandName} · ${value.vertical}`}
          </div>
        </div>
        {value.ignored ? (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => onChange({ ignored: false })}
          >
            <Undo2 data-icon="inline-start" /> Przywróć
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil data-icon="inline-start" /> Zmień
          </Button>
        )}
      </div>
    );
  }

  // widok edycji — do przypisania
  return (
    <div className="rounded-xl border bg-card px-3.5 py-3 shadow-[var(--shadow-card)]">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-medium">{row.metaCampaignName}</div>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => {
            onChange({ ignored: true });
            setEditing(false);
          }}
        >
          pomiń
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Marka
          </span>
          <Select
            value={value.brandId ?? NONE}
            onValueChange={(v) => onChange({ brandId: v === NONE ? null : v })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Wybierz markę" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— wybierz markę —</SelectItem>
              {brands.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Wertykal
          </span>
          <Select
            value={value.vertical ?? NONE}
            onValueChange={(v) => onChange({ vertical: v === NONE ? null : v })}
          >
            <SelectTrigger size="sm" className="w-full">
              <SelectValue placeholder="Wybierz wertykal" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>— wybierz wertykal —</SelectItem>
              {verticals.map((v) => (
                <SelectItem key={v} value={v}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
      {editing && (
        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
            Gotowe
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Dialog: konta → kampanie ─────────────────────────────────────────
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
  // konta reklamowe (grupy) posortowane po nazwie
  const accounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; campaigns: MetaCampaignRow[] }>();
    for (const c of campaigns) {
      if (!m.has(c.adAccountId))
        m.set(c.adAccountId, { id: c.adAccountId, name: c.adAccountName, campaigns: [] });
      m.get(c.adAccountId)!.campaigns.push(c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "pl"));
  }, [campaigns]);

  // stan mapowania (optymistyczny) keyed by metaCampaignId
  const [values, setValues] = useState<Record<string, MapValue>>(() => {
    const s: Record<string, MapValue> = {};
    for (const c of campaigns)
      s[c.metaCampaignId] = { brandId: c.brandId, vertical: c.vertical, ignored: c.ignored };
    return s;
  });
  const [, startTransition] = useTransition();

  const unmappedCount = (acc: (typeof accounts)[number]) =>
    acc.campaigns.filter((c) => values[c.metaCampaignId] && !isDone(values[c.metaCampaignId])).length;

  const [selectedId, setSelectedId] = useState<string>(() => {
    const firstToDo = accounts.find(
      (a) => a.campaigns.some((c) => c.brandId === null || c.vertical === null ? !c.ignored : false)
    );
    return (firstToDo ?? accounts[0])?.id ?? "";
  });
  const selected = accounts.find((a) => a.id === selectedId) ?? accounts[0];

  function handleChange(id: string, patch: Partial<MapValue>) {
    const prev = values[id];
    const next: MapValue = { ...prev, ...patch };
    setValues((v) => ({ ...v, [id]: next }));
    const payload = {
      metaCampaignId: id,
      brandId: next.ignored ? "" : next.brandId ?? "",
      vertical: next.ignored ? "" : next.vertical ?? "",
      ignored: next.ignored,
    };
    startTransition(async () => {
      const r = await setCampaignMappingAction(payload);
      if (!r.ok) {
        setValues((v) => ({ ...v, [id]: prev })); // cofnij przy błędzie
        toast.error(r.error);
      }
    });
  }

  const total = selected?.campaigns.length ?? 0;
  const doneCount = selected ? total - unmappedCount(selected) : 0;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Przypisz kampanie z Meta</DialogTitle>
          <DialogDescription>
            Wybierz konto reklamowe, a potem przypisz jego kampanie do marki i wertykalu.
            Zmiany zapisują się od razu.
          </DialogDescription>
        </DialogHeader>

        {accounts.length === 0 ? (
          <EmptyState
            title="Brak kampanii"
            description={"Kliknij „Zaciągnij z Mety”, aby pobrać kampanie ze wszystkich kont."}
          />
        ) : (
          <div className="space-y-4">
            {/* wybór konta reklamowego */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Konto reklamowe
              </span>
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => {
                  const left = unmappedCount(a);
                  const active = a.id === selected?.id;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "border-primary/30 bg-primary/10 font-medium text-primary"
                          : "border-border bg-muted/40 text-foreground hover:bg-muted"
                      )}
                    >
                      {a.name}
                      {left > 0 ? (
                        <span className="grid min-w-5 place-items-center rounded-full bg-amber-500/20 px-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
                          {left}
                        </span>
                      ) : (
                        <Check className="size-3.5 text-emerald-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* postęp dla wybranego konta */}
            {selected && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Przypisano <span className="font-medium text-foreground">{doneCount}</span> z{" "}
                    {total}
                  </span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {/* kampanie wybranego konta */}
            <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-0.5">
              {selected?.campaigns.map((c) => (
                <CampaignRow
                  key={c.id}
                  row={c}
                  value={values[c.metaCampaignId]}
                  brands={brands}
                  verticals={verticals}
                  onChange={(patch) => handleChange(c.metaCampaignId, patch)}
                />
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
