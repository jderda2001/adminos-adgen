"use client";

// Dialog dodawania/edycji dostawy leadów do klienta. Marka opcjonalna —
// „Mix marek" rozlicza po średniej ważonej CPL wertykalu. Klienci na
// paczkach leadów (PAKIETY_LEADOW) na górze listy.

import { useState, useTransition, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LEAD_CATEGORIES } from "@/lib/types";
import { formatMonth } from "@/lib/format";
import { saveDeliveryAction } from "./actions";
import type { BrandOption } from "./campaign-dialog";

const MIX_VALUE = "__mix__";

export interface ClientOption {
  id: string;
  name: string;
  isLeadClient: boolean; // billingModel === PAKIETY_LEADOW
}

export interface DeliveryFormData {
  id?: string;
  clientId: string;
  vertical: string;
  brandId: string | null;
  leadsCount: number;
  note: string | null;
}

export function DeliveryDialog({
  month,
  brands,
  clients,
  verticalsWithCampaign,
  delivery,
  trigger,
}: {
  month: string;
  brands: BrandOption[];
  clients: ClientOption[];
  verticalsWithCampaign: string[];
  /** undefined = nowa dostawa */
  delivery?: DeliveryFormData;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [clientId, setClientId] = useState("");
  const [vertical, setVertical] = useState("");
  const [brandSel, setBrandSel] = useState(MIX_VALUE);
  const [leads, setLeads] = useState("");
  const [note, setNote] = useState("");

  const leadClients = clients.filter((c) => c.isLeadClient);
  const otherClients = clients.filter((c) => !c.isLeadClient);
  const brandOptions = brands.filter((b) => b.active || b.id === delivery?.brandId);

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setClientId(delivery?.clientId ?? "");
      setVertical(delivery?.vertical ?? "");
      setBrandSel(delivery?.brandId ?? MIX_VALUE);
      setLeads(delivery ? String(delivery.leadsCount) : "");
      setNote(delivery?.note ?? "");
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await saveDeliveryAction({
        id: delivery?.id,
        period: month,
        clientId,
        vertical,
        brandId: brandSel === MIX_VALUE ? "" : brandSel,
        leads,
        note,
      });
      if (res.ok) {
        toast.success(res.message ?? "Zapisano");
        setOpen(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{delivery ? "Edytuj dostawę" : "Nowa dostawa leadów"}</DialogTitle>
          <DialogDescription>
            Leady dostarczone klientowi w miesiącu{" "}
            <span className="font-medium text-foreground capitalize">{formatMonth(month)}</span>.
            Koszt = leady × CPL kampanii (marki lub średniej wertykalu).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="delivery-client">Klient *</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="delivery-client" className="w-full">
                <SelectValue placeholder="Wybierz klienta" />
              </SelectTrigger>
              <SelectContent>
                {leadClients.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Paczki leadów</SelectLabel>
                    {leadClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {otherClients.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Pozostali klienci</SelectLabel>
                    {otherClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="delivery-vertical">Wertykal *</Label>
              <Select value={vertical} onValueChange={setVertical}>
                <SelectTrigger id="delivery-vertical" className="w-full">
                  <SelectValue placeholder="Wybierz" />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="delivery-brand">Marka (źródło leadów)</Label>
              <Select value={brandSel} onValueChange={setBrandSel}>
                <SelectTrigger id="delivery-brand" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MIX_VALUE}>Mix (średnia wertykalu)</SelectItem>
                  {brandOptions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {!b.active ? " (nieaktywna)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {vertical && !verticalsWithCampaign.includes(vertical) && (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
              Brak kampanii dla wertykalu „{vertical}" w tym miesiącu — koszt
              leadów wyniesie <span className="font-semibold">0 zł</span> (źródło
              „brak kampanii"). Dodaj najpierw kampanię, aby policzyć CPL.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="delivery-leads">Liczba leadów *</Label>
              <Input
                id="delivery-leads"
                inputMode="numeric"
                value={leads}
                onChange={(e) => setLeads(e.target.value)}
                placeholder="400"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delivery-note">Notatka</Label>
              <Input
                id="delivery-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="opcjonalnie"
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={pending || !clientId || !vertical}>
            {pending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
