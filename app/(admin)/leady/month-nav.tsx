"use client";

// Nawigacja miesięczna modułu Leady — MonthPicker + strzałki prev/next,
// stan w URL (?od=RRRR-MM). Celowo bez kwartał/rok — dane są miesięczne.

import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MonthPicker } from "@/components/month-picker";
import { nextMonthKey } from "@/lib/periods";

function prevMonthKey(key: string): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MonthNav({ month }: { month: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const go = (m: string) => router.replace(`${pathname}?od=${m}`, { scroll: false });

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Poprzedni miesiąc"
        onClick={() => go(prevMonthKey(month))}
      >
        <ChevronLeft className="size-4" />
      </Button>
      <MonthPicker value={month} onChange={go} />
      <Button
        variant="outline"
        size="icon-sm"
        aria-label="Następny miesiąc"
        onClick={() => go(nextMonthKey(month))}
      >
        <ChevronRight className="size-4" />
      </Button>
    </div>
  );
}
