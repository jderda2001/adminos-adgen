// Ładowanie reguł osobowych (nazwiska → kategoria wynagrodzeń) SPOZA repozytorium.
//
// To dane osobowe, więc NIE są w gitcie: plik config/rw-people.json jest w
// .gitignore i trafia na produkcję przez SSH (rsync). Wzór formatu (śledzony):
// config/rw-people.example.json. Gdy pliku nie ma (publiczny klon, CI) → pusta
// lista: kategoryzacja spada na reguły ogólne (lib/rw-categorize.ts), a użytkownik
// i tak wybiera/poprawia kategorię w kroku przeglądu przed zatwierdzeniem.
//
// UWAGA: moduł czyta z dysku (node:fs) — używać WYŁĄCZNIE po stronie serwera
// (Server Components / route handlers). Reguły przekazujemy do klienta jako
// zwykłe obiekty (props), więc typ PersonRule jest serializowalny.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PersonRule } from "./rw-categorize";

const CONFIG_PATH = join(process.cwd(), "config", "rw-people.json");

const CONFIDENCE = new Set(["high", "medium", "low"]);

function isValidRule(r: unknown): r is PersonRule {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.match === "string" &&
    o.match.length > 0 &&
    typeof o.category === "string" &&
    o.category.length > 0 &&
    typeof o.confidence === "string" &&
    CONFIDENCE.has(o.confidence)
  );
}

/** Wczytuje reguły osobowe z config/rw-people.json. Brak pliku → []. */
export function loadPeopleRules(): PersonRule[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidRule);
  } catch {
    return []; // brak pliku / błędny JSON — działamy na regułach ogólnych
  }
}
