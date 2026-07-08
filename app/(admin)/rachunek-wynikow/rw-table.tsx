"use client";

// Główna tabela miesięczna Rachunku Wyników — wierne odwzorowanie arkusza
// „Rachunek wyników (adGen)". Komponent WYŁĄCZNIE prezentacyjny: wszystkie
// wartości pochodzą z RwReport (lib/rw.ts) — zero własnych wyliczeń.

import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RwLiveBoa, RwMonth, RwReport, RwTotals } from "@/lib/rw";
import {
  RW_BUCKET_LABELS,
  rwCategoriesInBucket,
  type RwBucket,
} from "@/lib/rw-types";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRwPct, formatZl, RW_MONTH_SHORT } from "./rw-format";

// ── Style ────────────────────────────────────────────────────────────

const NEG = "text-red-600 dark:text-red-400";
const POS = "text-green-600 dark:text-green-400";
const FADED = "text-muted-foreground/50";

/** Sticky kolumna „Pozycja" — nieprzezroczyste tło (nachodzi na przewijane kolumny). */
const STICKY_BASE = "sticky left-0 z-10 min-w-56 border-r bg-card";
const STICKY_CELL = cn(
  STICKY_BASE,
  "group-hover:bg-[color-mix(in_oklab,var(--muted)_50%,var(--card))]"
);
/** Wariant dla wierszy nagłówków sekcji (tr ma bg-muted/40 — komórka sticky musi je odwzorować). */
const STICKY_SECTION_CELL = cn(
  STICKY_CELL,
  "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]"
);

const NUM_CELL = "text-right tabular-nums text-[13px]";
const TOTAL_CELL = cn(NUM_CELL, "bg-muted/40 font-medium");
const HEAD_CELL = "text-right text-[11px] uppercase tracking-wide";

const DASH = <span className="text-muted-foreground">—</span>;

// ── Komórki wartości ─────────────────────────────────────────────────

/**
 * Kwota zaokrąglona do zł (jak w arkuszu), dokładne grosze w tooltipie.
 * Ujemne czerwone; `posGreen` dodatkowo koloruje dodatnie na zielono (Zysk);
 * `zeroMuted` wyszarza „0 zł" (puste komórki kategorii). W miesiącach bez
 * danych (`hasData=false`) kolor dziedziczony z wyszarzonej kolumny.
 */
function Money({
  gr,
  hasData = true,
  zeroMuted = false,
  posGreen = false,
}: {
  gr: number;
  hasData?: boolean;
  zeroMuted?: boolean;
  posGreen?: boolean;
}) {
  const cls = !hasData
    ? undefined
    : gr < 0
      ? NEG
      : gr > 0 && posGreen
        ? POS
        : gr === 0 && zeroMuted
          ? FADED
          : undefined;
  return (
    <span title={formatMoney(gr)} className={cls}>
      {formatZl(gr)}
    </span>
  );
}

type PctRule = "none" | "sign" | "marza2";

/** Procent (ułamek → „12,3%"); null → „—". Reguły kolorów: sign (ujemne czerwone), marza2 (cel 10%). */
function Pct({
  value,
  hasData = true,
  rule = "none",
}: {
  value: number | null;
  hasData?: boolean;
  rule?: PctRule;
}) {
  let cls: string | undefined;
  if (hasData && value !== null) {
    if (rule === "marza2") cls = value < 0.1 ? NEG : POS;
    else if (rule === "sign" && value < 0) cls = NEG;
  }
  return <span className={cls}>{formatRwPct(value)}</span>;
}

// ── Wiersze ──────────────────────────────────────────────────────────

/** Wiersz danych: Pozycja | 12 miesięcy | SUMA | ŚREDNIA. */
function MetricRow({
  label,
  months,
  cell,
  suma,
  srednia,
  labelClass,
  indent = false,
}: {
  label: string;
  months: RwMonth[];
  cell: (m: RwMonth) => ReactNode;
  suma: ReactNode;
  srednia: ReactNode;
  labelClass?: string;
  indent?: boolean;
}) {
  return (
    <TableRow className="group">
      <TableCell className={cn(STICKY_CELL, indent && "pl-6", labelClass)}>
        {label}
      </TableCell>
      {months.map((m) => (
        <TableCell
          key={m.month}
          className={cn(NUM_CELL, !m.hasData && FADED)}
        >
          {cell(m)}
        </TableCell>
      ))}
      <TableCell className={TOTAL_CELL}>{suma}</TableCell>
      <TableCell className={TOTAL_CELL}>{srednia}</TableCell>
    </TableRow>
  );
}

