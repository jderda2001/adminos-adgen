<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# adGen Finanse — zasady projektu

Wewnętrzny system finansowy agencji adGen (Next.js 16 + SQLite/Prisma 6 +
shadcn/ui wariant Radix). Cały UI po polsku, kwoty w groszach (Int).

**Przeczytaj `docs/CONVENTIONS.md`** — pełne konwencje: wzorzec modułu
(przykład: `app/(admin)/klienci/`), RBAC (`requireAdmin`/`requireUser` na
początku KAŻDEJ akcji serwerowej i route handlera), formaty polskie
(`lib/format.ts`), wyliczenia (`lib/calc.ts` + `lib/reports.ts` — jedyne
źródło prawdy), eksporty CSV/Elixir.

- Next 16: `searchParams`/`params` w page.tsx to Promise — `await` je.
- Statusy w bazie to String — stałe i polskie etykiety w `lib/types.ts`.
- Testy: `npm test` (vitest, katalog `tests/`). Seed: `npm run db:seed`.
