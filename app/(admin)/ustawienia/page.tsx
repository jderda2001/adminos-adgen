import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { PageHeader } from "@/components/page-header";
import { ProfitabilityCard } from "./profitability-card";
import { BoaCard } from "./boa-card";
import { CompanyCard } from "./company-card";
import { CategoriesCard, type CategoryRow } from "./categories-card";

export const metadata: Metadata = { title: "Ustawienia" };

export default async function SettingsPage() {
  await requireAdmin();

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
  }));

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
        <CategoriesCard categories={categoryRows} />
      </div>
    </>
  );
}
