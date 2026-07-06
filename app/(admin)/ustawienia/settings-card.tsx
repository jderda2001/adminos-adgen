// Karta sekcji ustawień — spójna z design systemem redesignu:
// rounded-xl border bg-card shadow-[var(--shadow-card)], czytelny nagłówek i opis.

export function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 shadow-[var(--shadow-card)]">
      <div className="mb-4">
        <h2 className="font-heading text-base font-medium">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
