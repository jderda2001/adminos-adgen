// Agregacja danych z Meta do miesięcznych kampanii RW (czysta, testowana).
// Kampanie z wielu kont → sumowane per (marka × wertykal). Niezmapowane/ignored
// nie wchodzą do wyceny — ich spend raportujemy osobno (nic nie ginie).

export interface MetaInsightLike {
  campaignId: string;
  spendGr: number;
  leadsCount: number;
}

export interface CampaignMappingLike {
  metaCampaignId: string;
  brandId: string | null;
  vertical: string | null;
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
 * Grupuje insighty per (brand, vertical) wg mapowań. Kampanie bez mapowania
 * (brak brandId/vertical) lub `ignored` → do puli „niezmapowane".
 */
export function aggregateMetaToCampaignMonths(
  insights: readonly MetaInsightLike[],
  mappings: readonly CampaignMappingLike[]
): MetaAggregateResult {
  const mapById = new Map(mappings.map((m) => [m.metaCampaignId, m]));
  const byKey = new Map<string, AggregatedCampaignMonth>();

  let unmappedSpendGr = 0;
  let unmappedLeads = 0;
  const unmappedCampaignIds: string[] = [];
  let mappedCampaignCount = 0;

  for (const ins of insights) {
    const m = mapById.get(ins.campaignId);
    const mapped = m && !m.ignored && m.brandId && m.vertical;
    if (!mapped) {
      // ignored liczymy jako świadomie pominięte — nie zawyżamy „niezmapowanych"
      if (!m || !m.ignored) {
        unmappedSpendGr += ins.spendGr;
        unmappedLeads += ins.leadsCount;
        unmappedCampaignIds.push(ins.campaignId);
      }
      continue;
    }
    mappedCampaignCount++;
    const key = `${m.brandId}|${m.vertical}`;
    const prev = byKey.get(key);
    if (prev) {
      prev.spendGr += ins.spendGr;
      prev.leadsCount += ins.leadsCount;
    } else {
      byKey.set(key, {
        brandId: m.brandId as string,
        vertical: m.vertical as string,
        spendGr: ins.spendGr,
        leadsCount: ins.leadsCount,
      });
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
