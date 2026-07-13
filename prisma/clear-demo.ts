// Czyści DANE PRZYKŁADOWE/OPERACYJNE, zachowując to, co ma zostać na produkcji:
//   ZOSTAJE:  Rachunek wyników (RwEntry, RwImportBatch, RwManualMetric),
//             kategorie kosztów, ustawienia, konto(a) administratora.
//   USUWANE:  klienci, faktury/przychody, koszty, koszty cykliczne,
//             wpisy czasu, timery, uwagi planu, stawki godzinowe,
//             konta użytkowników INNE niż administratorzy.
//
// Uruchom: npm run db:clear-demo

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const before = {
    klienci: await db.client.count(),
    faktury: await db.invoice.count(),
    koszty: await db.cost.count(),
    wpisyCzasu: await db.timeEntry.count(),
    uzytkownicy: await db.user.count(),
    rwWpisy: await db.rwEntry.count(),
  };

  await db.$transaction([
    // dane operacyjne modułów finansowych (kolejność wg FK; kaskady dodatkowo chronią)
    db.invoiceItem.deleteMany({}),
    db.invoice.deleteMany({}),
    db.recurringCost.deleteMany({}),
    db.cost.deleteMany({}),
    db.activeTimer.deleteMany({}),
    db.timeEntry.deleteMany({}),
    db.revenuePlanNote.deleteMany({}),
    db.hourlyRate.deleteMany({}),
    db.client.deleteMany({}),
    // konta nie-administratorów (kaskadowo usuwa ich sesje)
    db.user.deleteMany({ where: { role: { not: "ADMIN" } } }),
  ]);

  const after = {
    klienci: await db.client.count(),
    faktury: await db.invoice.count(),
    koszty: await db.cost.count(),
    wpisyCzasu: await db.timeEntry.count(),
    uzytkownicy: await db.user.count(),
    administratorzy: await db.user.count({ where: { role: "ADMIN" } }),
    rwWpisy: await db.rwEntry.count(),
    kategorie: await db.costCategory.count(),
    ustawienia: await db.setting.count(),
  };

  console.log("Przed:", before);
  console.log("Po:   ", after);
  console.log(
    `\n✓ Wyczyszczono dane przykładowe. Zachowano: ${after.rwWpisy} wpisów RW, ` +
      `${after.kategorie} kategorii, ${after.ustawienia} ustawień, ` +
      `${after.administratorzy} administratorów.`
  );
}

main()
  .catch((e) => {
    console.error("Błąd czyszczenia:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
