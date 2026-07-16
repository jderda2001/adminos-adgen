// Idempotentne dogranie/uzupełnienie domyślnych kategorii kosztów + flag
// (isSalary, isDeferred). Bezpieczne na produkcji: nie usuwa kategorii
// użytkownika, tylko upsertuje domyślne i aktualizuje flagi. Uruchamiane przy
// wdrożeniu (po `prisma db push`), bo pełny seed nie odpala się na prod.
//
//   npx tsx prisma/ensure-cost-categories.ts

import { db } from "../lib/db";
import { DEFAULT_COST_CATEGORIES } from "../lib/types";

async function main() {
  const maxPos = (await db.costCategory.aggregate({ _max: { position: true } }))._max.position ?? 0;
  let pos = maxPos;
  for (const def of DEFAULT_COST_CATEGORIES) {
    await db.costCategory.upsert({
      where: { name: def.name },
      update: { isDeferred: def.isDeferred ?? false },
      create: {
        name: def.name,
        isSalary: def.isSalary,
        isDeferred: def.isDeferred ?? false,
        position: ++pos,
      },
    });
  }
  const deferred = await db.costCategory.findMany({
    where: { isDeferred: true },
    select: { name: true },
  });
  console.log("Kategorie kosztów zsynchronizowane. Odłożone:", deferred.map((c) => c.name).join(", "));
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
