// Rdzeń synchronizacji Meta → LeadCampaignMonth (bez warstwy auth/ActionResult).
// Używany przez akcję serwerową (requireAdmin) ORAZ route cron (sekret nagłówka).
// Zaciąga kampanie z portfolio, aktualizuje mapę kampanii i wpisuje zagregowane
// spendy/leady (source=META), NIE nadpisując wpisów ręcznych (source=MANUAL).
// Zawsze loguje MetaSyncRun (ok=true / ok=false + błąd).

import { db } from "./db";
import { fetchAdAccounts, fetchCampaignInsights, isMetaMock } from "./meta-ads";
import { aggregateMetaToCampaignMonths } from "./meta-sync";

export interface MetaSyncSummary {
  campaignsPulled: number;
  mappedCount: number;
  monthsUpserted: number;
  unmappedCampaigns: number;
  unmappedSpendGr: number;
  mock: boolean;
}

/**
 * Wykonuje pełną synchronizację za dany miesiąc. Rzuca wyjątkiem przy błędzie
 * (po zalogowaniu nieudanego MetaSyncRun) — wołający decyduje o obsłudze.
 */
export async function runMetaSync(month: string): Promise<MetaSyncSummary> {
  try {
    // aktualizuj mapę KONT reklamowych (nowe = do decyzji: marka czy pomiń)
    const adAccounts = await fetchAdAccounts();
    for (const a of adAccounts) {
      await db.metaAdAccountMap.upsert({
        where: { adAccountId: a.id },
        update: { adAccountName: a.name, lastSeenAt: new Date() },
        create: { adAccountId: a.id, adAccountName: a.name },
      });
    }

    const insights = await fetchCampaignInsights(month);

    // aktualizuj mapę kampanii (nowe = niezmapowane, widoczne w dialogu)
    for (const c of insights) {
      await db.metaCampaignMap.upsert({
        where: { metaCampaignId: c.campaignId },
        update: {
          metaCampaignName: c.campaignName,
          adAccountId: c.adAccountId,
          adAccountName: c.adAccountName,
          lastSeenAt: new Date(),
        },
        create: {
          metaCampaignId: c.campaignId,
          metaCampaignName: c.campaignName,
          adAccountId: c.adAccountId,
          adAccountName: c.adAccountName,
        },
      });
    }

    const [maps, accountMaps] = await Promise.all([
      db.metaCampaignMap.findMany({
        where: { metaCampaignId: { in: insights.map((c) => c.campaignId) } },
        select: { metaCampaignId: true, brandId: true, vertical: true, ignored: true },
      }),
      db.metaAdAccountMap.findMany({
        select: { adAccountId: true, brandId: true, ignored: true },
      }),
    ]);
    const agg = aggregateMetaToCampaignMonths(insights, maps, accountMaps);

    // upsert zagregowanych spendów do LeadCampaignMonth (bez nadpisywania MANUAL)
    let monthsUpserted = 0;
    for (const row of agg.rows) {
      const existing = await db.leadCampaignMonth.findUnique({
        where: {
          period_brandId_vertical: { period: month, brandId: row.brandId, vertical: row.vertical },
        },
        select: { id: true, source: true },
      });
      if (existing?.source === "MANUAL") continue; // ręczna korekta wygrywa
      if (existing) {
        await db.leadCampaignMonth.update({
          where: { id: existing.id },
          data: { spendGr: row.spendGr, leadsCount: row.leadsCount, source: "META" },
        });
      } else {
        await db.leadCampaignMonth.create({
          data: {
            period: month,
            brandId: row.brandId,
            vertical: row.vertical,
            spendGr: row.spendGr,
            leadsCount: row.leadsCount,
            source: "META",
          },
        });
      }
      monthsUpserted++;
    }

    await db.metaSyncRun.create({
      data: {
        month,
        ok: true,
        campaignsPulled: insights.length,
        mappedCount: agg.mappedCampaignCount,
        unmappedSpendGr: agg.unmappedSpendGr,
      },
    });

    return {
      campaignsPulled: insights.length,
      mappedCount: agg.mappedCampaignCount,
      monthsUpserted,
      unmappedCampaigns: agg.unmappedCampaignIds.length,
      unmappedSpendGr: agg.unmappedSpendGr,
      mock: await isMetaMock(),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Nieznany błąd";
    await db.metaSyncRun
      .create({ data: { month, ok: false, error: msg.slice(0, 400) } })
      .catch(() => null);
    throw e;
  }
}
