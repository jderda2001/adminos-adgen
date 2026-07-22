"use client";

// Dialog dodawania/edycji kampanii miesięcznej (marka × wertykal): wydatki
// netto + liczba leadów z Meta Ads Manager. CPL liczy się sam.

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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAmount, formatMonth } from "@/lib/format";
import { saveCampaignAction } from "./actions";

export interface BrandOption {
  id: string;
  name: string;
  active: boolean;
}

export interface CampaignFormData {
  id?: string;
  brandId: string;
  vertical: string;
  spendGr: number;
  leadsCount: number;
  note: string | null;
}

export function CampaignDialog({
  month,
  brands,
  verticals,
  campaign,
  trigger,
}: {
  month: string;
  brands: BrandOption[];
  verticals: string[];
  /** undefined = nowa kampania */
  campaign?: CampaignFormData;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [brandId, setBrandId] = useState("");
  const [vertical, setVertical] = useState("");
  const [spend, setSpend] = useState("");
  const [leads, setLeads] = useState("");
  const [note, setNote] = useState("");

  // marki do wyboru: aktywne + bieżąca (edycja kampanii nieaktywnej marki)
  const options = brands.filter((b) => b.active || b.id === campaign?.brandId);
  // wertykały: aktywne + bieżący (gdy edytujemy wpis z nieaktywnym/starym wertykałem)
  const verticalOptions =
    campaign && !verticals.includes(campaign.vertical)
      ? [campaign.vertical, ...verticals]
      : verticals;

  function handleOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setBrandId(campaign?.brandId ?? "");
      setVertical(campaign?.vertical ?? "");
      setSpend(campaign ? formatAmount(campaign.spendGr) : "");
      setLeads(campaign ? String(campaign.leadsCount) : "");
      setNote(campaign?.note ?? "");
    }
  }

  function submit() {
    startTransition(async () => {
      const res = await saveCampaignAction({
        id: campaign?.id,
        period: month,
        brandId,
        vertical,
        spend,
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
          <DialogTitle>{campaign ? "Edytuj kampanię" : "Nowa kampania"}</DialogTitle>
          <DialogDescription>
            Wyniki kampanii <span className="font-medium text-foreground capitalize">{formatMonth(month)}</span>{" "}
            z Meta Ads Manager — wydatki netto i liczba pozyskanych leadów. CPL liczy się automatycznie.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="campaign-brand">Marka *</Label>
              <Select value={brandId} onValueChange={setBrandId}>
                <SelectTrigger id="campaign-brand" className="w-full">
                  <SelectValue placeholder="Wybierz markę" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                      {!b.active ? " (nieaktywna)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign-vertical">Wertykal *</Label>
              <Select value={vertical} onValueChange={setVertical}>
                <SelectTrigger id="campaign-vertical" className="w-full">
                  <SelectValue placeholder="Wybierz" />
                </SelectTrigger>
                <SelectContent>
                  {verticalOptions.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="campaign-spend">Wydatki netto (zł) *</Label>
              <Input
                id="campaign-spend"
                inputMode="decimal"
                value={spend}
                onChange={(e) => setSpend(e.target.value)}
                placeholder="12 900,00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="campaign-leads">Pozyskane leady *</Label>
              <Input
                id="campaign-leads"
                inputMode="numeric"
                value={leads}
                onChange={(e) => setLeads(e.target.value)}
                placeholder="430"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="campaign-note">Notatka</Label>
            <Input
              id="campaign-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="opcjonalnie"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Anuluj
          </Button>
          <Button onClick={submit} disabled={pending || !brandId || !vertical}>
            {pending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
