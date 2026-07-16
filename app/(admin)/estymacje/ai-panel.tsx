"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { formatMonth } from "@/lib/format";
import type { ForecastAiReview } from "@/lib/forecast";
import { aiForecastAction } from "./actions";

const CONF_TONE: Record<string, StatusTone> = { high: "green", medium: "amber", low: "red" };
const CONF_LABEL: Record<string, string> = { high: "wysoka", medium: "średnia", low: "niska" };

export function AiPanel({
  horizon,
  review,
  applied,
  onReview,
  onAppliedChange,
}: {
  horizon: number;
  review: ForecastAiReview | null;
  applied: boolean;
  onReview: (r: ForecastAiReview) => void;
  onAppliedChange: (v: boolean) => void;
}) {
  const [pending, startTransition] = useTransition();

  function run() {
    startTransition(async () => {
      const res = await aiForecastAction(horizon);
      if (res.ok) {
        onReview(res.review);
        toast.success("Analiza AI gotowa");
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-primary" />
          <h3 className="text-sm font-medium">Analiza AI</h3>
          {review && (
            <StatusBadge tone={CONF_TONE[review.confidence]}>
              pewność: {CONF_LABEL[review.confidence]}
            </StatusBadge>
          )}
        </div>
        <div className="flex items-center gap-3">
          {review && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={applied} onCheckedChange={onAppliedChange} aria-label="Scenariusz AI" />
              Scenariusz AI na wykresie
            </label>
          )}
          <Button size="sm" variant="outline" onClick={run} disabled={pending}>
            <Sparkles data-icon="inline-start" />
            {pending ? "Analiza…" : review ? "Odśwież analizę" : "Analiza AI"}
          </Button>
        </div>
      </div>

      {!review ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Poproś AI (konserwatywny CFO) o ocenę prognozy: korekty założeń, ryzyka i komentarz.
          Wynik jest doradczy — baseline pozostaje bez zmian, dopóki nie włączysz scenariusza AI.
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {review.narrative && <p className="text-sm">{review.narrative}</p>}

          {review.risks.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <AlertTriangle className="size-3.5" /> Ryzyka
              </div>
              <ul className="list-inside list-disc space-y-0.5 text-sm">
                {review.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {review.adjustments.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Proponowane korekty
              </div>
              <div className="space-y-1">
                {review.adjustments.map((a) => (
                  <div key={a.period} className="rounded-lg border px-3 py-1.5 text-sm">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                      <span className="font-medium capitalize">{formatMonth(a.period)}</span>
                      {a.revenueAdjPct !== 0 && (
                        <span className={a.revenueAdjPct < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                          przychody {a.revenueAdjPct > 0 ? "+" : ""}
                          {a.revenueAdjPct}%
                        </span>
                      )}
                      {a.costAdjPct !== 0 && (
                        <span className={a.costAdjPct > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}>
                          koszty {a.costAdjPct > 0 ? "+" : ""}
                          {a.costAdjPct}%
                        </span>
                      )}
                    </div>
                    {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
