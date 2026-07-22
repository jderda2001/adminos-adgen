/**
 * Migracja: rozdzielenie importów Koszty ↔ Rachunek wyników.
 *
 * Dawniej import CSV kosztów robił „dual-write": tworzył RwImportBatch (kind=KOSZT)
 * + dokumenty Cost (rwBatchId) + mirror-wpisy RwEntry. Te RwEntry DUBLOWAŁY pozycje
 * kosztowe w Rachunku wyników (który i tak ma własny import RW).
 *
 * Sygnatura partii pochodzącej z importera Kosztów = RwImportBatch, która MA
 * podpięte dokumenty Cost (importer RW nigdy nie tworzy Cost). Dla każdej takiej
 * partii:
 *   1) tworzymy CostImportBatch (nowa, osobna baza partii kosztów),
 *   2) przepinamy jej dokumenty Cost na costImportBatchId (zerujemy rwBatchId),
 *   3) kasujemy jej wpisy RwEntry (usuwamy duplikat w RW),
 *   4) kasujemy pustą już RwImportBatch.
 *
 * Partie RW bez podpiętych Cost (natywny import RW) NIE są ruszane.
 *
 * Uruchomienie:
 *   npx tsx prisma/migrate-decouple-imports.ts          # dry-run (tylko raport)
 *   CONFIRM=1 npx tsx prisma/migrate-decouple-imports.ts # wykonanie
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const CONFIRM = process.env.CONFIRM === "1";

async function main() {
  // partie z podpiętymi kosztami = pochodzą z importera Kosztów (dual-write)
  const grouped = await db.cost.groupBy({
    by: ["rwBatchId"],
    where: { rwBatchId: { not: null } },
    _count: { _all: true },
  });
  const batchIds = grouped
    .map((g) => g.rwBatchId)
    .filter((id): id is string => Boolean(id));

  if (batchIds.length === 0) {
    console.log("Brak partii do migracji (żaden Cost nie ma rwBatchId). Nic do zrobienia.");
    return;
  }

  const batches = await db.rwImportBatch.findMany({
    where: { id: { in: batchIds } },
    select: { id: true, filename: true, kind: true, year: true, createdAt: true },
  });
  const costCountByBatch = new Map(grouped.map((g) => [g.rwBatchId as string, g._count._all]));

  let totalRwEntriesToDelete = 0;
  console.log(`Znaleziono ${batches.length} partii z importera Kosztów (dual-write):`);
  for (const b of batches) {
    const rwEntryCount = await db.rwEntry.count({ where: { batchId: b.id } });
    totalRwEntriesToDelete += rwEntryCount;
    console.log(
      `  • „${b.filename}" [${b.kind} ${b.year}] — Cost: ${costCountByBatch.get(b.id) ?? 0}, ` +
        `RwEntry do usunięcia: ${rwEntryCount}`
    );
  }
  console.log(
    `\nPODSUMOWANIE: przeniosę ${batches.length} partii do CostImportBatch, ` +
      `usunę ${totalRwEntriesToDelete} zdublowanych wpisów RwEntry.`
  );

  if (!CONFIRM) {
    console.log("\n[DRY-RUN] Nic nie zmieniono. Uruchom z CONFIRM=1 aby wykonać.");
    return;
  }

  console.log("\n[CONFIRM] Wykonuję migrację…");
  let migrated = 0;
  let deletedEntries = 0;
  for (const b of batches) {
    await db.$transaction(async (tx) => {
      const newBatch = await tx.costImportBatch.create({
        data: {
          filename: b.filename,
          rowCount: costCountByBatch.get(b.id) ?? 0,
          createdAt: b.createdAt, // zachowaj oryginalną datę importu
        },
      });
      await tx.cost.updateMany({
        where: { rwBatchId: b.id },
        data: { costImportBatchId: newBatch.id, rwBatchId: null },
      });
      const del = await tx.rwEntry.deleteMany({ where: { batchId: b.id } });
      deletedEntries += del.count;
      await tx.rwImportBatch.delete({ where: { id: b.id } });
    });
    migrated += 1;
  }
  console.log(
    `\n✓ Gotowe. Przeniesiono ${migrated} partii, usunięto ${deletedEntries} wpisów RwEntry (duplikaty RW).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
