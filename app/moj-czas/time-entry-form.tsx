"use client";

// Szybki wpis czasu — jedna linia, submit Enterem, wpis w mniej niż 10 sekund.
// Po zapisie czyścimy opis i godziny, ZOSTAWIAMY klienta i datę,
// fokus wraca na pole godzin.

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CopyPlus, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addTimeEntryAction,
  copyYesterdayAction,
  startTimerAction,
} from "./actions";

export interface ClientOption {
  id: string;
  name: string;
}

export function TimeEntryForm({
  clients,
  hasActiveTimer,
  defaultDate,
}: {
  clients: ClientOption[];
  hasActiveTimer: boolean;
  defaultDate: string; // "RRRR-MM-DD"
}) {
  const [clientId, setClientId] = useState("");
  const descriptionRef = useRef<HTMLInputElement>(null);
  const hoursRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await addTimeEntryAction(formData);
      if (result.ok) {
        toast.success(result.message);
        if (descriptionRef.current) descriptionRef.current.value = "";
        if (hoursRef.current) {
          hoursRef.current.value = "";
          hoursRef.current.focus();
        }
      } else {
        toast.error(result.error);
      }
    });
  }

  function handleStart() {
    if (!clientId) {
      toast.error("Wybierz klienta, aby wystartować timer");
      return;
    }
    const formData = new FormData();
    formData.set("clientId", clientId);
    formData.set("description", descriptionRef.current?.value ?? "");
    startTransition(async () => {
      const result = await startTimerAction(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  function handleCopyYesterday() {
    startTransition(async () => {
      const result = await copyYesterdayAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.copied > 0) toast.success(result.message);
      else toast.info(result.message);
    });
  }

  return (
    <div className="rounded-md border bg-background p-3">
      <form
        onSubmit={handleSubmit}
        className="flex flex-wrap items-center gap-2"
      >
        <Select name="clientId" value={clientId} onValueChange={setClientId}>
          <SelectTrigger className="w-44" aria-label="Klient">
            <SelectValue placeholder="Klient" />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          ref={descriptionRef}
          name="description"
          placeholder="Nad czym pracowałeś? (opcjonalnie)"
          className="min-w-40 flex-1"
          aria-label="Opis"
        />
        <Input
          ref={hoursRef}
          name="hours"
          inputMode="decimal"
          placeholder="1,5"
          className="w-20 text-right"
          aria-label="Liczba godzin"
        />
        <Input
          name="date"
          type="date"
          defaultValue={defaultDate}
          className="w-36"
          aria-label="Data"
        />
        <Button type="submit" disabled={pending}>
          <Plus className="size-4" /> Dodaj
        </Button>
        {!hasActiveTimer && (
          <Button
            type="button"
            variant="outline"
            onClick={handleStart}
            disabled={pending}
          >
            <Play className="size-4" /> Start
          </Button>
        )}
      </form>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Wpisz godziny (np. 1,5) i naciśnij Enter — albo użyj timera Start/Stop.
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopyYesterday}
          disabled={pending}
        >
          <CopyPlus className="size-3.5" /> Kopiuj wczorajszy dzień
        </Button>
      </div>
    </div>
  );
}
