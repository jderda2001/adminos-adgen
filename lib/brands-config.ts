// Ładowanie domyślnych marek wewnętrznych SPOZA repozytorium.
//
// Nazwy marek to dane biznesowe agencji — nie trzymamy ich w publicznym
// repo. Realny plik config/brands.json jest w .gitignore i trafia na
// produkcję przez SSH (rsync). Wzór formatu (śledzony): config/brands.example.json.
// Gdy pliku nie ma (publiczny klon, CI) → pusta lista: `ensure-brands` nic nie
// dogrywa, a użytkownik dodaje marki w module Leady (dialog „Marki").
//
// UWAGA: moduł czyta z dysku (node:fs) — używać WYŁĄCZNIE po stronie serwera
// (skrypty, Server Components, route handlers).

import { readFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_PATH = join(process.cwd(), "config", "brands.json");

/** Wczytuje domyślne nazwy marek z config/brands.json. Brak pliku → []. */
export function loadDefaultBrands(): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is string => typeof x === "string" && x.trim().length > 0
    );
  } catch {
    return []; // brak pliku / błędny JSON — marki dodaje użytkownik w UI
  }
}
