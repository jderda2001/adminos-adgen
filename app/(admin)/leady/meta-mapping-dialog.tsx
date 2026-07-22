"use client";

// Przypisywanie Meta w 2 krokach: (1) KONTA reklamowe → jedna marka, „wiele
// marek (mieszane)" albo „konto klienta" (pomijane w całości), (2) KAMPANIE:
// konta jednomarkowe → tylko wertykal (marka z konta); konta mieszane →
// marka + wertykal per kampania. Podpowiedzi marki i wertykalu z nazwy
// kampanii (np. „ReBalancer | OZE | …"). Autozapis optymistyczny.

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
  mixed: boolean;
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
const MIXED = "__mixed__";
const CLIENT = "__client__";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9ąćęłńóśźż]+/g, "");

/** Podpowiedź wertykalu z nazwy kampanii (dopasowanie fragmentu). */
function suggestVertical(name: string, verticals: readonly string[]): string | null {
  const n = norm(name);
  for (const v of verticals) if (n.includes(norm(v))) return v;
  return null;
}

/** Podpowiedź marki z nazwy kampanii („ReBalancer" trafi w „Rebalancer"). */
function suggestBrand(name: string, brands: readonly BrandOption[]): BrandOption | null {
  const n = norm(name);
  for (const b of brands) if (n.includes(norm(b.name))) return b;
  return null;
}

interface AccState {
  brandId: string | null;
  mixed: boolean;
  ignored: boolean;
}
interface CampState {
  brandId: string | null;
  vertical: string | null;
  ignored: boolean;
}

const accDecided = (s: AccState) => s.ignored || s.mixed || Boolean(s.brandId);
const campDone = (s: CampState, mixed: boolean) =>
  s.ignored || (Boolean(s.vertical) && (!mixed || Boolean(s.brandId)));

// ── Krok 1: konto reklamowe ──────────────────────────────────────────
function AccountRow({
  row,
  state,
  brands,
  mixedHint,
  onChange,
}: {
  row: MetaAccountRowUi;
  state: AccState;
  brands: BrandOption[];
  /** heurystyka: nazwa konta/kampanii wskazuje na wiele marek */
  mixedHint: boolean;
  onChange: (value: string) => void;
}) {
  const value = state.ignored ? CLIENT : state.mixed ? MIXED : state.brandId ?? NONE;
  const showHint = mixedHint && !state.ignored && !state.mixed;
  return (
    <div
      className={cn(
        "rounded-xl border px-3.5 py-2.5",
        accDecided(state)
          ? "bg-card"
          : "border-amber-300 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
      )}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.adAccountName}</div>
          <div className="text-xs text-muted-foreground">
            {row.campaignCount} {pluralPl(row.campaignCount, "kampania", "kampanie", "kampanii")}
          </div>
        </div>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger size="sm" className="w-40 shrink-0 sm:w-56">
            <SelectValue placeholder="Czyje to konto?" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>— czyje to konto? —</SelectItem>
            <SelectItem value={MIXED}>Wiele marek na tym koncie</SelectItem>
            <SelectItem value={CLIENT}>Konto klienta — pomiń</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                tylko {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {showHint && (
        <button
          type="button"
          onClick={() => onChange(MIXED)}
          className="mt-2 flex w-full items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 py-1.5 text-left text-xs font-medium text-primary hover:bg-primary/15"
        >
          <Sparkles className="size-3.5 shrink-0" />
          Widzę tu kampanie kilku marek — kliknij, aby ustawić „Wiele marek"
        </button>
      )}
    </div>
  );
}

