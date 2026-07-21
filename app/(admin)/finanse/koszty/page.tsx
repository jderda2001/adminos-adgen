import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireAdmin, isAuthDisabled } from "@/lib/auth";
import {
  generateRecurringCosts,
  getAdBudgetStatus,
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
  const [adBudget, adBudgetCatIds] = await Promise.all([
    getAdBudgetStatus(selectedMonth),
    getAdBudgetCategoryIds(),
  ]);
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

  // od sierpnia „Budżet reklamowy" reprezentuje JEDEN auto-wiersz (szacunek −
  // zasilenia) — pojedyncze wpisy tej kategorii chowamy z listy, a ich sumę
  // (zasilenia) netujemy w auto-wierszu. Zasilenia = realne wpisy (bez planowanych).
  const isAdBudgetCost = (categoryId: string) => adBudgetCatIds.has(categoryId);
  const adBudgetFundedGr = showAutoAdBudget
    ? costs
        .filter((c) => !c.needsConfirmation && isAdBudgetCost(c.categoryId))
        .reduce((s, c) => s + c.netGr, 0)
    : 0;
  const visibleCosts = showAutoAdBudget
    ? costs.filter((c) => !isAdBudgetCost(c.categoryId))
    : costs;

  const rows: CostRow[] = visibleCosts.map((c) => ({
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
  // spięty z górnym badge'em: kwota = szacunek − zasilenia (do zapłaty), fioletowy,
  // tylko-do-odczytu; liczy się do sum i „Do zapłaty". Zasilenia (wpisy kategorii)
  // są schowane z listy i netowane tutaj.
  const adBudgetRemainingGr = Math.max(0, adBudget.planGr - adBudgetFundedGr);
  const adBudgetCat = categories.find((c) => adBudgetCatIds.has(c.id));
  if (showAutoAdBudget && adBudget.planGr > 0) {
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
      netGr: adBudgetRemainingGr,
      vatRate: "ZW",
      vatGr: 0,
      grossGr: adBudgetRemainingGr, // budżet Meta = odwrotne obciążenie (netto = brutto)
      categoryId: adBudgetCat?.id ?? "",
      categoryName: adBudgetCat?.name ?? "Budżet reklamowy",
      clientId: null,
      clientName: null,
      paid: adBudgetRemainingGr === 0,
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
            estimateGr={adBudget.planGr}
            fundedGr={adBudgetFundedGr}
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
        />
      </div>
    </>
  );
}
