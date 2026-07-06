import { cn } from "@/lib/utils";

// Spójna paleta tonów statusów w całej aplikacji (przychody, koszty, płatności).
// Jasne tło + czytelny tekst, z wariantami dla trybu ciemnego.
export type StatusTone =
  | "neutral"
  | "indigo"
  | "blue"
  | "green"
  | "amber"
  | "red";

const TONE_CLASSES: Record<StatusTone, string> = {
  neutral:
    "bg-muted text-muted-foreground ring-border",
  indigo:
    "bg-primary/10 text-primary ring-primary/20 dark:bg-primary/15",
  blue: "bg-blue-50 text-blue-700 ring-blue-600/15 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-400/20",
  green:
    "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-400/20",
  amber:
    "bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-400/20",
  red: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-400/20",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
  dot = false,
}: {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        TONE_CLASSES[tone],
        className
      )}
    >
      {dot && <span className="size-1.5 rounded-full bg-current opacity-70" />}
      {children}
    </span>
  );
}

// ── Mapowania domenowe ───────────────────────────────────────────────

const INVOICE_TONE: Record<string, StatusTone> = {
  DRAFT: "neutral",
  ISSUED: "blue",
  PAID: "green",
  OVERDUE: "red",
};

/** Ton dla statusu faktury/przychodu (DRAFT/ISSUED/PAID/OVERDUE) */
export function invoiceTone(status: string): StatusTone {
  return INVOICE_TONE[status] ?? "neutral";
}

/** Ton dla statusu płatności kosztu (opłacony / można płacić / brak działań) */
export function costTone(paid: boolean, approved: boolean): StatusTone {
  if (paid) return "green";
  if (approved) return "indigo";
  return "neutral";
}
