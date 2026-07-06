// Eksport CSV w polskiej konwencji: średnik jako separator, przecinek dziesiętny,
// BOM UTF-8 (poprawne otwieranie w Excelu).

export function csvEscape(value: string): string {
  // Neutralizacja CSV/formula injection (CWE-1236): komórki zaczynające się od
  // =, +, -, @, tab lub CR Excel interpretuje jako formuły. Zwykłe liczby
  // (w tym ujemne kwoty "-1 234,56") zostawiamy nietknięte.
  const looksLikeFormula =
    /^[=+@\t\r-]/.test(value) && !/^[+-]?[\d\s.,]+$/.test(value);
  const escaped = looksLikeFormula ? `'${value}` : value;
  if (looksLikeFormula || /[";\n\r]/.test(escaped)) {
    return `"${escaped.replace(/"/g, '""')}"`;
  }
  return escaped;
}

/** Buduje treść pliku CSV (średniki, CRLF, BOM) */
export function toCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) =>
    row.map(csvEscape).join(";")
  );
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** Response z plikiem CSV do pobrania */
export function csvResponse(content: string, filename: string): Response {
  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
