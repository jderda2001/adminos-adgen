import { cn } from "@/lib/utils";
import type { ProgressTone } from "@/components/progress-bar";

const STROKE: Record<Exclude<ProgressTone, "auto">, string> = {
  green: "text-emerald-500 dark:text-emerald-400",
  amber: "text-amber-500 dark:text-amber-400",
  primary: "text-primary",
  blue: "text-blue-500 dark:text-blue-400",
  red: "text-red-500 dark:text-red-400",
};

/**
 * Wykres donut (czyste SVG, bez JS) z procentem w środku.
 * tone="auto": zielony gdy cel osiągnięty, bursztynowy w trakcie — jak ProgressBar.
 */
export function DonutChart({
  value,
  max,
  tone = "auto",
  size = 76,
  strokeWidth = 8,
  className,
}: {
  value: number;
  max: number;
  tone?: ProgressTone;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const resolved: Exclude<ProgressTone, "auto"> =
    tone === "auto" ? (max > 0 && value >= max ? "green" : "amber") : tone;
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;

  return (
    <div
      role="img"
      aria-label={max > 0 ? `${Math.round(pct * 100)}%` : "brak danych"}
      className={cn("relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`}
          className={cn("transition-[stroke-dasharray]", STROKE[resolved])}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-semibold tabular-nums">
        {max > 0 ? `${Math.round(pct * 100)}%` : "—"}
      </span>
    </div>
  );
}
