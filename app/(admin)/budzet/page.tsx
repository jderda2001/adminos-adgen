import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { getBudgetVsActual } from "@/lib/reports";
import { todayUTC } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { Button } from "@/components/ui/button";
import { formatMoney, formatPercent } from "@/lib/format";
import { BudgetTable } from "./budget-table";

export const metadata: Metadata = { title: "Budżet" };

// Budżet: plan vs wykonanie per miesiąc. Plan wpisywany ręcznie (edycja per
// miesiąc), wykonanie liczone z faktur/kosztów/dostaw leadów.
export default async function BudgetPage({
  searchParams,
}: {
  searchParams: Promise<{ rok?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const currentYear = todayUTC().getUTCFullYear();
  const parsed = Number(params.rok);
  const year =
    Number.isInteger(parsed) && parsed >= 2020 && parsed <= 2100 ? parsed : currentYear;

  const rows = await getBudgetVsActual(year);

  const totRevPlan = rows.reduce((a, r) => a + r.revenuePlanGr, 0);
  const totRevAct = rows.reduce((a, r) => a + r.revenueActualGr, 0);
  const totCostPlan = rows.reduce((a, r) => a + r.costPlanGr, 0);
  const totCostAct = rows.reduce((a, r) => a + r.costActualGr, 0);
  const marginPlan = totRevPlan - totCostPlan;
  const marginActual = totRevAct - totCostAct;
  const revRealization = totRevPlan > 0 ? totRevAct / totRevPlan : null;

  return (
    <>
      <PageHeader
        title="Budżet"
        description="Plan miesięczny vs wykonanie — przychód, koszty, marża i leady"
      >
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon-sm" aria-label="Poprzedni rok" asChild>
            <Link href={`/budzet?rok=${year - 1}`} scroll={false}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <span className="w-14 text-center text-sm font-medium tabular-nums">{year}</span>
          <Button variant="outline" size="icon-sm" aria-label="Następny rok" asChild>
            <Link href={`/budzet?rok=${year + 1}`} scroll={false}>
              <ChevronRight className="size-4" />
            </Link>
          </Button>
        </div>
      </PageHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard
            label="Przychód: plan / wyk."
            value={formatMoney(totRevAct)}
            sub={`plan ${formatMoney(totRevPlan)}${revRealization !== null ? ` · ${formatPercent(revRealization)} realizacji` : ""}`}
          />
          <KpiCard
            label="Koszt: plan / wyk."
            value={formatMoney(totCostAct)}
            sub={`plan ${formatMoney(totCostPlan)}`}
            tone={totCostPlan > 0 && totCostAct > totCostPlan ? "warning" : "default"}
          />
          <KpiCard
            label="Marża: wyk."
            value={formatMoney(marginActual)}
            sub={`plan ${formatMoney(marginPlan)}`}
            tone={marginActual < 0 ? "negative" : marginActual >= marginPlan ? "positive" : "default"}
          />
          <KpiCard
            label="Odchylenie marży"
            value={formatMoney(marginActual - marginPlan)}
            sub="wykonanie − plan"
            tone={marginActual - marginPlan < 0 ? "negative" : "positive"}
          />
        </div>

        <BudgetTable rows={rows} />

        <p className="text-xs leading-relaxed text-muted-foreground">
          Wykonanie: przychód = faktury (bez szkiców, po dacie sprzedaży), koszt =
          moduł Koszty (bez odłożonych, po dacie wystawienia), leady = dostawy
          z modułu Leady. Kliknij ołówek, aby ustawić plan miesiąca.
        </p>
      </div>
    </>
  );
}
