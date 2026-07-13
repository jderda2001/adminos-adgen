// Automatyczne przypisywanie kategorii Rachunku Wyników do operacji z importu.
// Reguły oparte na KONTRAHENCIE (najsilniejszy sygnał) i słowach kluczowych OPISU.
// To „auto-assign" — użytkownik i tak przegląda i poprawia każdą operację
// w dropdownie przed zatwierdzeniem, więc przypadki niejednoznaczne dostają
// niską pewność i są oznaczane do sprawdzenia.
//
// WAŻNE (prywatność): reguły w tym pliku są OGÓLNE (marki SaaS, banki, słowa
// kluczowe) — bez nazwisk. Reguły specyficzne dla adGen (nazwiska pracowników
// i podwykonawców → kategoria wynagrodzeń) to dane osobowe: trzymamy je POZA
// repozytorium, w config/rw-people.json (patrz lib/rw-people.ts), i wstrzykujemy
// jako parametr `people`. Reguły osobowe mają priorytet nad ogólnymi.
//
// Silnik jest CZYSTY (bez bazy/API) — działa offline. W przyszłości można dołożyć
// pass LLM dla operacji z niską pewnością (wymaga klucza API).

import { findRwCategory, type RwKind } from "./rw-types";

export interface CategorySuggestion {
  category: string | null; // kanoniczna nazwa kategorii lub null (brak trafienia)
  confidence: "high" | "medium" | "low";
}

/** Reguła osobowa/adGen-specyficzna — ładowana spoza repo (dane osobowe). */
export interface PersonRule {
  match: string; // źródło RegExp; dopasowane do znormalizowanego „kontrahent | opis"
  category: string;
  confidence: "high" | "medium" | "low";
}

/** normalizacja: małe litery, bez polskich znaków, pojedyncze spacje */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l") // NFD nie rozkłada „ł" — zamieniamy ręcznie (Przeszło, Sokołowska…)
    .replace(/\s+/g, " ")
    .trim();
}

interface Rule {
  // dopasowanie do znormalizowanego "kontrahent | opis"
  test: RegExp;
  category: string;
  confidence: "high" | "medium" | "low";
}

