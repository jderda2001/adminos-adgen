"use client";

// Polski wybornik miesiąca — zamiennik natywnego <input type="month">,
// którego popup renderuje się w języku przeglądarki (np. "May", "This month").
// Siatka 12 polskich miesięcy + nawigacja po latach + „Bieżący miesiąc".

import { useState } from "react";
import { CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatMonth } from "@/lib/format";

const MONTHS_SHORT = [
  "Sty", "Lut", "Mar", "Kwi", "Maj", "Cze",
  "Lip", "Sie", "Wrz", "Paź", "Lis", "Gru",
] as const;

function currentMonthValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthPicker({
  value,
  onChange,
  className,
}: {
  /** "RRRR-MM" */
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const parsed = value.match(/^(\d{4})-(\d{2})$/);
  const selYear = parsed ? Number(parsed[1]) : new Date().getFullYear();
  const selMonth = parsed ? Number(parsed[2]) : new Date().getMonth() + 1;
  const [viewYear, setViewYear] = useState(selYear);

  function pick(month: number) {
    onChange(`${viewYear}-${String(month).padStart(2, "0")}`);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setViewYear(selYear); // wróć do roku wybranej wartości
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn("w-40 justify-start gap-2 px-3 font-normal", className)}
        >
          <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="capitalize">
            {parsed ? formatMonth(value) : "Wybierz miesiąc"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="mb-2 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Poprzedni rok"
            onClick={() => setViewYear((y) => y - 1)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="text-sm font-medium tabular-nums">{viewYear}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Następny rok"
            onClick={() => setViewYear((y) => y + 1)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {MONTHS_SHORT.map((label, i) => {
            const month = i + 1;
            const isSelected = viewYear === selYear && month === selMonth;
            return (
              <Button
                key={label}
                type="button"
                variant={isSelected ? "default" : "ghost"}
                size="sm"
                className="h-9"
                onClick={() => pick(month)}
              >
                {label}
              </Button>
            );
          })}
        </div>
        <div className="mt-2 flex justify-end border-t pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-primary"
            onClick={() => {
              onChange(currentMonthValue());
              setOpen(false);
            }}
          >
            Bieżący miesiąc
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
