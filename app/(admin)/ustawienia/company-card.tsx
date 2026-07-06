"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsCard } from "./settings-card";
import { saveCompanySettingsAction } from "./actions";

export function CompanyCard({
  name,
  address,
  account,
}: {
  name: string;
  address: string;
  account: string;
}) {
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveCompanySettingsAction(formData);
      if (result.ok) toast.success(result.message);
      else toast.error(result.error);
    });
  }

  return (
    <SettingsCard
      title="Dane firmy"
      description="Te dane trafiają do paczki przelewów Elixir generowanej w module Płatności — nazwa i rachunek zleceniodawcy."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="companyName">Nazwa firmy *</Label>
            <Input
              id="companyName"
              name="companyName"
              defaultValue={name}
              required
              placeholder="np. adGen sp. z o.o."
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="companyAddress">Adres</Label>
            <Input
              id="companyAddress"
              name="companyAddress"
              defaultValue={address}
              placeholder="ul. Przykładowa 1, 00-001 Warszawa"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="companyAccount">Numer rachunku firmy (NRB)</Label>
            <Input
              id="companyAccount"
              name="companyAccount"
              defaultValue={account}
              inputMode="numeric"
              placeholder="26 cyfr, np. 61 1090 1014 0000 0712 1981 2874"
            />
            <p className="text-sm text-muted-foreground">
              Rachunek zleceniodawcy — 26 cyfr NRB, spacje i prefiks PL zostaną
              usunięte przy zapisie.
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
