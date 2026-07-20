// Testy agregacji Meta → kampanie RW (lib/meta-sync.ts).

import { describe, expect, it } from "vitest";
import {
  aggregateMetaToCampaignMonths,
  type AccountMappingLike,
  type CampaignMappingLike,
  type MetaInsightLike,
} from "@/lib/meta-sync";

const ins = (
  campaignId: string,
  spendGr: number,
  leadsCount: number,
  adAccountId?: string
): MetaInsightLike => ({
  campaignId,
  adAccountId,
  spendGr,
  leadsCount,
});
const acc = (adAccountId: string, brandId: string | null, ignored = false): AccountMappingLike => ({
  adAccountId,
  brandId,
  ignored,
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

  it("marka dziedziczona z konta — kampania potrzebuje tylko wertykalu", () => {
    const insights = [ins("c1", 100_000, 10, "act_1")];
    const mappings = [map("c1", null, "SKD")];
    const r = aggregateMetaToCampaignMonths(insights, mappings, [acc("act_1", "brandA")]);
    expect(r.rows).toEqual([{ brandId: "brandA", vertical: "SKD", spendGr: 100_000, leadsCount: 10 }]);
    expect(r.unmappedSpendGr).toBe(0);
  });

  it("override marki per kampania wygrywa z marką konta", () => {
    const insights = [ins("c1", 100_000, 10, "act_1")];
    const mappings = [map("c1", "brandB", "OZE")];
    const r = aggregateMetaToCampaignMonths(insights, mappings, [acc("act_1", "brandA")]);
    expect(r.rows[0].brandId).toBe("brandB");
  });

  it("konto klienckie (ignored) → kampanie pomijane w całości, nie „niezmapowane”", () => {
    const insights = [ins("c1", 500_000, 50, "act_klient"), ins("c2", 100_000, 10, "act_1")];
    const mappings = [map("c2", null, "SKD")];
    const accounts = [acc("act_klient", null, true), acc("act_1", "brandA")];
    const r = aggregateMetaToCampaignMonths(insights, mappings, accounts);
    expect(r.rows).toHaveLength(1);
    expect(r.unmappedSpendGr).toBe(0);
    expect(r.unmappedCampaignIds).toEqual([]);
  });

  it("konto z marką, kampania bez wertykalu → niezmapowana", () => {
    const insights = [ins("c1", 100_000, 10, "act_1")];
    const r = aggregateMetaToCampaignMonths(insights, [], [acc("act_1", "brandA")]);
    expect(r.rows).toEqual([]);
    expect(r.unmappedSpendGr).toBe(100_000);
    expect(r.unmappedCampaignIds).toEqual(["c1"]);
  });

  it("konto bez przypisania → kampanie niezmapowane (czekają na decyzję)", () => {
    const insights = [ins("c1", 100_000, 10, "act_nowe")];
    const r = aggregateMetaToCampaignMonths(insights, [map("c1", null, "SKD")], []);
    expect(r.rows).toEqual([]);
    expect(r.unmappedSpendGr).toBe(100_000);
  });
});
