// Formatowanie wartości Rachunku Wyników — arkusz operuje pełnymi złotymi,
// więc tabela pokazuje kwoty zaokrąglone do zł (dokładne grosze w tooltipach).

const plWhole = new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 0 });

/**
 * 9880363 gr → "98 804 zł" — zaokrąglenie do pełnych złotych jak w arkuszu:
 * połówki od zera (−150 gr → −2 zł), bez artefaktu „-0 zł" dla −1…−49 gr.
 */
export function formatZl(grosze: number): string {
  const zl = Math.sign(grosze) * Math.round(Math.abs(grosze) / 100);
  return `${plWhole.format(zl === 0 ? 0 : zl)} zł`;
}

/** 0.6941 → "69,4%"; null → "—" */
export function formatRwPct(fraction: number | null, digits = 1): string {
  if (fraction === null || !isFinite(fraction)) return "—";
  return (
    new Intl.NumberFormat("pl-PL", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(fraction * 100) + "%"
  );
}

export const RW_MONTH_SHORT = [
  "Sty", "Lut", "Mar", "Kwi", "Maj", "Cze",
  "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru",
] as const;
