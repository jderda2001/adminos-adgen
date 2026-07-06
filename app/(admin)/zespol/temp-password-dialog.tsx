"use client";

// Jednorazowe okno z hasłem tymczasowym — po zamknięciu hasła nie da się
// ponownie wyświetlić (w bazie jest tylko hash).

import { Copy, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface TempPasswordInfo {
  password: string;
  userName: string;
}

export function TempPasswordDialog({
  info,
  onClose,
}: {
  info: TempPasswordInfo | null;
  onClose: () => void;
}) {
  async function copyPassword() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.password);
      toast.success("Hasło skopiowane do schowka");
    } catch {
      toast.error("Nie udało się skopiować — zaznacz hasło i skopiuj ręcznie");
    }
  }

  return (
    <Dialog open={info !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hasło tymczasowe</DialogTitle>
          <DialogDescription>
            Przekaż to hasło pracownikowi{" "}
            <span className="font-medium text-foreground">
              {info?.userName}
            </span>
            . Przy pierwszym logowaniu system wymusi ustawienie własnego hasła.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-base tracking-wide select-all">
            {info?.password}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copyPassword}
            aria-label="Kopiuj hasło do schowka"
          >
            <Copy className="size-4" />
          </Button>
        </div>

        <p className="flex items-start gap-2 text-sm text-destructive">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Hasło jest widoczne tylko teraz — po zamknięciu tego okna nie będzie
          już nigdzie dostępne. Skopiuj je przed zamknięciem.
        </p>

        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Zamknij
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
