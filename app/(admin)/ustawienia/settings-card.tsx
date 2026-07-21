// Karta sekcji ustawień — spójna z design systemem: rounded-2xl border bg-card,
// nagłówek z ikoną-chipem, czytelny tytuł i opis.

import type { LucideIcon } from "lucide-react";

export function SettingsCard({
  title,
  description,
  icon: Icon,
  id,
  children,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-2xl border bg-card p-5 shadow-[var(--shadow-card)]"
    >
      <div className="mb-4 flex items-start gap-3">
        {Icon && (
          <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-4.5" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="font-heading text-base font-semibold leading-tight">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}
