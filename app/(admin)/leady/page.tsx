import type { Metadata } from "next";
import { ChevronDown, Plus, Settings2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  getLeadMonthData,
  getActiveVerticalNames,
  getVerticalsForManagement,
  ensureCarriedLeadDeliveries,
  getMetaStatus,
  getMetaMappingData,
  getBrandEconomics,
  getAdBudgetStatus,
  getLeadFulfillment,
} from "@/lib/reports";
import { monthKey } from "@/lib/periods";
import { todayUTC, formatMoney, pluralPl } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { MonthNav } from "./month-nav";
import { CampaignsCard } from "./campaigns-card";
import { ReconciliationCard } from "./reconciliation-card";
import { MetaSyncCard } from "./meta-sync-card";
import { BrandCards } from "./brand-cards";
import { MonthSummary } from "./month-summary";
import { VerticalCards, type VerticalCardData } from "./vertical-cards";
import { BrandsDialog, type BrandRow } from "./brands-dialog";
import { VerticalsDialog } from "./verticals-dialog";
import { DeliveryDialog, type ClientOption } from "./delivery-dialog";
import type { BrandOption } from "./campaign-dialog";

export const metadata: Metadata = { title: "Leady" };

// Widok główny celowo lekki: 3 karty podsumowania (pula z Mety, dowiezienie,
// budżet) + karty nisz z paskami postępu. Klienci i edycja dostaw są na
// osobnej stronie niszy (/leady/nisza). Marki i uzgodnienie — zwinięte.
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

  // auto-przeniesienie dostaw z poprzedniego miesiąca — tylko dla BIEŻĄCEGO
  // miesiąca (nie backfillujemy historii przy przeglądaniu wstecz)
  if (month === monthKey(todayUTC())) {
    await ensureCarriedLeadDeliveries(month);
  }

  const [
    data,
    brandRows,
    clientRows,
    activeVerticals,
    verticalRowsForDialog,
    metaStatus,
    mapping,
    brandEcon,
    adBudget,
    fulfillment,
  ] = await Promise.all([
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
    getActiveVerticalNames(),
    getVerticalsForManagement(),
    getMetaStatus(),
    getMetaMappingData(),
    getBrandEconomics(month),
    getAdBudgetStatus(month),
    getLeadFulfillment(month),
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

  // karty nisz: pula (wygenerowane→przypisane→leżące) + dowiezienie kontraktów
  // + estymacja „dołóż" (z planu realizacji). Pasek dowiezienia liczymy na
  // wartościach obciętych per klient (covered = min(dowiezione, zobowiązanie)),
  // żeby nadwyżka jednego klienta nie maskowała długu innego.
  const byVertical = new Map<
    string,
    { owedPos: number; covered: number; assigned: number; remaining: number; clientCount: number }
  >();
  for (const s of fulfillment.statuses) {
    const v = byVertical.get(s.vertical) ?? {
      owedPos: 0,
      covered: 0,
      assigned: 0,
      remaining: 0,
      clientCount: 0,
    };
    const owedPos = Math.max(0, s.owed);
    v.owedPos += owedPos;
    v.covered += Math.min(s.deliveredThisMonth, owedPos);
    v.assigned += s.deliveredThisMonth;
    v.remaining += Math.max(0, s.balance);
    v.clientCount += 1;
    byVertical.set(s.vertical, v);
  }
  const cardVerticals = new Set<string>([
    ...byVertical.keys(),
    ...Object.keys(fulfillment.generatedByVertical),
  ]);
  const planByVertical = new Map(fulfillment.plan.verticals.map((v) => [v.vertical, v]));
  const cards: VerticalCardData[] = [...cardVerticals]
    .map((vertical) => {
      const agg = byVertical.get(vertical) ?? {
        owedPos: 0,
        covered: 0,
        assigned: 0,
        remaining: 0,
        clientCount: 0,
      };
      const generated = fulfillment.generatedByVertical[vertical] ?? 0;
      return {
        vertical,
        cplGr: fulfillment.cplByVertical[vertical] ?? null,
        generated,
        assigned: agg.assigned,
        unassigned: generated - agg.assigned,
        owed: agg.owedPos,
        delivered: agg.covered,
        remaining: agg.remaining,
        addSpendGr: planByVertical.get(vertical)?.budgetIncreaseGr ?? 0,
        clientCount: agg.clientCount,
      };
    })
    .sort(
      (a, b) =>
        b.remaining - a.remaining ||
        b.generated - a.generated ||
        a.vertical.localeCompare(b.vertical, "pl")
    );

  // sumy do podsumowania — „leży" liczone per nisza (bez nettowania między
  // niszami: dostawa w niszy bez kampanii nie maskuje leżących leadów innej)
  const totalGenerated = cards.reduce((s, c) => s + c.generated, 0);
  const totalPoolAssigned = cards.reduce((s, c) => s + Math.min(c.assigned, c.generated), 0);
  const totalUnassigned = cards.reduce((s, c) => s + Math.max(0, c.unassigned), 0);
  const totalOwed = cards.reduce((s, c) => s + c.owed, 0);
  const totalCovered = cards.reduce((s, c) => s + c.delivered, 0);

  // wertykale z użyteczną kampanią (leady>0) — dla dialogu dostawy (wycena CPL)
  const verticalsWithCampaign = [
    ...new Set(data.campaigns.filter((c) => c.leadsCount > 0).map((c) => c.vertical)),
  ];
  // dostawy, które nie mają z czego policzyć CPL (koszt 0) — do zbiorczego alertu
  const unpricedDeliveries = data.deliveries.filter((d) => d.source === "BRAK_KAMPANII");
  // dostawy auto-przeniesione z poprzedniego miesiąca (do potwierdzenia/korekty)
  const estimatedCount = data.deliveries.filter((d) => d.estimated).length;

  return (
    <>
      <PageHeader title="Leady" description="Generowanie i dowiezienie leadów">
        <MonthNav month={month} />
        <VerticalsDialog
          verticals={verticalRowsForDialog}
          trigger={
            <Button variant="outline" size="sm">
              <Settings2 data-icon="inline-start" /> Wertykały
            </Button>
          }
        />
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
        <MetaSyncCard
          month={month}
          status={metaStatus}
          accounts={mapping.accounts}
          campaigns={mapping.campaigns}
          brands={brands}
          verticals={activeVerticals}
        />

        {estimatedCount > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {estimatedCount}{" "}
            {pluralPl(
              estimatedCount,
              "dostawa została przeniesiona automatycznie",
              "dostawy zostały przeniesione automatycznie",
              "dostaw zostało przeniesionych automatycznie"
            )}{" "}
            z poprzedniego miesiąca — potwierdź liczby na stronach nisz (znacznik „estymacja").
          </div>
        )}

        {unpricedDeliveries.length > 0 && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            {unpricedDeliveries.length}{" "}
            {pluralPl(
              unpricedDeliveries.length,
              "dostawa nie ma kampanii do wyceny",
              "dostawy nie mają kampanii do wyceny",
              "dostaw nie ma kampanii do wyceny"
            )}{" "}
            (koszt 0 zł) — wertykale:{" "}
            <span className="font-medium">
              {[...new Set(unpricedDeliveries.map((d) => d.vertical))].join(", ")}
            </span>
            .
          </div>
        )}

        <MonthSummary
          generated={totalGenerated}
          poolAssigned={totalPoolAssigned}
          unassigned={totalUnassigned}
          covered={totalCovered}
          owed={totalOwed}
          plan={fulfillment.plan}
          budget={adBudget}
        />

        <div className="flex items-center justify-between gap-2 pt-1">
          <h2 className="text-sm font-semibold">Nisze</h2>
          <DeliveryDialog
            month={month}
            brands={brands}
            clients={clients}
            verticals={activeVerticals}
            verticalsWithCampaign={verticalsWithCampaign}
            trigger={
              <Button variant="outline" size="sm">
                <Plus data-icon="inline-start" /> Dodaj dostawę
              </Button>
            }
          />
        </div>
        <VerticalCards month={month} cards={cards} />

        <details className="group rounded-xl border bg-card shadow-[var(--shadow-card)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span>
              Marki wewnętrzne
              <span className="ml-2 font-normal">przychód, marża i CPL per marka</span>
            </span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t p-4">
            <BrandCards rows={brandEcon.rows} />
          </div>
        </details>

        <details className="group rounded-xl border bg-card shadow-[var(--shadow-card)]">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
            <span>
              Szczegóły i uzgodnienie
              <span className="ml-2 font-normal">
                kampanie per wertykal · uzgodnienie z Kosztami
                {unassignedGr !== 0 && (
                  <> · nieprzypisany spend {formatMoney(unassignedGr)}</>
                )}
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t px-4 pb-4 pt-4">
            <CampaignsCard
              month={month}
              campaigns={data.campaigns}
              brands={brands}
              verticals={activeVerticals}
            />
            <ReconciliationCard
              campaignSpendGr={data.totals.spendGr}
              bookedAdCostsGr={data.bookedAdCostsGr}
            />
          </div>
        </details>
      </div>
    </>
  );
}
