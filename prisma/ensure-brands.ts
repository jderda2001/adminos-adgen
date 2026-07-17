// Idempotentne dogranie domyślnych marek wewnętrznych (moduł Leady) z
// config/brands.json (poza repo — patrz lib/brands-config.ts). Bezpieczne na
// produkcji: upsert po nazwie — nie usuwa ani nie zmienia marek użytkownika.
// Brak configu (publiczny klon) → nic nie dogrywa. Uruchamiane przy wdrożeniu
// (po `prisma db push`); realny config/brands.json wgrywany na prod przez SSH.
//
//   npx tsx prisma/ensure-brands.ts

import { db } from "../lib/db";
import { loadDefaultBrands } from "../lib/brands-config";

async function main() {
  const names = loadDefaultBrands();
  if (names.length === 0) {
    console.log("Brak config/brands.json — pomijam (marki dodasz w module Leady).");
    return;
  }
  const maxPos = (await db.brand.aggregate({ _max: { position: true } }))._max.position ?? 0;
  let pos = maxPos;
  for (const name of names) {
    await db.brand.upsert({
      where: { name },
      update: {},
      create: { name, position: ++pos },
    });
  }
  const brands = await db.brand.findMany({ orderBy: { position: "asc" }, select: { name: true } });
  console.log("Marki zsynchronizowane:", brands.map((b) => b.name).join(", "));
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