/** Nagłówek sekcji arkusza; z `onToggle` — zwijalny (klik w cały wiersz). */
function SectionRow({
  label,
  collapsed = false,
  onToggle,
  accent = false,
}: {
  label: string;
  collapsed?: boolean;
  onToggle?: () => void;
  accent?: boolean;
}) {
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const labelCls = cn(
    "flex items-center gap-1.5 text-[11px] font-semibold uppercase",
    accent ? "text-foreground" : "text-muted-foreground"
  );
  return (
    <TableRow
      className={cn("group bg-muted/40", onToggle && "cursor-pointer")}
      onClick={onToggle}
    >
      <TableCell className={STICKY_SECTION_CELL}>
        {onToggle ? (
          // klawiatura: Enter/Spacja na przycisku bąbelkuje do onClick wiersza
          <button type="button" className={cn(labelCls, "cursor-pointer")}>
            <Chevron className="size-3.5 shrink-0" aria-hidden />
            {label}
          </button>
        ) : (
          <span className={labelCls}>{label}</span>
        )}
      </TableCell>
      <TableCell colSpan={14} />
    </TableRow>
  );
}

// ── LIVE BOA ─────────────────────────────────────────────────────────

const LIVE_BOA_ROWS: { key: keyof RwLiveBoa; label: string }[] = [
  { key: "oszczednosci", label: "Oszczędności" },
  { key: "wlasciciele", label: "Wynagrodzenie właścicieli" },
  { key: "operacyjne", label: "Wydatki operacyjne" },
  { key: "zaliczkaCit", label: "Zaliczka CIT" },
  { key: "cit", label: "Podatek CIT" },
];

// ── Tabela ───────────────────────────────────────────────────────────

