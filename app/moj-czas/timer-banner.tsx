"use client";

// Baner aktywnego timera — tyka po stronie klienta (setInterval),
// Stop zapisuje wpis, Anuluj odrzuca timer bez zapisu.

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelTimerAction, stopTimerAction } from "./actions";

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TimerBanner({
  clientName,
  description,
  startedAt,
}: {
  clientName: string;
  description: string | null;
  startedAt: string; // ISO
}) {
  const [elapsed, setElapsed] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const start = new Date(startedAt).getTime();
    const tick = () => setElapsed(formatElapsed(Date.now() - start));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  function handleStop() {
    startTransition(async () => {
      const result = await stopTimerAction();
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelTimerAction();
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <span className="relative flex size-2.5 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
        <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{clientName}</div>
        {description && (
          <div className="truncate text-xs text-muted-foreground">
            {description}
          </div>
        )}
      </div>
      <span className="font-mono text-lg font-semibold tabular-nums">
        {elapsed ?? "…"}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={handleStop} disabled={pending}>
          <Square className="size-3.5" /> Stop
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={pending}
        >
          <X className="size-3.5" /> Anuluj
        </Button>
      </div>
    </div>
  );
}
