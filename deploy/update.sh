#!/usr/bin/env bash
# Aktualizacja wdrożenia adGen Finanse.
# Uruchom z katalogu aplikacji jako użytkownik aplikacji:
#   cd /var/www/adgen-finanse && ./deploy/update.sh
#
# Kroki: pobranie kodu → zależności → klient Prisma + schemat bazy → build → restart.
# Baza SQLite (prisma/adgen.db) i uploads/ NIE są ruszane (są poza gitem).

set -euo pipefail

echo "▸ git pull"
git pull --ff-only

echo "▸ npm ci (instaluje zależności; postinstall generuje klienta Prisma)"
npm ci

echo "▸ prisma db push (synchronizacja schematu; nie usuwa danych)"
npx prisma db push

echo "▸ dogranie kategorii kosztów, marek i wertykali (idempotentne upserty)"
npx tsx prisma/ensure-cost-categories.ts
npx tsx prisma/ensure-brands.ts
npx tsx prisma/ensure-verticals.ts

echo "▸ next build"
npm run build

echo "▸ restart usługi"
sudo systemctl restart adgen-finanse

echo "✓ Zaktualizowano. Logi: journalctl -u adgen-finanse -f"
