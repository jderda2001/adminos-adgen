import type { Metadata } from "next";
import { headers } from "next/headers";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isMetaConfigured } from "@/lib/meta-ads";
import { PageHeader } from "@/components/page-header";
import { ProfitabilityCard } from "./profitability-card";
import { BoaCard } from "./boa-card";
import { CompanyCard } from "./company-card";
import { CategoriesCard, type CategoryRow } from "./categories-card";
import { IntegrationsCard } from "./integrations-card";

export const metadata: Metadata = { title: "Ustawienia" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ meta?: string; msg?: string }>;
}) {
  await requireAdmin();

  const sp = await searchParams;
  const [settings, categories] = await Promise.all([
    getSettings(),
    db.costCategory.findMany({
      include: { _count: { select: { costs: true, recurringCosts: true } } },
      orderBy: { position: "asc" },
    }),
  ]);

  const categoryRows: CategoryRow[] = categories.map((c) => ({
    id: c.id,
    name: c.name,
    costsCount: c._count.costs,
    recurringCount: c._count.recurringCosts,
    isSalary: c.isSalary,
    isAdBudget: c.isAdBudget,
    isDeferred: c.isDeferred,
  }));

  // adres powrotny OAuth: z ustawienia lub z nagłówków żądania (proxy)
  const h = await headers();
  const configuredBase = settings.meta_oauth_base_url.trim();
  const oauthBase = (
    configuredBase ||
    `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host") ?? ""}`
  ).replace(/\/+$/, "");
  const metaCallbackUrl = `${oauthBase}/api/meta/oauth/callback`;
  const metaConnected = await isMetaConfigured();

  return (
    <>
      <PageHeader
        title="Ustawienia"
        description="Konfiguracja rentowności, dane firmy do przelewów Elixir i słownik kategorii kosztów"
      />
      <div className="max-w-3xl space-y-6">
        <ProfitabilityCard
          allocationEnabled={settings.allocation_enabled === "1"}
          marginThresholdPct={settings.margin_threshold_pct}
        />
        <BoaCard
          targets={{
            oszczednosci: settings.boa_oszczednosci_pct,
            wlasciciele: settings.boa_wlasciciele_pct,
            operacyjne: settings.boa_operacyjne_pct,
            podatki: settings.boa_podatki_pct,
          }}
        />
        <CompanyCard
          name={settings.company_name}
          address={settings.company_address}
          account={settings.company_account}
        />
        <IntegrationsCard
          connected={metaConnected}
          appId={settings.meta_app_id}
          hasSecret={Boolean(settings.meta_app_secret) || Boolean(process.env.META_APP_SECRET)}
          baseUrl={settings.meta_oauth_base_url}
          callbackUrl={metaCallbackUrl}
          metaAutosyncEnabled={settings.meta_autosync_enabled === "1"}
          flash={sp.meta ?? null}
          flashMsg={sp.msg ?? null}
        />
        <CategoriesCard categories={categoryRows} />
      </div>
    </>
  );
}
