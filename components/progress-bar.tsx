import { cn } from "@/lib/utils";

export type ProgressTone = "auto" | "green" | "amber" | "primary" | "blue" | "red";

const FILL: Record<Exclude<ProgressTone, "auto">, string> = {
  green: "bg-emerald-500 dark:bg-emerald-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  primary: "bg-primary",
  blue: "bg-blue-500 dark:bg-blue-400",
  red: "bg-red-500 dark:bg-red-400",
};

/**
 * Cienki pasek postępu (bez tekstu — liczby podpisuje rodzic).
 * tone="auto": zielony gdy cel osiągnięty, bursztynowy w trakcie.
 */
export function ProgressBar({
  value,
  max,
  tone = "auto",
  className,
}: {
  value: number;
  max: number;
  tone?: ProgressTone;
  className?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const resolved: Exclude<ProgressTone, "auto"> =
    tone === "auto" ? (max > 0 && value >= max ? "green" : "amber") : tone;

  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width]", FILL[resolved])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
