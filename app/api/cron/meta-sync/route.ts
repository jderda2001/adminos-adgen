// Cron: codzienny automatyczny sync kampanii z Meta za bieżący miesiąc.
// Uwierzytelnienie nagłówkiem `x-cron-secret` = process.env.CRON_SECRET
// (route bezsesyjny — NIE requireAdmin). Wykonuje się tylko gdy ustawienie
// `meta_autosync_enabled` = "1". Wywoływany np. przez systemd timer na OVH:
//   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3001/api/cron/meta-sync

import { revalidatePath } from "next/cache";
import { runMetaSync } from "@/lib/meta-sync-run";
import { getSetting } from "@/lib/settings";
import { monthKey } from "@/lib/periods";
import { todayUTC } from "@/lib/format";

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET nie skonfigurowany na serwerze" },
      { status: 503 }
    );
  }
  if (request.headers.get("x-cron-secret") !== secret) {
    return Response.json({ ok: false, error: "Brak autoryzacji" }, { status: 401 });
  }

  if ((await getSetting("meta_autosync_enabled")) !== "1") {
    return Response.json({ ok: true, skipped: "autosync wyłączony w Ustawieniach" });
  }

  const month = monthKey(todayUTC());
  try {
    const summary = await runMetaSync(month);
    for (const p of ["/leady", "/rentownosc", "/dashboard"]) revalidatePath(p);
    return Response.json({ ok: true, month, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Nieznany błąd";
    return Response.json({ ok: false, month, error: msg }, { status: 500 });
  }
}
