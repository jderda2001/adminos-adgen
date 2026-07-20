// Agregacja danych z Meta do miesięcznych kampanii RW (czysta, testowana).
// Marka wynika z KONTA reklamowego (MetaAdAccountMap); kampania dostaje tylko
// wertykal (opcjonalny override marki per kampania zostaje dla korekt).
// Konto „ignored" = konto klienta abonamentowego — pomijane w całości, nie
// liczy się do „niezmapowanych". Kampanie z kont z marką, ale bez wertykalu →
// pula „niezmapowane" (spend raportowany osobno, nic nie ginie).

export interface MetaInsightLike {
  campaignId: string;
  adAccountId?: string;
  spendGr: number;
  leadsCount: number;
}

export interface CampaignMappingLike {
  metaCampaignId: string;
  brandId: string | null;
  vertical: string | null;
  ignored: boolean;
}

export interface AccountMappingLike {
  adAccountId: string;
  brandId: string | null;
  ignored: boolean;
}

export interface AggregatedCampaignMonth {
  brandId: string;
  vertical: string;
  spendGr: number;
  leadsCount: number;
}

export interface MetaAggregateResult {
  rows: AggregatedCampaignMonth[];
  mappedCampaignCount: number;
  unmappedSpendGr: number;
  unmappedLeads: number;
  unmappedCampaignIds: string[];
}

/**
 * Grupuje insighty per (brand, vertical). Marka: override kampanii → marka
 * konta. Pomijane bez liczenia jako „niezmapowane": kampanie `ignored` oraz
 * całe konta `ignored` (klienckie). Reszta bez marki lub wertykalu → pula
 * „niezmapowane".
 */
export function aggregateMetaToCampaignMonths(
  insights: readonly MetaInsightLike[],
  mappings: readonly CampaignMappingLike[],
  accountMappings: readonly AccountMappingLike[] = []
): MetaAggregateResult {
  const mapById = new Map(mappings.map((m) => [m.metaCampaignId, m]));
  const accById = new Map(accountMappings.map((a) => [a.adAccountId, a]));
  const byKey = new Map<string, AggregatedCampaignMonth>();

  let unmappedSpendGr = 0;
  let unmappedLeads = 0;
  const unmappedCampaignIds: string[] = [];
  let mappedCampaignCount = 0;

  for (const ins of insights) {
    const m = mapById.get(ins.campaignId);
    const acc = ins.adAccountId ? accById.get(ins.adAccountId) : undefined;

    // świadomie pominięte: kampania ignored albo całe konto klienckie
    if (m?.ignored || acc?.ignored) continue;

    const brandId = m?.brandId ?? (acc && !acc.ignored ? acc.brandId : null);
    const vertical = m?.vertical ?? null;

    if (!brandId || !vertical) {
      unmappedSpendGr += ins.spendGr;
      unmappedLeads += ins.leadsCount;
      unmappedCampaignIds.push(ins.campaignId);
      continue;
    }

    mappedCampaignCount++;
    const key = `${brandId}|${vertical}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.spendGr += ins.spendGr;
      prev.leadsCount += ins.leadsCount;
    } else {
      byKey.set(key, { brandId, vertical, spendGr: ins.spendGr, leadsCount: ins.leadsCount });
    }
  }

  return {
    rows: [...byKey.values()],
    mappedCampaignCount,
    unmappedSpendGr,
    unmappedLeads,
    unmappedCampaignIds,
  };
}
