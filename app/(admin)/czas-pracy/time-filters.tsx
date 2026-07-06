"use client";

// Filtry osoby i klienta (parametry URL ?osoba= i ?klient=) + eksport CSV
// z zachowaniem bieżących filtrów.

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface FilterOption {
  id: string;
  name: string;
}

export function TimeFilters({
  users,
  clients,
}: {
  users: FilterOption[];
  clients: FilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const osoba = searchParams.get("osoba") ?? "all";
  const klient = searchParams.get("klient") ?? "all";

  function update(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") next.delete(key);
    else next.set(key, value);
    startTransition(() => {
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  }

  const exportHref = `/api/eksport/czas-pracy?${searchParams.toString()}`;

  return (
    <>
      <Select value={osoba} onValueChange={(v) => update("osoba", v)}>
        <SelectTrigger className="w-44" size="sm" aria-label="Osoba">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Wszystkie osoby</SelectItem>
          {users.map((u) => (
            <SelectItem key={u.id} value={u.id}>
              {u.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={klient} onValueChange={(v) => update("klient", v)}>
        <SelectTrigger className="w-44" size="sm" aria-label="Klient">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Wszyscy klienci</SelectItem>
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button asChild variant="outline" size="sm" className="ml-auto">
        <a href={exportHref} download>
          <Download className="size-3.5" /> Eksport CSV
        </a>
      </Button>
    </>
  );
}
