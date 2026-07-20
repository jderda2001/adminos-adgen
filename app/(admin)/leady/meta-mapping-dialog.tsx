"use client";

// Przypisywanie Meta w 2 krokach: (1) KONTA reklamowe → marka wewnętrzna albo
// „konto klienta" (pomijane w całości — konta abonamentowe znikają z widoku),
// (2) KAMPANIE kont z marką → tylko wertykal (marka dziedziczona z konta),
// z podpowiedzią wertykalu z nazwy kampanii. Autozapis optymistyczny.

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Sparkles, Undo2 } from "lucide-react";
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
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { pluralPl } from "@/lib/format";
import type { BrandOption } from "./campaign-dialog";
import { setAccountMappingAction, setCampaignMappingAction } from "./meta-actions";

export interface MetaAccountRowUi {
  adAccountId: string;
  adAccountName: string;
  brandId: string | null;
  ignored: boolean;
  campaignCount: number;
}

export interface MetaCampaignRowUi {
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
const CLIENT = "__client__";

/** Podpowiedź wertykalu z nazwy kampanii (proste dopasowanie fragmentu). */
function suggestVertical(name: string, verticals: readonly string[]): string | null {
  const n = name.toLowerCase();
  for (const v of verticals) if (n.includes(v.toLowerCase())) return v;
  return null;
}

// ── Krok 1: konta reklamowe ──────────────────────────────────────────
function AccountRow({
  row,
  brands,
  onChange,
}: {
  row: MetaAccountRowUi;
  brands: BrandOption[];
  onChange: (value: string) => void;
}) {
  const value = row.ignored ? CLIENT : row.brandId ?? NONE;
  const decided = value !== NONE;
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3.5 py-2.5",
        decided ? "bg-card" : "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.adAccountName}</div>
        <div className="text-xs text-muted-foreground">
          {row.campaignCount} {pluralPl(row.campaignCount, "kampania", "kampanie", "kampanii")}
        </div>
      </div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-52 shrink-0">
          <SelectValue placeholder="Czyje to konto?" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>— czyje to konto? —</SelectItem>
          {brands.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
          <SelectItem value={CLIENT}>Konto klienta — pomiń</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ── Krok 2: kampania (tylko wertykal) ────────────────────────────────
function CampaignRow({
  row,
  brandName,
  vertical,
  ignored,
  verticals,
  onVertical,
  onIgnored,
}: {
  row: MetaCampaignRowUi;
  brandName: string;
  vertical: string | null;
  ignored: boolean;
  verticals: string[];
  onVertical: (v: string | null) => void;
  onIgnored: (v: boolean) => void;
}) {
  const suggestion = useMemo(
    () => suggestVertical(row.metaCampaignName, verticals),
    [row.metaCampaignName, verticals]
  );
  const done = ignored || Boolean(vertical);

  if (done) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/25">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.metaCampaignName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {ignored ? "pominięta" : `${brandName} · ${vertical}`}
          </div>
        </div>
        {ignored ? (
          <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground" onClick={() => onIgnored(false)}>
            <Undo2 data-icon="inline-start" /> Przywróć
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => onVertical(null)}
          >
            Zmień
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-card px-3.5 py-3 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.metaCampaignName}</div>
          <div className="text-xs text-muted-foreground">marka: {brandName}</div>
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onIgnored(true)}
        >
          pomiń
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Select value={vertical ?? NONE} onValueChange={(v) => onVertical(v === NONE ? null : v)}>
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
        {suggestion && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => onVertical(suggestion)}
          >
            <Sparkles data-icon="inline-start" /> {suggestion}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Dialog ───────────────────────────────────────────────────────────
export function MetaMappingDialog({
  accounts,
  campaigns,
  brands,
  verticals,
  trigger,
}: {
  accounts: MetaAccountRowUi[];
  campaigns: MetaCampaignRowUi[];
  brands: BrandOption[];
  verticals: string[];
  trigger: ReactNode;
}) {
  const brandName = useMemo(() => new Map(brands.map((b) => [b.id, b.name])), [brands]);
  const [, startTransition] = useTransition();

  // stan optymistyczny
  const [accState, setAccState] = useState<Record<string, { brandId: string | null; ignored: boolean }>>(
    () => Object.fromEntries(accounts.map((a) => [a.adAccountId, { brandId: a.brandId, ignored: a.ignored }]))
  );
  const [campState, setCampState] = useState<Record<string, { vertical: string | null; ignored: boolean }>>(
    () => Object.fromEntries(campaigns.map((c) => [c.metaCampaignId, { vertical: c.vertical, ignored: c.ignored }]))
  );

  const accountsPending = accounts.filter((a) => {
    const s = accState[a.adAccountId];
    return !s.ignored && !s.brandId;
  }).length;

  // kampanie do kroku 2: konta z marką (nie klienckie); marka per kampania = override ?? konto
  const step2Campaigns = campaigns.filter((c) => {
    const acc = accState[c.adAccountId];
    return acc && !acc.ignored && Boolean(c.brandId ?? acc.brandId);
  });
  const campaignsPending = step2Campaigns.filter((c) => {
    const s = campState[c.metaCampaignId];
    return !s.ignored && !s.vertical;
  }).length;

  const [step, setStep] = useState<"konta" | "kampanie">(accountsPending > 0 ? "konta" : "kampanie");

  function changeAccount(adAccountId: string, value: string) {
    const prev = accState[adAccountId];
    const next =
      value === CLIENT
        ? { brandId: null, ignored: true }
        : { brandId: value === NONE ? null : value, ignored: false };
    setAccState((s) => ({ ...s, [adAccountId]: next }));
    startTransition(async () => {
      const r = await setAccountMappingAction({
        adAccountId,
        brandId: next.brandId ?? undefined,
        ignored: next.ignored,
      });
      if (!r.ok) {
        setAccState((s) => ({ ...s, [adAccountId]: prev }));
        toast.error(r.error);
      }
    });
  }

  function changeCampaign(metaCampaignId: string, patch: Partial<{ vertical: string | null; ignored: boolean }>) {
    const prev = campState[metaCampaignId];
    const next = { ...prev, ...patch };
    setCampState((s) => ({ ...s, [metaCampaignId]: next }));
    startTransition(async () => {
      const r = await setCampaignMappingAction({
        metaCampaignId,
        vertical: next.vertical ?? "",
        ignored: next.ignored,
      });
      if (!r.ok) {
        setCampState((s) => ({ ...s, [metaCampaignId]: prev }));
        toast.error(r.error);
      }
    });
  }

  // konta ignorowane schowane pod przełącznikiem
  const [showIgnored, setShowIgnored] = useState(false);
  const visibleAccounts = accounts.filter((a) => showIgnored || !accState[a.adAccountId].ignored);
  const hiddenCount = accounts.length - accounts.filter((a) => !accState[a.adAccountId].ignored).length;

  // kampanie kroku 2 pogrupowane po koncie (piguły jak dotąd)
  const step2Accounts = useMemo(() => {
    const m = new Map<string, { id: string; name: string; campaigns: MetaCampaignRowUi[] }>();
    for (const c of step2Campaigns) {
      if (!m.has(c.adAccountId)) m.set(c.adAccountId, { id: c.adAccountId, name: c.adAccountName, campaigns: [] });
      m.get(c.adAccountId)!.campaigns.push(c);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "pl"));
  }, [step2Campaigns]);
  const [selectedAccId, setSelectedAccId] = useState<string | null>(null);
  const selectedAcc =
    step2Accounts.find((a) => a.id === selectedAccId) ??
    step2Accounts.find((a) => a.campaigns.some((c) => !campState[c.metaCampaignId].ignored && !campState[c.metaCampaignId].vertical)) ??
    step2Accounts[0];

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Przypisz konta i kampanie</DialogTitle>
          <DialogDescription>
            Najpierw powiedz, czyje jest każde konto reklamowe (konta klientów pomijamy),
            potem nadaj kampaniom wertykal. Zapis następuje od razu.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {(
            [
              { key: "konta", label: "1. Konta", badge: accountsPending },
              { key: "kampanie", label: "2. Kampanie", badge: campaignsPending },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setStep(t.key)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                step === t.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
              {t.badge > 0 ? (
                <StatusBadge tone="amber">{t.badge}</StatusBadge>
              ) : (
                <Check className="size-3.5 text-emerald-500" />
              )}
            </button>
          ))}
        </div>

        {step === "konta" ? (
          accounts.length === 0 ? (
            <EmptyState
              title="Brak kont"
              description={'Kliknij „Zaciągnij z Mety”, aby pobrać konta reklamowe portfolio.'}
            />
          ) : (
            <div className="max-h-[52vh] space-y-2 overflow-y-auto pr-0.5">
              {visibleAccounts.map((a) => (
                <AccountRow
                  key={a.adAccountId}
                  row={{ ...a, ...accState[a.adAccountId] }}
                  brands={brands}
                  onChange={(v) => changeAccount(a.adAccountId, v)}
                />
              ))}
              {hiddenCount > 0 && (
                <button
                  type="button"
                  className="w-full pt-1 text-center text-xs text-muted-foreground underline-offset-2 hover:underline"
                  onClick={() => setShowIgnored((v) => !v)}
                >
                  {showIgnored
                    ? "ukryj konta klienckie"
                    : `pokaż pominięte konta klienckie (${hiddenCount})`}
                </button>
              )}
            </div>
          )
        ) : step2Accounts.length === 0 ? (
          <EmptyState
            title="Najpierw przypisz konta"
            description="Żadne konto nie jest jeszcze przypisane do marki wewnętrznej — wróć do kroku 1."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {step2Accounts.map((a) => {
                const left = a.campaigns.filter(
                  (c) => !campState[c.metaCampaignId].ignored && !campState[c.metaCampaignId].vertical
                ).length;
                const active = a.id === selectedAcc?.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAccId(a.id)}
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
            <div className="max-h-[46vh] space-y-2 overflow-y-auto pr-0.5">
              {selectedAcc?.campaigns.map((c) => {
                const s = campState[c.metaCampaignId];
                const acc = accState[c.adAccountId];
                const bName = brandName.get(c.brandId ?? acc.brandId ?? "") ?? "?";
                return (
                  <CampaignRow
                    key={c.id}
                    row={c}
                    brandName={bName}
                    vertical={s.vertical}
                    ignored={s.ignored}
                    verticals={verticals}
                    onVertical={(v) => changeCampaign(c.metaCampaignId, { vertical: v })}
                    onIgnored={(v) => changeCampaign(c.metaCampaignId, { ignored: v })}
                  />
                );
              })}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
