// Idempotentne dogranie domyślnych wertykali (nisz leadowych) z DEFAULT_VERTICALS.
// Wertykały to generyczne nazwy branżowe (nie dane wrażliwe) — trzymane w kodzie.
// Bezpieczne na produkcji: upsert po nazwie — nie usuwa/zmienia wertykali usera.
//
//   npx tsx prisma/ensure-verticals.ts

import { db } from "../lib/db";
import { DEFAULT_VERTICALS } from "../lib/types";

async function main() {
  const maxPos = (await db.leadVertical.aggregate({ _max: { position: true } }))._max.position ?? 0;
  let pos = maxPos;
  for (const name of DEFAULT_VERTICALS) {
    await db.leadVertical.upsert({
      where: { name },
      update: {},
      create: { name, position: ++pos },
    });
  }
  const verticals = await db.leadVertical.findMany({
    orderBy: { position: "asc" },
    select: { name: true },
  });
  console.log("Wertykały zsynchronizowane:", verticals.map((v) => v.name).join(", "));
}

main()
  .then(() => db.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await db.$disconnect();
    process.exit(1);
  });
