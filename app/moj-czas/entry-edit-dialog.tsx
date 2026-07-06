"use client";

// Mały dialog edycji wpisu czasu: klient / opis / godziny / data.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { dateToInput } from "@/lib/format";
import { updateTimeEntryAction } from "./actions";
import type { ClientOption } from "./time-entry-form";
import type { EntryRow } from "./week-view";

/** 90 → "1,5" (wartość do pola godzin, bez sufiksu "h") */
function minutesToHoursInput(minutes: number): string {
  return new Intl.NumberFormat("pl-PL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(minutes / 60);
}

export function EntryEditDialog({
  entry,
  clients,
  trigger,
}: {
  entry: EntryRow;
  clients: ClientOption[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateTimeEntryAction(entry.id, formData);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edytuj wpis czasu</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-clientId">Klient *</Label>
            <Select name="clientId" defaultValue={entry.clientId}>
              <SelectTrigger id="edit-clientId" className="w-full">
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
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-description">Opis</Label>
            <Input
              id="edit-description"
              name="description"
              defaultValue={entry.description ?? ""}
              placeholder="np. kampania Google Ads"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-hours">Liczba godzin *</Label>
              <Input
                id="edit-hours"
                name="hours"
                inputMode="decimal"
                placeholder="1,5"
                defaultValue={minutesToHoursInput(entry.minutes)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-date">Data *</Label>
              <Input
                id="edit-date"
                name="date"
                type="date"
                defaultValue={dateToInput(new Date(entry.date))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Zapisywanie…" : "Zapisz"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
