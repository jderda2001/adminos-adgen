"use client";

// Dialog zarządzania markami wewnętrznymi: zmiana nazwy inline, przełącznik
// aktywności, usuwanie (blokowane gdy marka ma kampanie/dostawy — wtedy
// wyłącz zamiast usuwać).

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
  createBrandAction,
  deleteBrandAction,
  renameBrandAction,
  toggleBrandActiveAction,
} from "./actions";

export interface BrandRow {
  id: string;
  name: string;
  active: boolean;
  usageCount: number; // kampanie + dostawy
}

function BrandItem({ brand }: { brand: BrandRow }) {
  const [name, setName] = useState(brand.name);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const dirty = name.trim() !== brand.name;

  function save() {
    if (!dirty) return;
    startTransition(async () => {
      const res = await renameBrandAction(brand.id, name);
      if (res.ok) toast.success(res.message ?? "Zapisano");
      else {
        toast.error(res.error);
        setName(brand.name);
      }
    });
  }

  function toggle(active: boolean) {
    startTransition(async () => {
      const res = await toggleBrandActiveAction(brand.id, active);
      if (res.ok) toast.success(res.message ?? "Zapisano");
      else toast.error(res.error);
    });
  }

  function remove() {
    startTransition(async () => {
      const res = await deleteBrandAction(brand.id);
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
        {brand.usageCount} {pluralPl(brand.usageCount, "wpis", "wpisy", "wpisów")}
      </span>
      <Switch
        checked={brand.active}
        onCheckedChange={toggle}
        disabled={pending}
        aria-label="Marka aktywna"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Usuń markę"
        className="text-muted-foreground hover:text-red-600"
        onClick={() => setConfirmOpen(true)}
        disabled={pending}
      >
        <Trash2 className="size-3.5" />
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Usunąć markę „{brand.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              {brand.usageCount > 0
                ? `Marka ma ${brand.usageCount} ${pluralPl(brand.usageCount, "wpis", "wpisy", "wpisów")} — usunięcie jest zablokowane. Wyłącz ją przełącznikiem.`
                : "Marka nie ma wpisów — można bezpiecznie usunąć."}
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

export function BrandsDialog({ brands, trigger }: { brands: BrandRow[]; trigger: ReactNode }) {
  const [newName, setNewName] = useState("");
  const [pending, startTransition] = useTransition();

  function add() {
    const name = newName.trim();
    if (!name) return;
    startTransition(async () => {
      const res = await createBrandAction(name);
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
          <DialogTitle>Marki wewnętrzne</DialogTitle>
          <DialogDescription>
            Marki prowadzące kampanie leadowe. Wyłączona marka znika z nowych
            wpisów, ale historia zostaje.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {brands.map((b) => (
            <BrandItem key={b.id} brand={b} />
          ))}
          <div className="flex items-center gap-2 pt-1">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Nazwa nowej marki…"
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
