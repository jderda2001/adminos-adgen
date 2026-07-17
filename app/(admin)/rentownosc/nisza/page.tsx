import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import {
  getVerticalMonthlyProfit,
  getVerticalProfitability,
} from "@/lib/reports";
import { resolvePeriod, type PeriodSearchParams } from "@/lib/periods";
import { formatMoney, formatPercent } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PeriodFilter } from "@/components/period-filter";
import { KpiCard } from "@/components/kpi-card";
import { ClientMonthlyChart } from "../[clientId]/client-monthly-chart";

export const metadata: Metadata = { title: "Rentowność niszy" };

// Historia rentowności jednej niszy (wertykalu leadowego): wydatki kampanii
// (koszt pozyskania) vs przychód z faktur z tagiem „Leady: <wertykal>".
export default async function VerticalProfitabilityPage({
  searchParams,
}: {
  searchParams: Promise<PeriodSearchParams & { w?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const vertical = params.w?.trim();
  if (!vertical) notFound();

  const period = resolvePeriod(params);
  const [verticals, monthly] = await Promise.all([
    getVerticalProfitability(period),
    getVerticalMonthlyProfit(vertical, 12),
  ]);
  const row = verticals.find((v) => v.vertical === vertical);

  const kpi = {
    revenueGr: row?.revenueGr ?? 0,
    spendGr: row?.spendGr ?? 0,
    profitGr: row?.profitGr ?? 0,
    marginFraction: row?.marginFraction ?? null,
    leadsCount: row?.leadsCount ?? 0,
  };

  return (
    <>
      <div className="mb-4">
        <Link
          href="/rentownosc"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Rentowność
        </Link>
      </div>

      <PageHeader title={vertical} description="Rentowność niszy (wertykal leadowy)">
        <span className="text-sm font-medium text-muted-foreground">
          {period.label}
        </span>
        <PeriodFilter />
      </PageHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Przychód" value={formatMoney(kpi.revenueGr)} />
          <KpiCard
            label="Wydatki (kampanie)"
            value={formatMoney(kpi.spendGr)}
            sub={`${kpi.leadsCount} leadów`}
          />
          <KpiCard
            label="Zysk"
            value={formatMoney(kpi.profitGr)}
            tone={
              kpi.profitGr < 0 ? "negative" : kpi.profitGr > 0 ? "positive" : "default"
            }
          />
          <KpiCard label="Marża" value={formatPercent(kpi.marginFraction)} />
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <h2 className="font-heading text-base font-semibold">
            Rentowność miesięczna
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">Ostatnie 12 miesięcy</p>
          <ClientMonthlyChart data={monthly} />
          <p className="mt-2 text-xs text-muted-foreground">
            Koszty = wydatki kampanii tej niszy (moduł Leady). Przychód = faktury
            z tagiem „Leady: {vertical}" — zależy od konsekwentnego tagowania
            w Przychodach.
          </p>
        </div>
      </div>
    </>
  );
}
