// Idempotentne dogranie/uzupełnienie domyślnych kategorii kosztów + flag
// (isSalary, isDeferred). Bezpieczne na produkcji: nie usuwa kategorii
// użytkownika, tylko upsertuje domyślne i aktualizuje flagi. Uruchamiane przy
// wdrożeniu (po `prisma db push`), bo pełny seed nie odpala się na prod.
//
//   npx tsx prisma/ensure-cost-categories.ts

import { db } from "../lib/db";
import { DEFAULT_COST_CATEGORIES } from "../lib/types";

// Zmiany nazw kategorii (audyt 2026-07): stara nazwa → nowa. Rename zachowuje
// przypisane koszty i historię (upsert-po-nazwie tworzyłby nową, osieroconą).
// Wykonywane tylko gdy stara istnieje, a nowa jeszcze nie.
const RENAMES: Record<string, string> = {
  Oszczędności: "Odłożona gotówka - poduszka",
};

async function main() {
  for (const [oldName, newName] of Object.entries(RENAMES)) {
    const [oldCat, newCat] = await Promise.all([
      db.costCategory.findUnique({ where: { name: oldName } }),
      db.costCategory.findUnique({ where: { name: newName } }),
    ]);
    if (oldCat && !newCat) {
      await db.costCategory.update({ where: { id: oldCat.id }, data: { name: newName } });
      console.log(`Zmieniono nazwę kategorii: „${oldName}" → „${newName}" (koszty zachowane)`);
    }
  }

  const maxPos = (await db.costCategory.aggregate({ _max: { position: true } }))._max.position ?? 0;
  let pos = maxPos;
  for (const def of DEFAULT_COST_CATEGORIES) {
    await db.costCategory.upsert({
      where: { name: def.name },
      update: { isDeferred: def.isDeferred ?? false, isAdBudget: def.isAdBudget ?? false },
      create: {
        name: def.name,
        isSalary: def.isSalary,
        isDeferred: def.isDeferred ?? false,
        isAdBudget: def.isAdBudget ?? false,
        position: ++pos,
      },
    });
  }
  const deferred = await db.costCategory.findMany({
    where: { isDeferred: true },
    select: { name: true },
  });
  const adBudget = await db.costCategory.findMany({
    where: { isAdBudget: true },
    select: { name: true },
  });
  console.log("Kategorie kosztów zsynchronizowane. Odłożone:", deferred.map((c) => c.name).join(", "));
  console.log("Budżet reklamowy:", adBudget.map((c) => c.name).join(", "));
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
