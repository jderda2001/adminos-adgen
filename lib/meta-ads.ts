import "server-only";

// Klient Meta Marketing API (Insights) — server-only. Zaciąga wydatki i liczbę
// leadów per kampania z CAŁEGO portfolio (wszystkie konta widoczne dla tokena),
// więc równoległe kampanie na wielu kontach nie są problemem.
//
// Token: z bazy (ustawienie meta_access_token — z OAuth „Połącz z FB" lub wklejony
// ręcznie w Ustawieniach), a w razie braku z env META_ACCESS_TOKEN. Poświadczenia
// nigdy nie trafiają do repo (DB jest gitignored). Pozostała konfiguracja z env:
//   META_API_VERSION          — np. "v21.0" (domyślnie)
//   META_AD_ACCOUNT_ALLOWLIST — opcjonalnie CSV act_… (ogranicz do wybranych kont)
//   META_LEAD_ACTION_TYPES    — CSV akcji liczonych jako lead (domyślnie Lead Ads)
//   META_MOCK=1               — wymuś dane testowe nawet przy obecnym tokenie
//
// Bez tokena → tryb MOCK (deterministyczne dane), żeby moduł działał do czasu
// podłączenia konta Meta.

import { getSetting } from "./settings";

const GRAPH = "https://graph.facebook.com";

// UWAGA: Meta raportuje JEDNO zgłoszenie formularza pod wieloma nazwami akcji o
// tej samej wartości (lead, onsite_conversion.lead_grouped, offsite_*_add_meta_leads).
// Liczymy TYLKO „lead" (kanoniczna, obejmuje leady on- i offsite) — sumowanie
// kilku typów podwajało wynik (np. 1156 zamiast 578).
const DEFAULT_LEAD_ACTIONS = ["lead"];

/**
 * Token dostępu Meta: najpierw z bazy (ustawiony przez OAuth „Połącz z FB" lub
 * ręcznie w Ustawieniach), a w razie braku — z env (wdrożenia z tokenem w .env).
 */
export async function metaAccessToken(): Promise<string | null> {
  const fromDb = (await getSetting("meta_access_token")).trim();
  if (fromDb) return fromDb;
  const fromEnv = process.env.META_ACCESS_TOKEN?.trim();
  return fromEnv || null;
}

export interface MetaAdAccount {
  id: string; // "act_<n>"
  name: string;
  currency: string;
  status: number; // 1 = ACTIVE
}

export interface MetaCampaignInsight {
  campaignId: string;
  campaignName: string;
  adAccountId: string;
  adAccountName: string;
  spendGr: number; // grosze (netto wg konta)
  leadsCount: number;
  currency: string;
}

export async function isMetaConfigured(): Promise<boolean> {
  return Boolean(await metaAccessToken());
}

export async function isMetaMock(): Promise<boolean> {
  if (process.env.META_MOCK === "1") return true;
  return !(await metaAccessToken());
}

function apiVersion(): string {
  return process.env.META_API_VERSION || "v21.0";
}

