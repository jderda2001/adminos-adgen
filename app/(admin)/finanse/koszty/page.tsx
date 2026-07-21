import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin, isAuthDisabled } from "@/lib/auth";
import {
  generateRecurringCosts,
  getLeadFulfillment,
  getVatForMonth,
} from "@/lib/reports";
import { getAdBudgetCategoryIds } from "@/lib/settings";
import { monthKey } from "@/lib/periods";
import { formatMonth, todayUTC } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { AdBudgetAutoRow } from "./ad-budget-auto-row";
import { buildCostFilters, type CostFilterParams } from "./filters";
import { CostsTable, type CostRow } from "./costs-table";
import { PendingCosts, type PendingCostRow } from "./pending-costs";
import type { RecurringRow } from "./recurring-dialog";

export const metadata: Metadata = { title: "Koszty" };

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireAdmin();

  // leniwe generowanie miesięcznych kopii kosztów cyklicznych
  await generateRecurringCosts();

  const raw = await searchParams;
  const filters: CostFilterParams = {
    okres: first(raw.okres),
    od: first(raw.od),
    do: first(raw.do),
    kategoria: first(raw.kategoria),
    przypisanie: first(raw.przypisanie),
    platnosc: first(raw.platnosc),
  };
  // od 1. dnia następnego miesiąca zaczynają się „zaplanowane" kopie cykliczne
  const today = todayUTC();
  const nextMonthStart = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1)
  );
  // tabela per miesiąc pokazuje też zaplanowane przyszłe kopie (estymacja)
  const { where, period } = buildCostFilters(filters, { plannedFrom: nextMonthStart });

  // miesiąc wybrany w filtrze (dla auto-budżetu i VAT); auto-budżet testowo od 08/2026
  const selectedMonth = monthKey(period.from);
  const AUTO_AD_BUDGET_FROM = "2026-08";
  const showAutoAdBudget = selectedMonth >= AUTO_AD_BUDGET_FROM;
  const [adBudgetCatIds, fulfillment] = await Promise.all([
    getAdBudgetCategoryIds(),
    showAutoAdBudget ? getLeadFulfillment(selectedMonth) : null,
  ]);

  // rozbicie budżetu per MARKA × WERTYKAL (nie klient). Kontrakt (owed) rozkłada
  // się na trzy części paska: dostarczone (fiolet) + pula wygenerowanych-
  // nieprzypisanych pokrywających dług (niebieski) + do wygenerowania (szary).
  // owed = delivered + fromPool + toGenerate. Budżet DO WYDANIA = toGenerate ×
  // CPL — pulę (narastającą, z przeniesieniem) bierze z planu realizacji.
  const stmts = fulfillment?.statuses ?? [];
  const planByV = new Map((fulfillment?.plan.verticals ?? []).map((v) => [v.vertical, v]));
  const brandsByV = fulfillment?.brandsByVertical ?? {};
  const aggByV: Record<string, { owed: number; delivered: number }> = {};
  for (const s of stmts) {
    const owedPos = Math.max(0, s.owed);
    const a = (aggByV[s.vertical] ??= { owed: 0, delivered: 0 });
    a.owed += owedPos;
    a.delivered += Math.min(s.deliveredThisMonth, owedPos); // obcięte do zobowiązania
  }
  const adBudgetBreakdown = Object.entries(aggByV)
    .filter(([, a]) => a.owed > 0)
    .map(([vertical, a]) => {
      const p = planByV.get(vertical);
      const remaining = a.owed - a.delivered; // dług do dowiezienia
      const fromPool = Math.min(p?.pool ?? 0, remaining); // niebieski — pokryte z puli
      const toGenerate = Math.max(0, remaining - fromPool); // szary — do wygenerowania
      const cplGr = p?.cplGr ?? fulfillment!.cplByVertical[vertical] ?? null;
      const budgetGr =
        p?.budgetIncreaseGr ?? (cplGr !== null ? Math.round(toGenerate * cplGr) : 0);
      return {
        vertical,
        brandLabel: (brandsByV[vertical] ?? []).join(" + ") || "—",
        cplGr,
        owed: a.owed,
        delivered: a.delivered, // fiolet
        fromPool, // niebieski
        toGenerate, // szary
        budgetGr,
      };
    })
    .sort((x, y) => y.budgetGr - x.budgetGr || y.owed - x.owed);
  const adBudgetEstimateGr = adBudgetBreakdown.reduce((s, b) => s + b.budgetGr, 0);
  // VAT idzie za WYBRANYM okresem: miesiąc PRZED początkiem okresu (przeglądając
  // sierpień widzisz VAT za lipiec — kwotę odłożoną, płatną do US w tym miesiącu)
  const vatMonth = monthKey(
    new Date(Date.UTC(period.from.getUTCFullYear(), period.from.getUTCMonth() - 1, 1))
  );
  const vatRaw = await getVatForMonth(vatMonth);
  const prevVat = { monthLabel: formatMonth(vatMonth), dueGr: vatRaw.dueGr };

  const [costs, pendingCosts, categories, clients, suppliers, templates] =
    await Promise.all([
      db.cost.findMany({
        where,
        include: {
          category: true,
          client: true,
          comments: { orderBy: { createdAt: "asc" } },
        },
        orderBy: { docDate: "desc" },
      }),
      db.cost.findMany({
        // kolejka „Do potwierdzenia" — tylko bieżący i wcześniejsze miesiące
        // (przyszłe zaplanowane kopie widać w tabeli danego miesiąca, nie tutaj)
        where: { needsConfirmation: true, docDate: { lt: nextMonthStart } },
        include: { category: true },
        orderBy: [{ supplierName: "asc" }, { docDate: "desc" }],
      }),
      db.costCategory.findMany({ orderBy: { position: "asc" } }),
      db.client.findMany({
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      }),
      db.cost.findMany({
        select: { supplierName: true },
        distinct: ["supplierName"],
        orderBy: { supplierName: "asc" },
      }),
      db.recurringCost.findMany({
        include: { category: true, client: true },
        orderBy: { supplierName: "asc" },
      }),
    ]);

  const rows: CostRow[] = costs.map((c) => ({
    id: c.id,
    supplierName: c.supplierName,
    supplierAccount: c.supplierAccount,
    docNumber: c.docNumber,
    docDate: c.docDate.toISOString(),
    dueDate: c.dueDate?.toISOString() ?? null,
    netGr: c.netGr,
    vatRate: c.vatRate,
    vatGr: c.vatGr,
    grossGr: c.grossGr,
    categoryId: c.categoryId,
    categoryName: c.category.name,
    clientId: c.clientId,
    clientName: c.client?.name ?? null,
    paid: c.paid,
    approvedForPayment: c.approvedForPayment,
    delayed: c.delayed,
    paidDate: c.paidDate?.toISOString() ?? null,
    comments: c.comments.map((cm) => ({
      id: cm.id,
      authorId: cm.authorId,
      authorName: cm.authorName,
      body: cm.body,
      createdAt: cm.createdAt.toISOString(),
    })),
    attachmentName: c.attachmentPath ? (c.attachmentName ?? c.attachmentPath) : null,
    recurringCostId: c.recurringCostId,
    planned: c.needsConfirmation, // zaplanowana przyszła kopia cykliczna
  }));

  // wiersz-widmo „Budżet reklamowy" (auto) — jeden wyjątkowy wiersz rejestru
  // spięty z górnym badge'em, fioletowy, tylko-do-odczytu. Kwota = koszt leadów,
  // które trzeba jeszcze WYGENEROWAĆ (Σ toAcquire × CPL). Maleje sam w miarę jak
  // Meta generuje leady (wpadają do puli → toAcquire spada) — NIE odejmujemy
  // osobno zasileń, bo zasilenia stają się właśnie tymi wygenerowanymi leadami
  // (odjęcie obu liczyłoby ten sam wydatek dwa razy). Realne zasilenia zostają
  // w rejestrze jako zwykłe koszty (nie chowamy ich).
  const adBudgetCat = categories.find((c) => adBudgetCatIds.has(c.id));
  if (showAutoAdBudget && adBudgetEstimateGr > 0) {
    const monthEndIso = new Date(
      Date.UTC(period.from.getUTCFullYear(), period.from.getUTCMonth() + 1, 0)
    ).toISOString();
    rows.unshift({
      id: "auto-ad-budget",
      supplierName: "Budżet reklamowy — auto",
      supplierAccount: null,
      docNumber: "",
      docDate: monthEndIso,
      dueDate: null,
      netGr: adBudgetEstimateGr,
      vatRate: "ZW",
      vatGr: 0,
      grossGr: adBudgetEstimateGr, // budżet Meta = odwrotne obciążenie (netto = brutto)
      categoryId: adBudgetCat?.id ?? "",
      categoryName: adBudgetCat?.name ?? "Budżet reklamowy",
      clientId: null,
      clientName: null,
      paid: false,
      approvedForPayment: false,
      delayed: false,
      paidDate: null,
      comments: [],
      attachmentName: null,
      recurringCostId: null,
      planned: false,
      autoAdBudget: true,
    });
  }

  const pendingRows: PendingCostRow[] = pendingCosts.map((c) => ({
    id: c.id,
    supplierName: c.supplierName,
    docNumber: c.docNumber,
    grossGr: c.grossGr,
    categoryName: c.category.name,
  }));

  const templateRows: RecurringRow[] = templates.map((t) => ({
    id: t.id,
    active: t.active,
    supplierName: t.supplierName,
    docNumber: t.docNumber,
    netGr: t.netGr,
    vatRate: t.vatRate,
    categoryName: t.category.name,
    clientName: t.client?.name ?? null,
    dueDayOfMonth: t.dueDayOfMonth,
    endPeriod: t.endPeriod,
  }));

  const categoryOptions = categories.map((c) => ({ id: c.id, name: c.name }));
  const supplierNames = suppliers.map((s) => s.supplierName);

  return (
    <>
      <PageHeader
        title="Koszty"
        description="Rejestr kosztów adGen — wydatki, koszty cykliczne, pozycje do potwierdzenia."
      />
      <div className="space-y-4">
        {showAutoAdBudget && (
          <AdBudgetAutoRow
            monthLabel={formatMonth(selectedMonth)}
            estimateGr={adBudgetEstimateGr}
          />
        )}
        {pendingRows.length > 0 && <PendingCosts items={pendingRows} />}
        <CostsTable
          costs={rows}
          categories={categoryOptions}
          clients={clients}
          supplierNames={supplierNames}
          templates={templateRows}
          prevVat={prevVat}
          currentUserId={me.id}
          authDisabled={isAuthDisabled()}
          adBudget={
            showAutoAdBudget && adBudgetEstimateGr > 0
              ? {
                  monthLabel: formatMonth(selectedMonth),
                  estimateGr: adBudgetEstimateGr,
                  breakdown: adBudgetBreakdown,
                }
              : null
          }
        />
      </div>
    </>
  );
}
