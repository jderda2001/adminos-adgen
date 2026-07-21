// Cron: codzienne kolejkowanie należnych kroków sekwencji przypomnień o
// płatnościach. Uwierzytelnienie nagłówkiem `x-cron-secret` = process.env.CRON_SECRET
// (route bezsesyjny — NIE requireAdmin). Działa tylko gdy `payment_reminders_enabled` = "1".
// Tryb „kolejka z akceptacją": route tylko KOLEJKUJE, wysyłkę robi admin ręcznie.
// Wywoływany np. przez crontab/systemd timer na OVH:
//   curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:3001/api/cron/payment-reminders

import { revalidatePath } from "next/cache";
import { runPaymentReminders } from "@/lib/reminder-run";
import { refreshInvoiceStatuses } from "@/lib/reports";
import { getSetting } from "@/lib/settings";
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

  if ((await getSetting("payment_reminders_enabled")) !== "1") {
    return Response.json({ ok: true, skipped: "przypomnienia wyłączone w Ustawieniach" });
  }

  try {
    // najpierw uspójnij statusy (ISSUED↔OVERDUE po terminie), potem kolejkuj
    await refreshInvoiceStatuses();
    const summary = await runPaymentReminders(todayUTC());
    revalidatePath("/finanse/przychody");
    return Response.json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Nieznany błąd";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
