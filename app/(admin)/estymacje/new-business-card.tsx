"use client";

// Założenie „nowy biznes" — płaska kwota netto/miesiąc dodawana do prognozy
// przychodów od kolejnego miesiąca jako pozycja „zakładana" (nie zakontraktowana).

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount } from "@/lib/format";
import { setNewBusinessAssumptionAction } from "./actions";

export function NewBusinessCard({ newBusinessGr }: { newBusinessGr: number }) {
  const [value, setValue] = useState(newBusinessGr > 0 ? formatAmount(newBusinessGr) : "");
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const res = await setNewBusinessAssumptionAction(value);
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <h2 className="text-sm font-semibold">Nowy biznes (założenie)</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Zakładany dodatkowy przychód netto na miesiąc — doliczany do prognozy od
        kolejnego miesiąca jako pozycja „zakładana".
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="new-business">Kwota netto / miesiąc (zł)</Label>
          <Input
            id="new-business"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="0,00"
          />
        </div>
        <Button size="sm" onClick={save} disabled={pending}>
          {pending ? "Zapisywanie…" : "Zapisz"}
        </Button>
      </div>
    </div>
  );
}
