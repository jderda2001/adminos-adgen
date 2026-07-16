// Kolory kategorii kosztów (plakietki) — spójne w liście, dropdownach i filtrach.
// Klasy są literalne (Tailwind JIT je widzi). Nieznana kategoria → neutralna.

const CATEGORY_COLORS: Record<string, string> = {
  Networking: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  Abonamenty: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  "Pozostałe wydatki operacyjne": "bg-muted text-foreground/70",
  "Wypłaty | Zespół": "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "Wypłaty | UGC": "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  "Wypłaty | Zarząd": "bg-blue-600 text-white",
  VAT: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300",
  CIT: "bg-violet-600 text-white",
  Oszczędności: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-300",
  "Budżet reklamowy": "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  "Niespodziewane / Obiady zarządu": "bg-green-700 text-white",
  "Zaliczki na CIT / premie": "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  PIT: "bg-amber-900 text-amber-50",
  Podwykonawcy: "bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300",
  Inne: "bg-muted text-foreground/70",
};

export function categoryBadgeClass(name: string): string {
  return CATEGORY_COLORS[name] ?? "bg-muted text-foreground/70";
}

/** Plakietka kategorii (kolorowa) — do użycia w komórkach/dropdownach. */
export function categoryPillClass(name: string): string {
  return `inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${categoryBadgeClass(name)}`;
}
