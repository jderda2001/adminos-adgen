"use client";

// Filtr okresu sterowany parametrami URL (?okres=miesiac|kwartal|rok|zakres&od=&do=).
// Strony serwerowe czytają go przez resolvePeriod() z lib/periods.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function PeriodFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const okres = searchParams.get("okres") ?? "miesiac";
  const od = searchParams.get("od") ?? "";
  const doParam = searchParams.get("do") ?? "";
  const monthKey =
    okres === "miesiac" && /^\d{4}-\d{2}$/.test(od) ? od : currentMonthKey();

  function update(params: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={okres}
        onValueChange={(value) => {
          if (value === "zakres") {
            update({ okres: value });
          } else {
            update({ okres: value, od: null, do: null });
          }
        }}
      >
        <SelectTrigger className="w-36" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="miesiac">Miesiąc</SelectItem>
          <SelectItem value="kwartal">Kwartał</SelectItem>
          <SelectItem value="rok">Rok</SelectItem>
          <SelectItem value="zakres">Zakres dat</SelectItem>
        </SelectContent>
      </Select>

      {okres === "miesiac" && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Poprzedni miesiąc"
            onClick={() => update({ od: shiftMonth(monthKey, -1) })}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Input
            type="month"
            className="h-8 w-40"
            value={monthKey}
            onChange={(e) => e.target.value && update({ od: e.target.value })}
          />
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Następny miesiąc"
            onClick={() => update({ od: shiftMonth(monthKey, 1) })}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      )}

      {okres === "zakres" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            className="h-8 w-36"
            value={od}
            onChange={(e) => update({ od: e.target.value })}
            aria-label="Data od"
          />
          <span className="text-sm text-muted-foreground">–</span>
          <Input
            type="date"
            className="h-8 w-36"
            value={doParam}
            onChange={(e) => update({ do: e.target.value })}
            aria-label="Data do"
          />
        </div>
      )}
    </div>
  );
}
