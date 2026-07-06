"use client";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

/**
 * Wysuwany panel szczegółów (prawa strona) — główny wzorzec „rozwinięcia"
 * w aplikacji: widoki główne pokazują podstawowe dane, a szczegóły i akcje
 * lądują tutaj, bez przytłaczania listy.
 */
export function DetailSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle className="text-base">{title}</SheetTitle>
          {description && (
            <SheetDescription>{description}</SheetDescription>
          )}
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4">{children}</div>
        </ScrollArea>
        {footer && (
          <div className="border-t bg-muted/40 px-5 py-3">{footer}</div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Wiersz „etykieta → wartość" w panelu szczegółów */
export function DetailRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "flex items-start justify-between gap-4 py-2.5 border-b border-border/60 last:border-0 " +
        (className ?? "")
      }
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right tabular-nums">
        {children}
      </span>
    </div>
  );
}
