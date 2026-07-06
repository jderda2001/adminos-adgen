// Inicjalizacja PRODUKCYJNA — w odróżnieniu od seed.ts NIE czyści bazy i NIE
// wgrywa danych demo. Idempotentna: zakłada domyślne kategorie kosztów,
// domyślne ustawienia (tylko brakujące) oraz konto administratora z zmiennych
// środowiskowych. Uruchom raz po `prisma db push`:
//
//   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME="..." npm run db:bootstrap
//
// Ponowne uruchomienie jest bezpieczne (aktualizuje hasło admina, jeśli podano).

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_COST_CATEGORIES, SETTING_DEFAULTS } from "../lib/types";

const db = new PrismaClient();

async function main() {
  // 1) Kategorie kosztów (upsert po nazwie — nie duplikuje, uzupełnia isSalary/pozycję)
  for (let i = 0; i < DEFAULT_COST_CATEGORIES.length; i++) {
    const cat = DEFAULT_COST_CATEGORIES[i];
    await db.costCategory.upsert({
      where: { name: cat.name },
      create: { name: cat.name, isSalary: cat.isSalary, position: i },
      update: {}, // istniejących nie nadpisujemy (admin mógł je zmienić)
    });
  }

  // 2) Ustawienia — tylko brakujące klucze (nie nadpisujemy istniejących wartości)
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await db.setting.upsert({
      where: { key },
      create: { key, value },
      update: {},
    });
  }

  // 3) Konto administratora z ENV
  const email = process.env.ADMIN_EMAIL?.toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME?.trim() || "Administrator";

  if (!email) {
    console.log(
      "⚠  Pominięto tworzenie admina — ustaw ADMIN_EMAIL (i ADMIN_PASSWORD)."
    );
  } else {
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      const data: { role: string; active: boolean; passwordHash?: string } = {
        role: "ADMIN",
        active: true,
      };
      if (password) data.passwordHash = await bcrypt.hash(password, 10);
      await db.user.update({ where: { email }, data });
      console.log(
        `✓ Zaktualizowano administratora: ${email}${
          password ? " (ustawiono nowe hasło)" : ""
        }`
      );
    } else {
      if (!password) {
        throw new Error(
          "Nowy administrator wymaga ADMIN_PASSWORD (min. 8 znaków)."
        );
      }
      await db.user.create({
        data: {
          name,
          email,
          passwordHash: await bcrypt.hash(password, 10),
          role: "ADMIN",
          active: true,
          mustChangePassword: false,
        },
      });
      console.log(`✓ Utworzono administratora: ${email}`);
    }
  }

  const [cats, settings, admins] = await Promise.all([
    db.costCategory.count(),
    db.setting.count(),
    db.user.count({ where: { role: "ADMIN", active: true } }),
  ]);
  console.log(
    `\nGotowe. Kategorie: ${cats}, ustawienia: ${settings}, aktywni administratorzy: ${admins}.`
  );
}

main()
  .catch((e) => {
    console.error("Błąd bootstrapu:", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