export function RwTable({ report }: { report: RwReport }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggle = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  const { months, suma, srednia } = report;

  const sredniaMoney = (pick: (t: RwTotals) => number, zeroMuted = false) =>
    srednia ? <Money gr={pick(srednia)} zeroMuted={zeroMuted} /> : DASH;
  const sredniaPct = (
    pick: (t: RwTotals) => number | null,
    rule: PctRule = "none"
  ) => (srednia ? <Pct value={pick(srednia)} rule={rule} /> : DASH);

  const revenueRows = rwCategoriesInBucket("PRZYCHODY").map((c) => (
    <MetricRow
      key={`PRZYCHODY-${c.name}`}
      indent
      label={c.name}
      months={months}
      cell={(m) => (
        <Money gr={m.revenueByCategory[c.name] ?? 0} hasData={m.hasData} zeroMuted />
      )}
      suma={<Money gr={suma.revenueByCategory[c.name] ?? 0} zeroMuted />}
      srednia={sredniaMoney((t) => t.revenueByCategory[c.name] ?? 0, true)}
    />
  ));

  const costRows = (bucket: RwBucket) =>
    rwCategoriesInBucket(bucket).map((c) => (
      <MetricRow
        key={`${bucket}-${c.name}`}
        indent
        label={c.name}
        months={months}
        cell={(m) => (
          <Money gr={m.costByCategory[c.name] ?? 0} hasData={m.hasData} zeroMuted />
        )}
        suma={<Money gr={suma.costByCategory[c.name] ?? 0} zeroMuted />}
        srednia={sredniaMoney((t) => t.costByCategory[c.name] ?? 0, true)}
      />
    ));

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-card)]">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead
              className={cn(
                STICKY_BASE,
                "text-[11px] uppercase tracking-wide text-muted-foreground"
              )}
            >
              Pozycja
            </TableHead>
            {RW_MONTH_SHORT.map((label, i) => (
              <TableHead
                key={label}
                className={cn(
                  HEAD_CELL,
                  months[i].hasData ? "text-muted-foreground" : FADED
                )}
              >
                {label}
              </TableHead>
            ))}
            <TableHead className={cn(HEAD_CELL, "bg-muted/40 text-muted-foreground")}>
              Suma
            </TableHead>
            <TableHead className={cn(HEAD_CELL, "bg-muted/40 text-muted-foreground")}>
              Średnia
            </TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {/* ── 1. PRZYCHODY ── */}
          <SectionRow
            label={RW_BUCKET_LABELS.PRZYCHODY}
            collapsed={collapsed.przychody}
            onToggle={() => toggle("przychody")}
          />
          <MetricRow
            label="Przychody"
            labelClass="font-semibold"
            months={months}
            cell={(m) => <Money gr={m.revenueTotalGr} hasData={m.hasData} />}
            suma={<Money gr={suma.revenueTotalGr} />}
            srednia={sredniaMoney((t) => t.revenueTotalGr)}
          />
          {!collapsed.przychody && revenueRows}

          {/* ── 2. KOSZTY PRODUKCYJNE (delivery) ── */}
          <SectionRow
            label={RW_BUCKET_LABELS.DELIVERY}
            collapsed={collapsed.delivery}
            onToggle={() => toggle("delivery")}
          />
          <MetricRow
            label="Koszty produkcyjne"
            labelClass="font-semibold"
            months={months}
            cell={(m) => (
              <Money gr={m.bucketTotalsGr.DELIVERY} hasData={m.hasData} />
            )}
            suma={<Money gr={suma.bucketTotalsGr.DELIVERY} />}
            srednia={sredniaMoney((t) => t.bucketTotalsGr.DELIVERY)}
          />
          {!collapsed.delivery && costRows("DELIVERY")}
          <MetricRow
            label="Zysk po kosztach produkcyjnych"
            labelClass="font-medium"
            months={months}
            cell={(m) => <Money gr={m.zyskPoProdukcjiGr} hasData={m.hasData} />}
            suma={<Money gr={suma.zyskPoProdukcjiGr} />}
            srednia={sredniaMoney((t) => t.zyskPoProdukcjiGr)}
          />
          <MetricRow
            label="Marża I"
            months={months}
            cell={(m) => <Pct value={m.marza1} hasData={m.hasData} rule="sign" />}
            suma={<Pct value={suma.marza1} rule="sign" />}
            srednia={sredniaPct((t) => t.marza1, "sign")}
          />
          <MetricRow
            label="% kosztów"
            months={months}
            cell={(m) => (
              <Pct value={m.bucketShareOfCosts.DELIVERY} hasData={m.hasData} />
            )}
            suma={DASH}
            srednia={DASH}
          />

          {/* ── 3. KOSZTY MARKETINGU I SPRZEDAŻY (growth) ── */}
          <SectionRow
            label={RW_BUCKET_LABELS.GROWTH}
            collapsed={collapsed.growth}
            onToggle={() => toggle("growth")}
          />
          <MetricRow
            label="Koszty marketingu i sprzedaży"
            labelClass="font-semibold"
            months={months}
            cell={(m) => (
              <Money gr={m.bucketTotalsGr.GROWTH} hasData={m.hasData} />
            )}
            suma={<Money gr={suma.bucketTotalsGr.GROWTH} />}
            srednia={sredniaMoney((t) => t.bucketTotalsGr.GROWTH)}
          />
          {!collapsed.growth && costRows("GROWTH")}
          <MetricRow
            label="Koszty M&S jako % przychodu"
            months={months}
            cell={(m) => (
              <Pct value={m.bucketShareOfRevenue.GROWTH} hasData={m.hasData} />
            )}
            suma={DASH}
            srednia={DASH}
          />
          <MetricRow
            label="% kosztów"
            months={months}
            cell={(m) => (
              <Pct value={m.bucketShareOfCosts.GROWTH} hasData={m.hasData} />
            )}
            suma={DASH}
            srednia={DASH}
          />

          {/* ── 4. KOSZTY OVERHEAD ── */}
          <SectionRow
            label={RW_BUCKET_LABELS.OVERHEAD}
            collapsed={collapsed.overhead}
            onToggle={() => toggle("overhead")}
          />
          <MetricRow
            label="Koszty overhead"
            labelClass="font-semibold"
            months={months}
            cell={(m) => (
              <Money gr={m.bucketTotalsGr.OVERHEAD} hasData={m.hasData} />
            )}
            suma={<Money gr={suma.bucketTotalsGr.OVERHEAD} />}
            srednia={sredniaMoney((t) => t.bucketTotalsGr.OVERHEAD)}
          />
          {!collapsed.overhead && costRows("OVERHEAD")}
          <MetricRow
            label="Overhead jako % przychodu"
            months={months}
            cell={(m) => (
              <Pct value={m.bucketShareOfRevenue.OVERHEAD} hasData={m.hasData} />
            )}
            suma={DASH}
            srednia={DASH}
          />
          <MetricRow
            label="% kosztów"
            months={months}
            cell={(m) => (
              <Pct value={m.bucketShareOfCosts.OVERHEAD} hasData={m.hasData} />
            )}
            suma={DASH}
            srednia={DASH}
          />

          {/* ── 5. ODŁOŻONE ŚRODKI ── */}
          <SectionRow
            label={RW_BUCKET_LABELS.ODLOZONE}
            collapsed={collapsed.odlozone}
            onToggle={() => toggle("odlozone")}
          />
          <MetricRow
            label="Odłożone środki"
            labelClass="font-semibold"
            months={months}
            cell={(m) => (
              <Money gr={m.bucketTotalsGr.ODLOZONE} hasData={m.hasData} />
            )}
            suma={<Money gr={suma.bucketTotalsGr.ODLOZONE} />}
            srednia={sredniaMoney((t) => t.bucketTotalsGr.ODLOZONE)}
          />
          {!collapsed.odlozone && costRows("ODLOZONE")}

          {/* ── 6. WYNIK FINANSOWY (bez zwijania) ── */}
          <SectionRow label="Wynik finansowy" accent />
          <MetricRow
            label="Koszty (bez odłożonych środków)"
            months={months}
            cell={(m) => <Money gr={m.costsTotalGr} hasData={m.hasData} />}
            suma={<Money gr={suma.costsTotalGr} />}
            srednia={sredniaMoney((t) => t.costsTotalGr)}
          />
          <MetricRow
            label="Zysk"
            labelClass="font-semibold"
            months={months}
            cell={(m) => <Money gr={m.zyskGr} hasData={m.hasData} posGreen />}
            suma={<Money gr={suma.zyskGr} posGreen />}
            srednia={srednia ? <Money gr={srednia.zyskGr} posGreen /> : DASH}
          />
          <MetricRow
            label="CIT"
            months={months}
            cell={(m) => <Money gr={m.citGr} hasData={m.hasData} />}
            suma={<Money gr={suma.citGr} />}
            srednia={sredniaMoney((t) => t.citGr)}
          />
          <MetricRow
            label="Zysk po podatkach"
            labelClass="font-medium"
            months={months}
            cell={(m) => <Money gr={m.zyskPoPodatkachGr} hasData={m.hasData} />}
            suma={<Money gr={suma.zyskPoPodatkachGr} />}
            srednia={sredniaMoney((t) => t.zyskPoPodatkachGr)}
          />
          <MetricRow
            label="Marża I"
            months={months}
            cell={(m) => <Pct value={m.marza1} hasData={m.hasData} rule="sign" />}
            suma={<Pct value={suma.marza1} rule="sign" />}
            srednia={sredniaPct((t) => t.marza1, "sign")}
          />
          <MetricRow
            label="Marża II (cel 10%)"
            months={months}
            cell={(m) => (
              <Pct value={m.marza2} hasData={m.hasData} rule="marza2" />
            )}
            suma={<Pct value={suma.marza2} rule="marza2" />}
            srednia={sredniaPct((t) => t.marza2, "marza2")}
          />
          <MetricRow
            label="Zysk — estymacja"
            months={months}
            cell={(m) =>
              m.estymacjaGr === null ? (
                DASH
              ) : (
                <Money gr={m.estymacjaGr} hasData={m.hasData} />
              )
            }
            suma={DASH}
            srednia={DASH}
          />
          <MetricRow
            label="Zysk — odchylenie"
            months={months}
            cell={(m) =>
              m.odchylenie === null ? (
                <span className="text-muted-foreground">Brak danych</span>
              ) : (
                <Pct value={m.odchylenie} hasData={m.hasData} rule="sign" />
              )
            }
            suma={DASH}
            srednia={DASH}
          />

          {/* ── 7. LIVE BOA ── */}
          <SectionRow
            label="Live BOA (% przychodu na kategorię)"
            collapsed={collapsed.liveBoa}
            onToggle={() => toggle("liveBoa")}
          />
          {!collapsed.liveBoa &&
            LIVE_BOA_ROWS.map(({ key, label }) => (
              <MetricRow
                key={`liveBoa-${key}`}
                indent
                label={label}
                months={months}
                cell={(m) => <Pct value={m.liveBoa[key]} hasData={m.hasData} />}
                suma={DASH}
                srednia={DASH}
              />
            ))}
        </TableBody>
      </Table>
    </div>
  );
}
