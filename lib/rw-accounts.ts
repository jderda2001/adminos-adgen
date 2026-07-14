// Ładowanie konfiguracji WŁASNYCH KONT (numery kont firmowych + które przelewy
// liczą się jako koszt w momencie przelewu) SPOZA repozytorium.
//
// Numery kont to dane wrażliwe: config/rw-accounts.json jest w .gitignore
// i trafia na produkcję przez SSH. Wzór formatu: config/rw-accounts.example.json.
// Gdy pliku nie ma → działają wartości domyślne (nazwa własna „adgen sp"
// + konta z preambuł wgrywanych wyciągów), a użytkownik i tak przegląda
// wszystko przed zatwierdzeniem.
//
// UWAGA: moduł czyta z dysku (node:fs) — WYŁĄCZNIE po stronie serwera.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SELF_NAMES,
  type InternalRulesConfig,
  type OwnAccountRule,
} from "./rw-internal";

const CONFIG_PATH = join(process.cwd(), "config", "rw-accounts.json");

function isValidRule(r: unknown): r is OwnAccountRule {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (typeof o.match !== "string" || o.match.replace(/\D/g, "").length < 10) return false;
  if (o.name !== undefined && typeof o.name !== "string") return false;
  if (o.transferCategory !== undefined && typeof o.transferCategory !== "string") return false;
  return true;
}

/** Wczytuje config/rw-accounts.json; brak pliku → domyślne (selfNames, 0 kont). */
export function loadInternalRulesConfig(): InternalRulesConfig {
  try {
    const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    if (!parsed || typeof parsed !== "object") throw new Error("bad shape");
    const o = parsed as Record<string, unknown>;
    const selfNames =
      Array.isArray(o.selfNames) && o.selfNames.every((s) => typeof s === "string")
        ? (o.selfNames as string[]).filter((s) => s.trim() !== "")
        : DEFAULT_SELF_NAMES;
    const accounts = Array.isArray(o.accounts)
      ? (o.accounts as unknown[]).filter(isValidRule)
      : [];
    return { selfNames: selfNames.length > 0 ? selfNames : DEFAULT_SELF_NAMES, accounts };
  } catch {
    return { selfNames: DEFAULT_SELF_NAMES, accounts: [] };
  }
}
