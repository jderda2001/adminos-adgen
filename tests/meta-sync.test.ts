// Testy agregacji Meta → kampanie RW (lib/meta-sync.ts).

import { describe, expect, it } from "vitest";
import {
  aggregateMetaToCampaignMonths,
  type CampaignMappingLike,
  type MetaInsightLike,
} from "@/lib/meta-sync";

const ins = (campaignId: string, spendGr: number, leadsCount: number): MetaInsightLike => ({
  campaignId,
  spendGr,
  leadsCount,
});
const map = (
  metaCampaignId: string,
  brandId: string | null,
  vertical: string | null,
  ignored = false
): CampaignMappingLike => ({ metaCampaignId, brandId, vertical, ignored });

describe("aggregateMetaToCampaignMonths", () => {
  it("sumuje kampanie z różnych kont per (marka × wertykal)", () => {
    const insights = [ins("c1", 900_000, 300), ins("c2", 390_000, 130)];
    const mappings = [map("c1", "brandA", "SKD"), map("c2", "brandA", "SKD")];
    const r = aggregateMetaToCampaignMonths(insights, mappings);
    expect(r.rows).toEqual([{ brandId: "brandA", vertical: "SKD", spendGr: 1_290_000, leadsCount: 430 }]);
    expect(r.mappedCampaignCount).toBe(2);
    expect(r.unmappedSpendGr).toBe(0);
  });

  it("różne marki/wertykale → osobne wiersze", () => {
    const insights = [ins("c1", 100_000, 10), ins("c2", 200_000, 20)];
    const mappings = [map("c1", "brandA", "SKD"), map("c2", "brandB", "OZE")];
    const r = aggregateMetaToCampaignMonths(insights, mappings);
    expect(r.rows).toHaveLength(2);
  });

  it("kampania niezmapowana → do puli niezmapowanych, nie do wierszy", () => {
    const insights = [ins("c1", 100_000, 10), ins("c2", 50_000, 5)];
    const mappings = [map("c1", "brandA", "SKD")]; // c2 brak mapowania
    const r = aggregateMetaToCampaignMonths(insights, mappings);
    expect(r.rows).toHaveLength(1);
    expect(r.unmappedSpendGr).toBe(50_000);
    expect(r.unmappedLeads).toBe(5);
    expect(r.unmappedCampaignIds).toEqual(["c2"]);
  });

  it("mapowanie bez wertykalu (tylko marka) traktowane jak niezmapowane", () => {
    const r = aggregateMetaToCampaignMonths([ins("c1", 100_000, 10)], [map("c1", "brandA", null)]);
    expect(r.rows).toEqual([]);
    expect(r.unmappedSpendGr).toBe(100_000);
  });

  it("ignored → pomijane i NIE liczone jako niezmapowane", () => {
    const insights = [ins("c1", 100_000, 10), ins("cIgn", 999_000, 99)];
    const mappings = [map("c1", "brandA", "SKD"), map("cIgn", null, null, true)];
    const r = aggregateMetaToCampaignMonths(insights, mappings);
    expect(r.rows).toHaveLength(1);
    expect(r.unmappedSpendGr).toBe(0);
    expect(r.unmappedCampaignIds).toEqual([]);
  });

  it("puste wejście → puste wyniki", () => {
    const r = aggregateMetaToCampaignMonths([], []);
    expect(r.rows).toEqual([]);
    expect(r.mappedCampaignCount).toBe(0);
    expect(r.unmappedSpendGr).toBe(0);
  });
});
