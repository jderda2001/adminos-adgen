"use client";

// Widok Rachunku Wyników — kompozycja sekcji. KONTRAKT PROPSÓW komponentów
// podrzędnych jest ustalony tutaj; implementacje w osobnych plikach modułu.

import { useRouter, usePathname } from "next/navigation";
import type { RwReport } from "@/lib/rw";
import type { PersonRule } from "@/lib/rw-categorize";
import type { InternalRulesConfig } from "@/lib/rw-internal";
import type { BankAccount } from "@/lib/bank-parse";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { RwImportDialog } from "./rw-import-dialog";
import { RwBatchesSheet } from "./rw-batches-sheet";
import { RwKpis } from "./rw-kpis";
import { RwBoaCard } from "./rw-boa-card";
import { RwCharts } from "./rw-charts";
import { RwTable } from "./rw-table";
import { RwManualMetrics } from "./rw-manual-metrics";

export interface RwBatchRow {
  id: string;
  filename: string;
  kind: string; // PRZYCHOD | KOSZT
  rowCount: number;
  createdAt: string; // ISO
}

export function RwView({
  report,
  years,
  batches,
  peopleRules,
  internalRules,
  knownAccounts,
  aiEnabled,
}: {
  report: RwReport;
  years: number[];
  batches: RwBatchRow[];
  peopleRules: PersonRule[];
  internalRules: InternalRulesConfig;
  knownAccounts: BankAccount[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const hasAnyData = report.monthsWithData.length > 0;
  // rok może mieć same metryki ręczne (bez importów) — muszą pozostać widoczne
  const hasManualData = report.months.some(
    (m) => Object.keys(m.manual).length > 0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={String(report.year)}
          onValueChange={(v) => router.replace(`${pathname}?rok=${v}`, { scroll: false })}
        >
          <SelectTrigger className="w-28" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <RwBatchesSheet batches={batches} />
          <RwImportDialog
            year={report.year}
            peopleRules={peopleRules}
            internalRules={internalRules}
            knownAccounts={knownAccounts}
            aiEnabled={aiEnabled}
          />
        </div>
      </div>

      {report.unknownCategories.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
          Wpisy z nieznanymi kategoriami (pominięte w wyliczeniach):{" "}
          {report.unknownCategories.join(", ")}
        </div>
      )}

      {!hasAnyData ? (
        <>
          <EmptyState
            title="Brak danych za ten rok"
            description="Zaimportuj plik CSV z przychodami i plik z kosztami (format arkusza „Rachunek wyników” adGen), aby zobaczyć metryki."
          >
            <RwImportDialog
              year={report.year}
              peopleRules={peopleRules}
              internalRules={internalRules}
              knownAccounts={knownAccounts}
              aiEnabled={aiEnabled}
              trigger={<Button size="sm">Importuj CSV</Button>}
            />
          </EmptyState>
          {hasManualData && <RwManualMetrics report={report} />}
        </>
      ) : (
        <>
          <RwKpis report={report} />
          <RwBoaCard report={report} />
          <RwCharts report={report} />
          <RwTable report={report} />
          <RwManualMetrics report={report} />
        </>
      )}
    </div>
  );
}
