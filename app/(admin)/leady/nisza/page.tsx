import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  ensureCarriedLeadDeliveries,
  getActiveVerticalNames,
  getLeadFulfillment,
} from "@/lib/reports";
import { DEFAULT_VERTICALS } from "@/lib/types";
import { monthKey } from "@/lib/periods";
import { todayUTC, formatMoney, pluralPl } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { ProgressBar } from "@/components/progress-bar";
import { EmptyState } from "@/components/empty-state";
import { MonthNav } from "../month-nav";
import { DeliveryDialog, type ClientOption } from "../delivery-dialog";
import { ClientList, type NicheClientRow } from "./client-list";
import type { BrandOption } from "../campaign-dialog";

export const metadata: Metadata = { title: "Nisza — Leady" };

// Osobna strona niszy (?w=<wertykal>): pula leadów (wygenerowane → przypisane
// → nieprzypisane), postęp dowiezienia kontraktów i karty klientów z edycją
// „dowiezione". Widok główny Leadów pokazuje tylko podsumowania.
export default async function LeadNichePage({
  searchParams,
}: {
  searchParams: Promise<{ w?: string | string[]; od?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  // powtórzony parametr (?w=A&w=B) przychodzi jako tablica — bierzemy pierwszy
  const rawW = Array.isArray(params.w) ? params.w[0] : params.w;
  const vertical = rawW?.trim();
  if (!vertical) notFound();

  const requested = params.od;
  const month =
    requested && /^\d{4}-(0[1-9]|1[0-2])$/.test(requested)
      ? requested
      : monthKey(todayUTC());

  // spójnie z widokiem głównym: auto-przeniesienie dostaw działa też przy
  // wejściu prosto na stronę niszy (zakładka, odświeżenie na przełomie miesiąca)
  if (month === monthKey(todayUTC())) {
    await ensureCarriedLeadDeliveries(month);
  }

  const [fulfillment, brandRows, clientRows, activeVerticals, verticalRow, nicheDeliveries] =
    await Promise.all([
      getLeadFulfillment(month),
      db.brand.findMany({ orderBy: { position: "asc" }, select: { id: true, name: true, active: true } }),
      db.client.findMany({
        where: { status: "ACTIVE" },
        orderBy: { name: "asc" },
        select: { id: true, name: true, billingModel: true },
      }),
      getActiveVerticalNames(),
      db.leadVertical.findUnique({ where: { name: vertical } }),
      db.leadDelivery.findMany({
        where: { period: month, vertical },
        select: { clientId: true, estimated: true },
      }),
    ]);

  // nieznany wertykal (literówka w URL, stary link po zmianie nazwy) → 404,
  // ale nazwy obecne w danych miesiąca (faktury/kampanie historyczne) przechodzą
  const knownInData =
    vertical in fulfillment.generatedByVertical ||
    fulfillment.statuses.some((s) => s.vertical === vertical);
  if (!knownInData && !verticalRow && !DEFAULT_VERTICALS.includes(vertical)) {
    notFound();
  }

  const cpl = fulfillment.cplByVertical[vertical] ?? null;
  // klienci z choć jedną dostawą „estymacja" (auto-przeniesioną) — do potwierdzenia
  const estimatedClients = new Set(
    nicheDeliveries.filter((d) => d.estimated).map((d) => d.clientId)
  );
  const rows: NicheClientRow[] = fulfillment.statuses
    .filter((s) => s.vertical === vertical)
    .map((s) => ({
      clientId: s.clientId,
      clientName: s.clientName,
      vertical: s.vertical,
      owed: s.owed,
      delivered: s.deliveredThisMonth,
      balance: s.balance,
      costGr: cpl !== null ? Math.round(s.deliveredThisMonth * cpl) : 0,
      estimated: estimatedClients.has(s.clientId),
    }))
    .sort((a, b) => b.balance - a.balance || a.clientName.localeCompare(b.clientName, "pl"));

  const generated = fulfillment.generatedByVertical[vertical] ?? 0;
  const assigned = rows.reduce((n, r) => n + r.delivered, 0);
  const plan = fulfillment.plan.verticals.find((v) => v.vertical === vertical);
  // „leżą" = pula NARASTAJĄCA (nieprzypisane z poprzednich miesięcy przechodzą),
  // nie tylko generated−assigned tego miesiąca
  const unassigned = plan?.pool ?? Math.max(0, generated - assigned);
  // pasek dowiezienia bez nettowania nadwyżek między klientami:
  // covered = Σ min(dowiezione, zobowiązanie), owed = Σ dodatnich zobowiązań
  const owed = rows.reduce((n, r) => n + Math.max(0, r.owed), 0);
  const covered = rows.reduce((n, r) => n + Math.min(r.delivered, Math.max(0, r.owed)), 0);
  const remaining = plan?.remaining ?? 0; // dług wobec klientów (do dowiezienia)
  const toGenerate = plan?.toGenerate ?? 0; // do WYGENEROWANIA (po odjęciu puli)
  const addSpendGr = plan?.budgetIncreaseGr ?? 0;

  const brands: BrandOption[] = brandRows;
  const clients: ClientOption[] = clientRows.map((c) => ({
    id: c.id,
    name: c.name,
    isLeadClient: c.billingModel === "PAKIETY_LEADOW",
  }));
  // wertykale z kampanią (leady>0) w tym miesiącu — ostrzeżenie o wycenie w dialogu
  const verticalsWithCampaign = Object.entries(fulfillment.generatedByVertical)
    .filter(([, n]) => n > 0)
    .map(([v]) => v);

  return (
    <>
      <div className="mb-4">
        <Link
          href={`/leady?od=${month}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Leady
        </Link>
      </div>

      <PageHeader
        title={vertical}
        description={cpl !== null ? `CPL ${formatMoney(cpl)} (ostatni okres)` : "Brak danych o CPL"}
      >
        <MonthNav month={month} />
        <DeliveryDialog
          month={month}
          brands={brands}
          clients={clients}
          verticals={activeVerticals}
          verticalsWithCampaign={verticalsWithCampaign}
          defaultVertical={vertical}
          trigger={
            <Button size="sm">
              <Plus data-icon="inline-start" /> Dodaj dostawę
            </Button>
          }
        />
      </PageHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Wygenerowane (Meta)" value={generated} />
          <KpiCard label="Przypisane klientom" value={assigned} />
          <KpiCard
            label="Nieprzypisane — leżą"
            value={unassigned}
            tone={unassigned > 0 ? "warning" : "default"}
            sub={unassigned < 0 ? "przypisano więcej niż wygenerowano (zapas)" : undefined}
          />
          <KpiCard
            label="Do wygenerowania"
            value={toGenerate}
            tone={toGenerate > 0 ? "negative" : "positive"}
            sub={
              toGenerate > 0
                ? `dołóż ≈${formatMoney(addSpendGr)} w Mecie`
                : remaining > 0
                  ? "pokryte z puli — dołóż 0 zł"
                  : owed > 0
                    ? "wszystko dowiezione"
                    : undefined
            }
          />
        </div>

        {owed > 0 && (
          <div className="rounded-2xl border bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-semibold">Dowiezienie kontraktów</span>
              <span className="tabular-nums">
                <span className="text-xl font-semibold">{covered}</span>
                <span className="text-muted-foreground"> / {owed}</span>
              </span>
            </div>
            <ProgressBar value={covered} max={owed} className="mt-2.5 h-2" />
          </div>
        )}

        <div>
          <h2 className="mb-2 text-sm font-semibold">
            Klienci{" "}
            <span className="font-normal text-muted-foreground">
              {rows.length} {pluralPl(rows.length, "klient", "klienci", "klientów")}
            </span>
          </h2>
          {rows.length === 0 ? (
            <EmptyState
              title="Brak klientów w tej niszy"
              description={
                generated > 0
                  ? `Wszystkie ${generated} wygenerowanych leadów leży nieprzypisanych. Dodaj dostawę albo fakturę „PAKIETY LEADÓW” w Przychodach.`
                  : 'Dodaj fakturę „PAKIETY LEADÓW” w Przychodach — kontrakt pojawi się tu automatycznie.'
              }
            />
          ) : (
            <ClientList month={month} rows={rows} />
          )}
        </div>
      </div>
    </>
  );
}