// Kolejność MA znaczenie — pierwsza pasująca reguła wygrywa. Reguły bardziej
// szczegółowe (słowa kluczowe) przed ogólnymi. Wyłącznie sygnały OGÓLNE —
// bez nazwisk (te są w config/rw-people.json, wstrzykiwane przez `people`).
const COST_RULES: Rule[] = [
  // ── odłożone środki / podatki (frazy generyczne) ──
  { test: /oszczednosci/, category: "Środki przelane na oszczędności", confidence: "high" },
  { test: /zaliczka.*(premie|zespol)|premie zespol/, category: "Zaliczka na premie zespołu", confidence: "high" },
  { test: /zaliczka.*cit/, category: "Zaliczka na podatek CIT", confidence: "high" },
  { test: /urzad skarbowy|cit-?8|\bcit\b/, category: "CIT", confidence: "high" },

  // ── księgowość / czynsz (słowa kluczowe) ──
  { test: /ksiegow|biuro rachunkowe/, category: "Obsługa księgowa", confidence: "high" },
  { test: /czynsz|wynajem biur/, category: "Biuro - czynsz", confidence: "high" },

  // ── budżety reklamowe / marketing (platformy publiczne) ──
  // Meta/Facebook: dominująco Marketing - budżety (bywa Delivery - budżet reklamowy → user poprawi)
  { test: /meta ads|meta \(|facebook|\bmeta\b|google ads|woodpecker|mailerlite/, category: "Marketing - budżety", confidence: "low" },
  { test: /instantly/, category: "Sprzedaż - zewnętrzny koszt", confidence: "medium" },

  // ── abonamenty / SaaS / telekomy (marki publiczne) ──
  { test: /canva|clickup|click up|google workspace|google\b|openai|anthropic|claude|make\.com|make\b|sellizer|t-?mobile|\bplay\b|medicover|eleven ?labs|kie\.?ai|capcut|hostinger|hostido|ovh|stripo|webflow|zadarma|codekit|manus|exa\.ai|sms ?planet|app world|semrush|ahrefs|notion|slack|zoom|adobe|figma/, category: "Administracja - abonamenty", confidence: "high" },

  // ── sprzęt / networking / biuro (marki/retail + słowa kluczowe) ──
  { test: /media expert|media markt|x-?kom|jysk|homla|artgift|euro rtv|komputronik/, category: "Biuro - sprzęt", confidence: "medium" },
  { test: /restaurac|pizza|restaurant|bistro|kawiarni/, category: "Sprzedaż - networking, restauracje", confidence: "medium" },
  { test: /allianz|ubezpiecz|firma budowlana/, category: "Biuro - pozostałe", confidence: "medium" },

  // ── podwykonawcy — słowo kluczowe generyczne (nazwiska: config/rw-people.json) ──
  { test: /podwykonaw/, category: "Delivery - podwykonawcy", confidence: "low" },

  // ── opłaty bankowe i drobne → Inne ──
  { test: /mbank|nest bank|oplata za prowadzenie|mt940|prowizj|raporty|odsetki|blik|zwrot zakupu|zabka|lidl|netto|morele|poczta|uber|koleo|booking|allegro|glovo|zara/, category: "Inne", confidence: "low" },
];

const REVENUE_RULES: Rule[] = [
  { test: /pilotaz/, category: "Paczki leadów (pilotaż)", confidence: "high" },
  { test: /stala wspolpraca|stala/, category: "Paczki leadów (stała współpraca)", confidence: "medium" },
  { test: /paczk|lead/, category: "Paczki leadów (pilotaż)", confidence: "low" },
  { test: /abonament/, category: "Abonament marketingowy", confidence: "high" },
  { test: /zwrot|refaktura|odsetki|windykacj/, category: "Inne", confidence: "medium" },
];

/**
 * Sugeruje kategorię dla operacji. Łączy kontrahenta i opis (oba mogą być puste)
 * i dopasowuje reguły. Reguły osobowe (`people`, spoza repo) mają priorytet nad
 * ogólnymi. Zwraca null gdy nic nie pasuje (przychody) — UI pokaże „(wybierz)".
 * Koszty bez trafienia → „Inne" z niską pewnością (do sprawdzenia).
 */
export function suggestCategory(
  kind: RwKind,
  fields: { description?: string | null; contractor?: string | null },
  people: PersonRule[] = []
): CategorySuggestion {
  const hint = norm(`${fields.contractor ?? ""} | ${fields.description ?? ""}`);

  // 1) reguły osobowe/adGen-specyficzne (nazwiska) — najsilniejszy sygnał, tylko koszty
  if (kind === "KOSZT") {
    for (const r of people) {
      let re: RegExp;
      try {
        re = new RegExp(r.match);
      } catch {
        continue; // błędny wzorzec w configu — pomiń, nie wysypuj importu
      }
      if (re.test(hint)) {
        const cat = findRwCategory(kind, r.category);
        if (cat) return { category: cat.name, confidence: r.confidence };
      }
    }
  }

  // 2) reguły ogólne (marki/słowa kluczowe)
  const rules = kind === "KOSZT" ? COST_RULES : REVENUE_RULES;
  for (const rule of rules) {
    if (rule.test.test(hint)) {
      // upewnij się, że kategoria istnieje w taksonomii (spójność)
      const cat = findRwCategory(kind, rule.category);
      if (cat) return { category: cat.name, confidence: rule.confidence };
    }
  }

  // brak trafienia: koszty najczęściej „Inne", ale z niską pewnością do sprawdzenia
  if (kind === "KOSZT") return { category: "Inne", confidence: "low" };
  return { category: null, confidence: "low" };
}
