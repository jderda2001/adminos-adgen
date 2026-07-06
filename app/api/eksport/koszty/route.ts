// Eksport CSV listy kosztów — te same filtry URL co strona /finanse/koszty.

import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { csvResponse, toCsv } from "@/lib/csv";
import { formatAmount, formatDate } from "@/lib/format";
import { buildCostFilters } from "@/app/(admin)/finanse/koszty/filters";

const HEADERS = [
  "Data",
  "Dostawca",
  "Nr dokumentu",
  "Kategoria",
  "Klient",
  "Netto",
  "VAT",
  "Brutto",
  "Termin płatności",
  "Zapłacony",
  "Data zapłaty",
  "Notatka",
];

export async function GET(request: Request): Promise<Response> {
  await requireAdmin();

  const sp = new URL(request.url).searchParams;
  const { where } = buildCostFilters({
    okres: sp.get("okres") ?? undefined,
    od: sp.get("od") ?? undefined,
    do: sp.get("do") ?? undefined,
    kategoria: sp.get("kategoria") ?? undefined,
    przypisanie: sp.get("przypisanie") ?? undefined,
    platnosc: sp.get("platnosc") ?? undefined,
  });

  const costs = await db.cost.findMany({
    where,
    include: { category: true, client: true },
    orderBy: { docDate: "asc" },
  });

  const rows = costs.map((c) => [
    formatDate(c.docDate),
    c.supplierName,
    c.docNumber,
    c.category.name,
    c.client?.name ?? "Koszt ogólny",
    formatAmount(c.netGr),
    formatAmount(c.vatGr),
    formatAmount(c.grossGr),
    c.dueDate ? formatDate(c.dueDate) : "",
    c.paid ? "tak" : "nie",
    c.paidDate ? formatDate(c.paidDate) : "",
    c.note ?? "",
  ]);

  return csvResponse(toCsv(HEADERS, rows), "koszty.csv");
}
