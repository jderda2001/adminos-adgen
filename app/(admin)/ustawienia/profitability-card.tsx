"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "./settings-card";
import { saveProfitabilitySettingsAction } from "./actions";

export function ProfitabilityCard({
  allocationEnabled,
  marginThresholdPct,
}: {
  allocationEnabled: boolean;
  marginThresholdPct: string;
}) {
  const [enabled, setEnabled] = useState(allocationEnabled);
  const [threshold, setThreshold] = useState(marginThresholdPct);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("allocationEnabled", enabled ? "1" : "0");
    formData.set("marginThreshold", threshold);
    startTransition(async () => {
      const result = await saveProfitabilitySettingsAction(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <SettingsCard
      title="Rentowność"
      description="Sposób liczenia marż klientów w raportach Rentowności i na dashboardzie"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="allocationEnabled">
                Alokuj koszty ogólne na klientów
              </Label>
              <p className="text-sm text-muted-foreground">
                Koszty ogólne firmy (bez wynagrodzeń) są dzielone na klientów
                proporcjonalnie do udziału klienta w przychodach okresu.
              </p>
            </div>
            <Switch
              id="allocationEnabled"
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label="Alokuj koszty ogólne na klientów"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="marginThreshold">Próg marży (%)</Label>
            <Input
              id="marginThreshold"
              type="number"
              min={0}
              max={100}
              step="0.1"
              inputMode="decimal"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-32"
              required
            />
            <p className="text-sm text-muted-foreground">
              Klienci z marżą poniżej progu są podświetlani na czerwono
              w Rentowności.
            </p>
          </div>

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Zapisywanie…" : "Zapisz"}
            </Button>
          </div>
      </form>
    </SettingsCard>
  );
}
