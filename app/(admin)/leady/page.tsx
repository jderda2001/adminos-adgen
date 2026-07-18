import type { Metadata } from "next";
import { Settings2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getLeadMonthData } from "@/lib/reports";
import { monthKey } from "@/lib/periods";
import { todayUTC } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { MonthNav } from "./month-nav";
import { CampaignsCard } from "./campaigns-card";
import { DeliveriesCard } from "./deliveries-card";
import { ReconciliationCard } from "./reconciliation-card";
import { BrandsDialog, type BrandRow } from "./brands-dialog";
import type { BrandOption } from "./campaign-dialog";
import type { ClientOption } from "./delivery-dialog";

export const metadata: Metadata = { title: "Leady" };

// Ekonomika leadów: kampanie marek wewnętrznych (marka × wertykal, spend+leady
// z Meta Ads Manager → CPL) i dostawy leadów do klientów (koszt = leady × CPL,
// wchodzi do rentowności klienta). Uzgodnienie z przelewami do Mety w Kosztach.
export default async function LeadyPage({
  searchParams,
}: {
  searchParams: Promise<{ od?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const requested = params.od;
  const month =
    requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested)
      ? requested
      : monthKey(todayUTC());

  const [data, brandRows, clientRows] = await Promise.all([
    getLeadMonthData(month),
    db.brand.findMany({
      orderBy: { position: "asc" },
      include: { _count: { select: { campaigns: true, deliveries: true } } },
    }),
    db.client.findMany({
      where: { status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: { id: true, name: true, billingModel: true },
    }),
  ]);

  const brands: BrandOption[] = brandRows.map((b) => ({
    id: b.id,
    name: b.name,
    active: b.active,
  }));
  const brandsForDialog: BrandRow[] = brandRows.map((b) => ({
    id: b.id,
    name: b.name,
    active: b.active,
    usageCount: b._count.campaigns + b._count.deliveries,
  }));
  const clients: ClientOption[] = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    isLeadClient: c.billingModel === "PAKIETY_LEADOW",
  }));

  const unassignedGr = data.bookedAdCostsGr - data.totals.assignedCostGr;

  // wertykale z użyteczną kampanią (leady>0) — do ostrzeżeń o dostawach bez wyceny
  const verticalsWithCampaign = [
    ...new Set(data.campaigns.filter((c) => c.leadsCount > 0).map((c) => c.vertical)),
  ];
  // dostawy, które nie mają z czego policzyć CPL (koszt 0) — do zbiorczego alertu
  const unpricedDeliveries = data.deliveries.filter((d) => d.source === "BRAK_KAMPANII");

  return (
    <>
      <PageHeader
        title="Leady"
        description="Kampanie marek wewnętrznych i dostawy leadów do klientów — CPL i koszt leadów per klient"
      >
        <MonthNav month={month} />
        <BrandsDialog
          brands={brandsForDialog}
          trigger={
            <Button variant="outline" size="sm">
              <Settings2 data-icon="inline-start" /> Marki
            </Button>
          }
        />
      </PageHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-5">
          <KpiCard
            label="Wydatki na kampanie"
            value={formatMoney(data.totals.spendGr)}
            sub="netto, z Meta Ads Manager"
          />
          <KpiCard
            label="Leady z kampanii"
            value={String(data.totals.campaignLeads)}
            sub={`dostarczone klientom: ${data.totals.deliveredLeads}`}
          />
          <KpiCard
            label="Śr. CPL"
            value={data.totals.avgCplGr !== null ? formatMoney(data.totals.avgCplGr) : "—"}
            sub="wydatki / leady"
          />
          <KpiCard
            label="Koszt przypisany klientom"
            value={formatMoney(data.totals.assignedCostGr)}
            sub="suma dostaw × CPL"
          />
          <KpiCard
            label="Nieprzypisany spend"
            value={formatMoney(unassignedGr)}
            sub="księgowania − przypisane"
            tone={unassignedGr > 0 ? "warning" : unassignedGr < 0 ? "negative" : "default"}
          />
        </div>

        {unpricedDeliveries.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {unpricedDeliveries.length}{" "}
            {unpricedDeliveries.length === 1
              ? "dostawa nie ma kampanii do wyceny"
              : "dostaw nie ma kampanii do wyceny"}{" "}
            (koszt 0 zł) — wpisz kampanię dla wertykali:{" "}
            <span className="font-medium">
              {[...new Set(unpricedDeliveries.map((d) => d.vertical))].join(", ")}
            </span>
            . Do tego czasu koszt leadów tych klientów jest zaniżony.
          </div>
        )}

        <CampaignsCard month={month} campaigns={data.campaigns} brands={brands} />
        <DeliveriesCard
          month={month}
          deliveries={data.deliveries}
          brands={brands}
          clients={clients}
          verticalsWithCampaign={verticalsWithCampaign}
        />
        <ReconciliationCard
          campaignSpendGr={data.totals.spendGr}
          bookedAdCostsGr={data.bookedAdCostsGr}
        />
      </div>
    </>
  );
}
