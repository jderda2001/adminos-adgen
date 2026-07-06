// Eksport paczki przelewów Elixir-0 dla zaznaczonych, niezapłaconych kosztów.
// POST { ids: string[] } → plik przelewy_RRRRMMDD.txt kodowany Windows-1250.

import { z } from "zod";
import iconv from "iconv-lite";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import {
  buildElixirFile,
  isValidNrb,
  type ElixirTransfer,
} from "@/lib/elixir";
import { todayUTC } from "@/lib/format";

const bodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export async function POST(request: Request) {
  await requireAdmin();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Nieprawidłowe żądanie" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Zaznacz co najmniej jeden koszt do eksportu" },
      { status: 400 }
    );
  }

  const [companyAccount, companyName, companyAddress] = await Promise.all([
    getSetting("company_account"),
    getSetting("company_name"),
    getSetting("company_address"),
  ]);
  if (!isValidNrb(companyAccount)) {
    return Response.json(
      { error: "Uzupełnij numer rachunku firmy w Ustawieniach" },
      { status: 400 }
    );
  }

  const costs = await db.cost.findMany({
    where: {
      id: { in: parsed.data.ids },
      paid: false,
      needsConfirmation: false,
    },
    orderBy: { dueDate: "asc" },
  });
  if (costs.length === 0) {
    return Response.json(
      { error: "Nie znaleziono niezapłaconych kosztów do eksportu" },
      { status: 400 }
    );
  }

  // Wariant twardy: jeśli którakolwiek zaznaczona pozycja nie jest zatwierdzona
  // do płatności („Można płacić"), odrzucamy całą paczkę zamiast po cichu
  // pomijać pozycje — użytkownik świadomie decyduje, co trafia do banku.
  const notApproved = costs.filter((c) => !c.approvedForPayment);
  if (notApproved.length > 0) {
    return Response.json(
      {
        error:
          "Zaznaczone pozycje nie są zatwierdzone do płatności (status „Można płacić”).",
      },
      { status: 400 }
    );
  }

  const invalid = costs.filter(
    (c) => !c.supplierAccount || !isValidNrb(c.supplierAccount)
  );
  if (invalid.length > 0) {
    const suppliers = [...new Set(invalid.map((c) => c.supplierName))].join(
      ", "
    );
    return Response.json(
      { error: `Brak poprawnego numeru rachunku: ${suppliers}` },
      { status: 400 }
    );
  }

  const today = todayUTC();
  const transfers: ElixirTransfer[] = costs.map((c) => ({
    dueDate: c.dueDate ?? today,
    amountGr: c.grossGr,
    receiverAccount: c.supplierAccount as string,
    receiverName: c.supplierName,
    title: `Zapłata za ${c.docNumber}`,
  }));

  const content = buildElixirFile(transfers, {
    account: companyAccount,
    name: companyName,
    address: companyAddress || undefined,
  });
  const encoded = iconv.encode(content, "win1250");

  const y = today.getUTCFullYear();
  const m = String(today.getUTCMonth() + 1).padStart(2, "0");
  const d = String(today.getUTCDate()).padStart(2, "0");
  const filename = `przelewy_${y}${m}${d}.txt`;

  return new Response(new Uint8Array(encoded), {
    headers: {
      "Content-Type": "text/plain; charset=windows-1250",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
