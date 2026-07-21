import type { Metadata } from "next";
import { headers } from "next/headers";
import { Bell, Building2, SlidersHorizontal, Tags } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { ReminderSettingsCard } from "./reminders-card";

export const metadata: Metadata = { title: "Ustawienia" };

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "finanse", label: "Finanse i cele", icon: SlidersHorizontal },
  { id: "firma", label: "Firma", icon: Building2 },
  { id: "automatyzacja", label: "Automatyzacja", icon: Bell },
  { id: "kategorie", label: "Kategorie kosztów", icon: Tags },
];

function SettingsGroup({
  id,
  label,
  icon: Icon,
  children,
}: {
  id: string;
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-4">
      <div className="flex items-center gap-2.5 border-b pb-2">
        <Icon className="size-5 text-muted-foreground" />
        <h2 className="font-heading text-lg font-semibold">{label}</h2>
      </div>
      {children}
    </section>
  );
}

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
        description="Konfiguracja rentowności, cele podziału przychodu, dane firmy, automatyzacje (przypomnienia, Meta) i słownik kategorii kosztów."
      />
      <div className="lg:grid lg:grid-cols-[210px_minmax(0,1fr)] lg:items-start lg:gap-8">
        <nav className="sticky top-6 mb-6 hidden lg:block">
          <ul className="space-y-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <s.icon className="size-4" />
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="max-w-2xl space-y-10">
          <SettingsGroup id="finanse" label="Finanse i cele" icon={SlidersHorizontal}>
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
          </SettingsGroup>

          <SettingsGroup id="firma" label="Firma" icon={Building2}>
            <CompanyCard
              name={settings.company_name}
              address={settings.company_address}
              account={settings.company_account}
            />
          </SettingsGroup>

          <SettingsGroup id="automatyzacja" label="Automatyzacja" icon={Bell}>
            <ReminderSettingsCard
              enabled={settings.payment_reminders_enabled === "1"}
              notifyMode={settings.notify_mode}
              smtpHost={settings.smtp_host}
              smtpPort={settings.smtp_port}
              smtpUser={settings.smtp_user}
              smtpFrom={settings.smtp_from}
              smtpPassSet={Boolean(settings.smtp_pass)}
              smsApiUrl={settings.sms_api_url}
              smsSender={settings.sms_sender}
              smsApiKeySet={Boolean(settings.sms_api_key)}
              emailFooter={settings.reminder_email_footer}
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
          </SettingsGroup>

          <SettingsGroup id="kategorie" label="Kategorie kosztów" icon={Tags}>
            <CategoriesCard categories={categoryRows} />
          </SettingsGroup>
        </div>
      </div>
    </>
  );
}
