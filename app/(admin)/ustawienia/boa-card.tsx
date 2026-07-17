"use client";

// Cele BOA — docelowy podział przychodu (%). Edytowalne (co kwartał zmieniane),
// widoczne jako „Plan" w karcie Live BOA na Rachunku wyników. Suma musi = 100%.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "./settings-card";
import { saveBoaTargetsAction } from "./actions";

const FIELDS = [
  { name: "oszczednosci", label: "Oszczędności" },
  { name: "wlasciciele", label: "Wynagrodzenie właścicieli" },
  { name: "operacyjne", label: "Wydatki operacyjne" },
  { name: "podatki", label: "Podatki (CIT) + zaliczki" },
] as const;

export function BoaCard({
  targets,
}: {
  targets: { oszczednosci: string; wlasciciele: string; operacyjne: string; podatki: string };
}) {
  const [values, setValues] = useState(targets);
  const [pending, startTransition] = useTransition();

  const set = (name: keyof typeof values, v: string) =>
    setValues((prev) => ({ ...prev, [name]: v }));

  const sum = FIELDS.reduce((acc, f) => acc + (parseFloat(values[f.name].replace(",", ".")) || 0), 0);
  const sumOk = Math.abs(sum - 100) <= 0.5;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    for (const f of FIELDS) formData.set(f.name, values[f.name]);
    startTransition(async () => {
      const result = await saveBoaTargetsAction(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <SettingsCard
      title="Cele BOA"
      description={'Docelowy podział przychodu na kategorie — pokazywany jako „Plan” w karcie Live BOA na Rachunku wyników. Zmieniaj co kwartał; suma musi wynosić 100%.'}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map((f) => (
            <div key={f.name} className="space-y-1">
              <Label htmlFor={`boa-${f.name}`}>{f.label} (%)</Label>
              <Input
                id={`boa-${f.name}`}
                type="number"
                min={0}
                max={100}
                step="0.1"
                inputMode="decimal"
                value={values[f.name]}
                onChange={(e) => set(f.name, e.target.value)}
                className="w-32"
                required
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-4">
          <p className={sumOk ? "text-sm text-muted-foreground" : "text-sm font-medium text-red-600 dark:text-red-400"}>
            Suma: {sum.toFixed(1)}%{sumOk ? "" : " — musi wynosić 100%"}
          </p>
          <Button type="submit" size="sm" disabled={pending || !sumOk}>
            {pending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>
      </form>
    </SettingsCard>
  );
}