// ── Krok 2: kampania ─────────────────────────────────────────────────
function CampaignRow({
  row,
  state,
  accountMixed,
  accountBrandName,
  brands,
  verticals,
  onChange,
}: {
  row: MetaCampaignRowUi;
  state: CampState;
  accountMixed: boolean;
  accountBrandName: string | null;
  brands: BrandOption[];
  verticals: string[];
  onChange: (patch: Partial<CampState>) => void;
}) {
  const vSuggestion = useMemo(
    () => suggestVertical(row.metaCampaignName, verticals),
    [row.metaCampaignName, verticals]
  );
  const bSuggestion = useMemo(
    () => (accountMixed ? suggestBrand(row.metaCampaignName, brands) : null),
    [row.metaCampaignName, brands, accountMixed]
  );
  const brandName = accountMixed
    ? brands.find((b) => b.id === state.brandId)?.name ?? null
    : accountBrandName;

  if (campDone(state, accountMixed)) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-3.5 py-2 dark:border-emerald-900/50 dark:bg-emerald-950/25">
        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Check className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{row.metaCampaignName}</div>
          <div className="truncate text-xs text-muted-foreground">
            {state.ignored ? "pominięta" : `${brandName} · ${state.vertical}`}
          </div>
        </div>
        {state.ignored ? (
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
            onClick={() => onChange(accountMixed ? { vertical: null, brandId: null } : { vertical: null })}
          >
            Zmień
          </Button>
        )}
      </div>
    );
  }

  // sugestia „ustaw wszystko naraz" dla kont mieszanych
  const comboSuggestion = accountMixed && bSuggestion && vSuggestion;

  return (
    <div className="rounded-xl border bg-card px-3.5 py-3 shadow-[var(--shadow-card)]">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.metaCampaignName}</div>
          {!accountMixed && (
            <div className="text-xs text-muted-foreground">marka: {accountBrandName}</div>
          )}
        </div>
        <button
          type="button"
          className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onChange({ ignored: true })}
        >
          pomiń
        </button>
      </div>

      <div className={cn("grid gap-2", accountMixed ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
        {accountMixed && (
          <Select
            value={state.brandId ?? NONE}
            onValueChange={(v) => onChange({ brandId: v === NONE ? null : v })}
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
        )}
        <Select
          value={state.vertical ?? NONE}
          onValueChange={(v) => onChange({ vertical: v === NONE ? null : v })}
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

      {(comboSuggestion || (!accountMixed && vSuggestion) || (accountMixed && (bSuggestion || vSuggestion))) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {comboSuggestion ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange({ brandId: bSuggestion!.id, vertical: vSuggestion })}
            >
              <Sparkles data-icon="inline-start" /> {bSuggestion!.name} · {vSuggestion}
            </Button>
          ) : (
            <>
              {accountMixed && bSuggestion && !state.brandId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange({ brandId: bSuggestion.id })}
                >
                  <Sparkles data-icon="inline-start" /> {bSuggestion.name}
                </Button>
              )}
              {vSuggestion && !state.vertical && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onChange({ vertical: vSuggestion })}
                >
                  <Sparkles data-icon="inline-start" /> {vSuggestion}
                </Button>
              )}
            </>
          )}
        </div>
      )}
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

  // Stan = NAKŁADKA optymistyczna na wartości z serwera (fallback do propsów).
  // Dzięki temu konta/kampanie dograne po sync (router.refresh) nie wywracają
  // stanu zainicjalizowanego przy pierwszym renderze.
  const [accState, setAccState] = useState<Record<string, AccState>>({});
  const [campState, setCampState] = useState<Record<string, CampState>>({});
  const getAcc = (a: MetaAccountRowUi): AccState =>
    accState[a.adAccountId] ?? { brandId: a.brandId, mixed: a.mixed, ignored: a.ignored };
  const getCamp = (c: MetaCampaignRowUi): CampState =>
    campState[c.metaCampaignId] ?? { brandId: c.brandId, vertical: c.vertical, ignored: c.ignored };
  const accRowById = useMemo(
    () => new Map(accounts.map((a) => [a.adAccountId, a])),
    [accounts]
  );
  const getAccByCampaign = (c: MetaCampaignRowUi): AccState | null => {
    const row = accRowById.get(c.adAccountId);
    return row ? getAcc(row) : null;
  };

  const accountsPending = accounts.filter((a) => !accDecided(getAcc(a))).length;

  // heurystyka „konto wygląda na wielomarkowe": ≥2 marki w nazwie konta
  // (np. „adGen | ReBalancer | Sun Era…") lub ≥2 różne marki wykryte
  // w nazwach jego kampanii
  const mixedHints = useMemo(() => {
    const byAcc = new Map<string, Set<string>>();
    for (const c of campaigns) {
      const b = suggestBrand(c.metaCampaignName, brands);
      if (!b) continue;
      const set = byAcc.get(c.adAccountId) ?? new Set<string>();
      set.add(b.id);
      byAcc.set(c.adAccountId, set);
    }
    const hints = new Set<string>();
    for (const a of accounts) {
      const n = norm(a.adAccountName);
      const inName = brands.filter((b) => n.includes(norm(b.name))).length;
      const inCampaigns = byAcc.get(a.adAccountId)?.size ?? 0;
      if (inName >= 2 || inCampaigns >= 2) hints.add(a.adAccountId);
    }
    return hints;
  }, [accounts, campaigns, brands]);

  // krok 2: kampanie kont z marką lub mieszanych
  const step2Campaigns = campaigns.filter((c) => {
    const acc = getAccByCampaign(c);
    return acc && !acc.ignored && (acc.mixed || Boolean(acc.brandId));
  });
  const campaignsPending = step2Campaigns.filter((c) => {
    const acc = getAccByCampaign(c);
    return acc ? !campDone(getCamp(c), acc.mixed) : false;
  }).length;

  const [step, setStep] = useState<"konta" | "kampanie">(accountsPending > 0 ? "konta" : "kampanie");

  function changeAccount(row: MetaAccountRowUi, value: string) {
    const adAccountId = row.adAccountId;
    const prev = getAcc(row);
    const next: AccState =
      value === CLIENT
        ? { brandId: null, mixed: false, ignored: true }
        : value === MIXED
          ? { brandId: null, mixed: true, ignored: false }
          : { brandId: value === NONE ? null : value, mixed: false, ignored: false };
    setAccState((s) => ({ ...s, [adAccountId]: next }));
    startTransition(async () => {
      const r = await setAccountMappingAction({
        adAccountId,
        brandId: next.brandId ?? undefined,
        mixed: next.mixed,
        ignored: next.ignored,
      });
      if (!r.ok) {
        setAccState((s) => ({ ...s, [adAccountId]: prev }));
        toast.error(r.error);
      }
    });
  }

  function changeCampaign(row: MetaCampaignRowUi, patch: Partial<CampState>) {
    const metaCampaignId = row.metaCampaignId;
    const prev = getCamp(row);
    const next = { ...prev, ...patch };
    setCampState((s) => ({ ...s, [metaCampaignId]: next }));
    startTransition(async () => {
      const r = await setCampaignMappingAction({
        metaCampaignId,
        brandId: next.brandId ?? "",
        vertical: next.vertical ?? "",
        ignored: next.ignored,
      });
      if (!r.ok) {
        setCampState((s) => ({ ...s, [metaCampaignId]: prev }));
        toast.error(r.error);
      }
    });
  }

  const [showIgnored, setShowIgnored] = useState(false);
  const visibleAccounts = accounts.filter((a) => showIgnored || !getAcc(a).ignored);
  const hiddenCount = accounts.filter((a) => getAcc(a).ignored).length;

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
    step2Accounts.find((a) =>
      a.campaigns.some((c) => !campDone(getCamp(c), getAccByCampaign(c)?.mixed ?? false))
    ) ??
    step2Accounts[0];

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Przypisz konta i kampanie</DialogTitle>
          <DialogDescription>
            Najpierw powiedz, czyje jest każde konto reklamowe (jedna marka, wiele marek
            albo konto klienta — pomijane), potem uzupełnij kampanie. Zapis od razu.
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
                  row={a}
                  state={getAcc(a)}
                  brands={brands}
                  mixedHint={mixedHints.has(a.adAccountId)}
                  onChange={(v) => changeAccount(a, v)}
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
            description="Żadne konto nie jest jeszcze przypisane do marki (ani oznaczone jako mieszane) — wróć do kroku 1."
          />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {step2Accounts.map((a) => {
                const accRow = accRowById.get(a.id);
                const mixed = accRow ? getAcc(accRow).mixed : false;
                const left = a.campaigns.filter(
                  (c) => !campDone(getCamp(c), mixed)
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
                const acc = getAccByCampaign(c) ?? { brandId: null, mixed: false, ignored: false };
                return (
                  <CampaignRow
                    key={c.id}
                    row={c}
                    state={getCamp(c)}
                    accountMixed={acc.mixed}
                    accountBrandName={acc.brandId ? brandName.get(acc.brandId) ?? "?" : null}
                    brands={brands}
                    verticals={verticals}
                    onChange={(patch) => changeCampaign(c, patch)}
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
