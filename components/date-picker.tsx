"use client";

// Polski wybornik daty — zamiennik natywnego <input type="date">, którego
// kalendarzyk renderuje się w języku PRZEGLĄDARKI (często angielskim).
// Działa w formularzach jak zwykły input: ukryte pole `name` niesie wartość
// "RRRR-MM-DD", więc akcje serwerowe czytające FormData nie wymagają zmian.

import { useState } from "react";
import { pl } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** "2026-07-15" → Date w strefie lokalnej (dla kalendarza) */
function toLocalDate(value: string): Date | undefined {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Date (lokalna) → "2026-07-15" — części LOKALNE (bez przesunięć UTC) */
function toValue(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** "2026-07-15" → "15.07.2026" */
function toDisplay(value: string): string {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "";
}

export function DatePicker({
  name,
  defaultValue = "",
  value: controlledValue,
  onChange,
  placeholder = "Wybierz datę",
  clearable = false,
  disabled = false,
  id,
  className,
}: {
  /** nazwa pola formularza (ukryty input z wartością RRRR-MM-DD) */
  name?: string;
  /** wartość początkowa "RRRR-MM-DD" (tryb niekontrolowany, jak defaultValue inputa) */
  defaultValue?: string;
  /** tryb kontrolowany */
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** pokaż przycisk czyszczenia (dla pól opcjonalnych) */
  clearable?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inner, setInner] = useState(defaultValue);
  const value = controlledValue !== undefined ? controlledValue : inner;

  function setValue(next: string) {
    if (controlledValue === undefined) setInner(next);
    onChange?.(next);
  }

  const selected = value ? toLocalDate(value) : undefined;
  // zakres lat w dropdownie: od 2015 do +2 lata (obejmuje starty współpracy i przyszłe terminy)
  const nowYear = new Date().getFullYear();
  const startMonth = new Date(2015, 0);
  const endMonth = new Date(nowYear + 2, 11);

  return (
    <div className={cn("relative", className)}>
      {name !== undefined && <input type="hidden" name={name} value={value} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            disabled={disabled}
            className={cn(
              "w-full justify-start gap-2 px-3 font-normal",
              !value && "text-muted-foreground"
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
            {value ? toDisplay(value) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={pl}
            weekStartsOn={1}
            selected={selected}
            defaultMonth={selected}
            captionLayout="dropdown"
            onSelect={(date) => {
              if (date) setValue(toValue(date));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {clearable && value && !disabled && (
        <button
          type="button"
          aria-label="Wyczyść datę"
          onClick={() => setValue("")}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
