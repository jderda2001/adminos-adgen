"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SettingsCard } from "./settings-card";
import { saveMetaAutosyncAction } from "./actions";

export function IntegrationsCard({
  metaAutosyncEnabled,
  metaConfigured,
}: {
  metaAutosyncEnabled: boolean;
  metaConfigured: boolean;
}) {
  const [enabled, setEnabled] = useState(metaAutosyncEnabled);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set("metaAutosyncEnabled", enabled ? "1" : "0");
    startTransition(async () => {
      const result = await saveMetaAutosyncAction(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <SettingsCard
      title="Integracje — Meta Ads"
      description="Automatyczne zaciąganie wydatków i leadów kampanii z portfolio Meta do modułu Leady"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="metaAutosyncEnabled">Codzienna synchronizacja (cron)</Label>
            <p className="text-sm text-muted-foreground">
              Raz dziennie system automatycznie pobiera kampanie z Meta za bieżący
              miesiąc i aktualizuje wydatki oraz leady. Ręczne wpisy pozostają
              nietknięte. Wymaga tokena Meta i skonfigurowanego harmonogramu na
              serwerze.
            </p>
            {!metaConfigured && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Uwaga: token Meta nie jest skonfigurowany na serwerze — synchronizacja
                działa na danych testowych (mock).
              </p>
            )}
          </div>
          <Switch
            id="metaAutosyncEnabled"
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Codzienna synchronizacja z Meta"
          />
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