function leadActionTypes(): string[] {
  const raw = process.env.META_LEAD_ACTION_TYPES?.trim();
  if (!raw) return DEFAULT_LEAD_ACTIONS;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function allowlist(): Set<string> | null {
  const raw = process.env.META_AD_ACCOUNT_ALLOWLIST?.trim();
  if (!raw) return null;
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Suma akcji-leadów z tablicy `actions` Meta wg skonfigurowanych typów. */
function countLeads(actions: unknown, types: string[]): number {
  if (!Array.isArray(actions)) return 0;
  let sum = 0;
  for (const a of actions) {
    if (a && typeof a === "object") {
      const o = a as { action_type?: unknown; value?: unknown };
      if (typeof o.action_type === "string" && types.includes(o.action_type)) {
        const v = Number(o.value);
        if (Number.isFinite(v)) sum += v;
      }
    }
  }
  return sum;
}

function spendToGrosze(spend: unknown): number {
  const v = typeof spend === "string" ? parseFloat(spend) : Number(spend);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}

async function graphGet(path: string, params: Record<string, string>): Promise<unknown> {
  const token = await metaAccessToken();
  if (!token) throw new Error("Brak tokena Meta (podłącz konto w Ustawieniach)");
  const url = new URL(`${GRAPH}/${apiVersion()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  const res = await fetch(url, { cache: "no-store" });
  const json: unknown = await res.json();
  if (!res.ok) {
    const err = (json as { error?: { message?: string } })?.error?.message;
    throw new Error(`Meta API ${res.status}: ${err ?? "błąd"}`);
  }
  return json;
}

/** Pobiera wszystkie strony edge'a `data` (obsługa paging.next). */
async function graphGetAll(path: string, params: Record<string, string>): Promise<unknown[]> {
  const out: unknown[] = [];
  let page = (await graphGet(path, params)) as { data?: unknown[]; paging?: { next?: string } };
  let guard = 0;
  while (page && Array.isArray(page.data)) {
    out.push(...page.data);
    const next = page.paging?.next;
    if (!next || guard++ > 50) break;
    const res = await fetch(next, { cache: "no-store" });
    page = (await res.json()) as { data?: unknown[]; paging?: { next?: string } };
  }
  return out;
}

/** Wszystkie konta reklamowe widoczne dla tokena (portfolio), po filtrze allowlist. */
export async function fetchAdAccounts(): Promise<MetaAdAccount[]> {
  if (await isMetaMock()) return mockAdAccounts();
  const rows = await graphGetAll("me/adaccounts", {
    fields: "account_id,name,currency,account_status",
    limit: "200",
  });
  const allow = allowlist();
  return rows
    .map((r) => {
      const o = r as Record<string, unknown>;
      return {
        id: `act_${String(o.account_id ?? "")}`,
        name: String(o.name ?? "?"),
        currency: String(o.currency ?? "PLN"),
        status: Number(o.account_status ?? 0),
      };
    })
    .filter((a) => (allow ? allow.has(a.id) : true));
}

/**
 * Wydatki i leady per kampania za miesiąc "RRRR-MM" ze WSZYSTKICH kont.
 * Zwraca też kampanie z zerowymi wynikami (do mapowania).
 */
export async function fetchCampaignInsights(month: string): Promise<MetaCampaignInsight[]> {
  if (await isMetaMock()) return mockInsights(month);

  const { from, to } = monthBounds(month);
  const timeRange = JSON.stringify({ since: from, until: to });
  const types = leadActionTypes();
  const accounts = await fetchAdAccounts();
  const out: MetaCampaignInsight[] = [];

  for (const acc of accounts) {
    const rows = await graphGetAll(`${acc.id}/insights`, {
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,actions",
      time_range: timeRange,
      limit: "500",
    });
    for (const r of rows) {
      const o = r as Record<string, unknown>;
      out.push({
        campaignId: String(o.campaign_id ?? ""),
        campaignName: String(o.campaign_name ?? "?"),
        adAccountId: acc.id,
        adAccountName: acc.name,
        spendGr: spendToGrosze(o.spend),
        leadsCount: countLeads(o.actions, types),
        currency: acc.currency,
      });
    }
  }
  return out;
}

// ── Tryb MOCK (deterministyczny, bez losowości) ──────────────────────

function mockAdAccounts(): MetaAdAccount[] {
  return [
    { id: "act_1000000000001", name: "adGen — Meta konto A", currency: "PLN", status: 1 },
    { id: "act_1000000000002", name: "adGen — Meta konto B", currency: "PLN", status: 1 },
  ];
}

// prosty deterministyczny „szum" z ciągu znaków (bez Math.random)
function seedFrom(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function mockInsights(month: string): MetaCampaignInsight[] {
  const accs = mockAdAccounts();
  // Nazwy generyczne (repo publiczne) — realne marki przychodzą z API po podłączeniu tokena.
  const defs = [
    { acc: 0, name: "Marka A | SKD | prospecting", baseSpend: 1_290_000, baseLeads: 430 },
    { acc: 0, name: "Marka B | OZE | retargeting", baseSpend: 240_000, baseLeads: 60 },
    { acc: 1, name: "Marka C | Kredyty firmowe", baseSpend: 500_000, baseLeads: 80 },
    { acc: 1, name: "Marka D | Restrukturyzacje", baseSpend: 320_000, baseLeads: 40 },
  ];
  return defs.map((d, i) => {
    const s = seedFrom(`${month}|${i}`);
    const spendGr = d.baseSpend + (s % 20000) - 10000; // ±100 zł wahania per miesiąc
    const leadsCount = d.baseLeads + ((s >> 5) % 21) - 10; // ±10 leadów
    return {
      campaignId: `mock_${i}_${d.acc}`,
      campaignName: d.name,
      adAccountId: accs[d.acc].id,
      adAccountName: accs[d.acc].name,
      spendGr: Math.max(0, spendGr),
      leadsCount: Math.max(0, leadsCount),
      currency: "PLN",
    };
  });
}

/**
 * Zakres dat do time_range Meta. Od 1. dnia miesiąca do OSTATNIEGO dnia — ale
 * dla bieżącego miesiąca ucinamy do DZIŚ (MTD: nie zaciągamy „z przyszłości",
 * pokazujemy stan na dzień synchronizacji). Miesiące przeszłe = pełny miesiąc.
 */
function monthBounds(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const last = `${month}-${String(lastDay).padStart(2, "0")}`;
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
  // bieżący miesiąc → do dziś; przeszły → pełny; (przyszły nie jest synchronizowany)
  const to = todayStr >= first && todayStr < last ? todayStr : last;
  return { from: first, to };
}
