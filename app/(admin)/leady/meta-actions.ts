"use server";

// Akcje integracji Meta: zaciąganie kampanii z portfolio i mapowanie
// kampania → marka + wertykal. Sync upsertuje LeadCampaignMonth (source=META),
// NIE nadpisując wpisów ręcznych (source=MANUAL).

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { runMetaSync } from "@/lib/meta-sync-run";
import { DEFAULT_VERTICALS } from "@/lib/types";

const PATHS = ["/leady", "/rentownosc", "/dashboard"] as const;
function revalidateAll() {
  for (const p of PATHS) revalidatePath(p);
}

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Nieprawidłowy miesiąc");

/**
 * Zaciąga kampanie z Meta za miesiąc, aktualizuje mapę kampanii i wpisuje
 * zagregowane spendy/leady do LeadCampaignMonth (source=META). Ręczne wpisy
 * (source=MANUAL) pozostają nietknięte. Loguje MetaSyncRun.
 */
export async function syncMetaCampaignsAction(
  monthInput: string
): Promise<ActionResult> {
  await requireAdmin();
  const parsed = monthSchema.safeParse(monthInput);
  if (!parsed.success) return fail("Nieprawidłowy miesiąc");
  const month = parsed.data;

  try {
    const summary = await runMetaSync(month);
    revalidateAll();
    return ok(
      `Zaciągnięto ${summary.campaignsPulled} kampanii z Meta${summary.mock ? " (dane testowe)" : ""}. ` +
        `Zmapowanych: ${summary.mappedCount}, niezmapowanych: ${summary.unmappedCampaigns}.`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Nieznany błąd";
    return fail(`Sync z Meta nieudany: ${msg}`);
  }
}

// ── Mapowanie kont reklamowych (konto → marka wewnętrzna albo „konto klienta") ──

const accountMappingSchema = z.object({
  adAccountId: z.string().min(1),
  brandId: z.string().optional(),
  mixed: z.boolean().optional(),
  ignored: z.boolean().optional(),
});

/**
 * Przypisuje konto reklamowe: do jednej marki, jako „mieszane" (wiele marek —
 * marka wybierana per kampania) albo jako klienckie (pomijane w całości).
 */
export async function setAccountMappingAction(input: {
  adAccountId: string;
  brandId?: string;
  mixed?: boolean;
  ignored?: boolean;
}): Promise<ActionResult> {
  await requireAdmin();
  const parsed = accountMappingSchema.safeParse(input);
  if (!parsed.success) return fail("Nieprawidłowe dane konta");
  const d = parsed.data;

  const ignored = d.ignored ?? false;
  const mixed = !ignored && (d.mixed ?? false);
  const brandId = ignored || mixed ? null : d.brandId || null;
  if (brandId) {
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    if (!brand) return fail("Wybrana marka nie istnieje");
  }

  // konto mogło być widziane tylko w kampaniach (sprzed mapy kont) → upsert z nazwą
  const fromCampaign = await db.metaCampaignMap.findFirst({
    where: { adAccountId: d.adAccountId },
    select: { adAccountName: true },
  });
  await db.metaAdAccountMap.upsert({
    where: { adAccountId: d.adAccountId },
    update: { brandId, mixed, ignored },
    create: {
      adAccountId: d.adAccountId,
      adAccountName: fromCampaign?.adAccountName ?? d.adAccountId,
      brandId,
      mixed,
      ignored,
    },
  });
  revalidateAll();
  return ok(
    ignored
      ? "Konto oznaczone jako klienckie (pomijane)"
      : mixed
        ? "Konto oznaczone jako mieszane — marki wybierzesz przy kampaniach"
        : "Konto przypisane do marki"
  );
}

const mappingSchema = z.object({
  metaCampaignId: z.string().min(1),
  brandId: z.string().optional(),
  vertical: z.string().optional(),
  ignored: z.boolean().optional(),
});

/** Przypisuje kampanię Meta do marki + wertykalu (lub oznacza „ignoruj"). */
export async function setCampaignMappingAction(input: {
  metaCampaignId: string;
  brandId?: string;
  vertical?: string;
  ignored?: boolean;
}): Promise<ActionResult> {
  await requireAdmin();
  const parsed = mappingSchema.safeParse(input);
  if (!parsed.success) return fail("Nieprawidłowe dane mapowania");
  const d = parsed.data;

  const ignored = d.ignored ?? false;
  const brandId = ignored ? null : d.brandId || null;
  const vertical = ignored ? null : d.vertical || null;

  if (!ignored && brandId) {
    const brand = await db.brand.findUnique({ where: { id: brandId } });
    if (!brand) return fail("Wybrana marka nie istnieje");
  }
  if (!ignored && vertical && !DEFAULT_VERTICALS.includes(vertical)) {
    const v = await db.leadVertical.findUnique({ where: { name: vertical } });
    if (!v) return fail("Nieznany wertykal");
  }

  await db.metaCampaignMap.update({
    where: { metaCampaignId: d.metaCampaignId },
    data: { brandId, vertical, ignored },
  });
  revalidateAll();
  return ok(ignored ? "Kampania oznaczona jako ignorowana" : "Mapowanie zapisane");
}
