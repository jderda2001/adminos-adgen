"use client";

// Zarządzanie wertykałami (nisze leadowe): zmiana nazwy inline (przepisuje też
// kampanie/dostawy), przełącznik aktywności, usuwanie (blokowane przy użyciu).

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { pluralPl } from "@/lib/format";
import {
  createVerticalAction,
  deleteVerticalAction,
  renameVerticalAction,
  toggleVerticalActiveAction,
} from "./actions";

export interface VerticalRow {
  id: string;
  name: string;
  active: boolean;
  usageCount: number; // kampanie + dostawy
}

function VerticalItem({ vertical }: { vertical: VerticalRow }) {
  const [name, setName] = useState(vertical.name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const dirty = name.trim() !== vertical.name;

  function save() {
    if (!dirty) return;
    startTransition(async () => {
      const res = await renameVerticalAction(vertical.id, name);
      if (res.ok) toast.success(res.message ?? "Zapisano");
      else {
        toast.error(res.error);
        setName(vertical.name);
      }
    });
  }
  function toggle(active: boolean) {
    startTransition(async () => {
      const res = await toggleVerticalActiveAction(vertical.id, active);
      if (res.ok) toast.success(res.message ?? "Zapisano");
      else toast.error(res.error);
    });
  }
  function remove() {
    startTransition(async () => {
      const res = await deleteVerticalAction(vertical.id);
      if (res.ok) toast.success(res.message ?? "Usunięto");
      else toast.error(res.error);
      setConfirmOpen(false);
    });
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border px-2.5 py-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
        className="h-8 flex-1"
        disabled={pending}
      />
      {dirty && (
        <Button variant="ghost" size="icon-sm" onClick={save} disabled={pending} aria-label="Zapisz nazwę">
          <Check className="size-4" />
        </Button>
      )}
      <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
        {vertical.usageCount} {pluralPl(vertical.usageCount, "wpis", "wpisy", "wpisów")}
      </span>
      <Switch checked={vertical.active} onCheckedChange={toggle} disabled={pending} aria-label="Wertykal aktywny" />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Usuń wertykal"
        className="text-muted-foreground hover:text-red-600"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć wertykal „{vertical.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {vertical.usageCount > 0
                ? `Wertykal ma ${vertical.usageCount} ${pluralPl(vertical.usageCount, "wpis", "wpisy", "wpisów")} — usunięcie zablokowane. Wyłącz go przełącznikiem.`
                : "Wertykal nie ma wpisów — można bezpiecznie usunąć."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Anuluj</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove} disabled={pending}>
              Usuń
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function VerticalsDialog({ verticals, trigger }: { verticals: VerticalRow[]; trigger: ReactNode }) {
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createVerticalAction(name);
      if (res.ok) {
        toast.success(res.message ?? "Dodano");
        setNewName("");
      } else toast.error(res.error);
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Wertykały (nisze)</DialogTitle>
          <DialogDescription>
            Nisze leadowe używane w kampaniach, dostawach i tagach faktur.
            Wyłączony wertykal znika z nowych wpisów, historia zostaje.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {verticals.map((v) => (
            <VerticalItem key={v.id} vertical={v} />
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Nazwa nowego wertykalu…"
              className="h-8 flex-1"
              disabled={pending}
            />
            <Button size="sm" onClick={add} disabled={pending || !newName.trim()}>
              <Plus className="size-4" /> Dodaj
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
