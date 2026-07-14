import Link from "next/link";
import { cn } from "@/lib/utils";

export type KpiTone = "default" | "positive" | "negative" | "warning";

const VALUE_TONE: Record<KpiTone, string> = {
  default: "text-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  negative: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
};

/**
 * Kafel KPI — minimalistyczny: etykieta u góry, duża wartość, opcjonalny podpis.
 * Gdy podano `href`, cały kafel jest klikalny.
 */
export function KpiCard({
  label,
  value,
  sub,
  tone = "default",
  icon,
  href,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: KpiTone;
  icon?: React.ReactNode;
  href?: string;
  className?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        {icon && <span className="text-muted-foreground/70">{icon}</span>}
      </div>
      <div
        className={cn(
          "mt-2 truncate text-xl font-semibold tabular-nums tracking-tight",
          VALUE_TONE[tone]
        )}
      >
        {value}
      </div>
      {sub && (
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      )}
    </>
  );

  const base =
    "block rounded-2xl border border-border bg-card p-4 shadow-[var(--shadow-card)] transition-colors";

  if (href) {
    return (
      <Link
        href={href}
        className={cn(base, "hover:border-primary/30 hover:bg-accent/40", className)}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cn(base, className)}>{inner}</div>;
}
