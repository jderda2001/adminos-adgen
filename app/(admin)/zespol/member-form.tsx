"use client";

// Dialogi: zaproszenie nowego pracownika (z hasłem tymczasowym) i edycja danych.

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ROLE_LABELS, ROLES } from "@/lib/types";
import { dateToInput, todayUTC } from "@/lib/format";
import { inviteMemberAction, updateMemberAction } from "./actions";
import type { MemberRow } from "./team-table";

export function InviteMemberDialog({
  trigger,
  onInvited,
}: {
  trigger: React.ReactNode;
  /** wywoływane po utworzeniu konta — pokazuje hasło tymczasowe (widoczne raz) */
  onInvited: (tempPassword: string, userName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    startTransition(async () => {
      const result = await inviteMemberAction(formData);
      if (result.ok) {
        toast.success("Konto zostało utworzone");
        setOpen(false);
        onInvited(result.tempPassword, name);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Zaproś pracownika</DialogTitle>
          <DialogDescription>
            Po utworzeniu konta zobaczysz wygenerowane hasło tymczasowe —
            przekaż je pracownikowi. Przy pierwszym logowaniu wymagana będzie
            zmiana hasła.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-name">Imię i nazwisko *</Label>
            <Input
              id="invite-name"
              name="name"
              required
              placeholder="np. Anna Kowalska"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="invite-email">E-mail *</Label>
              <Input
                id="invite-email"
                name="email"
                type="email"
                required
                placeholder="anna@adgen.pl"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Rola *</Label>
              <Select name="role" defaultValue="EMPLOYEE">
                <SelectTrigger id="invite-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="invite-rate">Stawka kosztowa (zł/h)</Label>
              <Input
                id="invite-rate"
                name="initialRate"
                inputMode="decimal"
                placeholder="120,00"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-rate-from">Stawka obowiązuje od</Label>
              <Input
                id="invite-rate-from"
                name="rateFrom"
                type="date"
                defaultValue={dateToInput(todayUTC())}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Stawka jest opcjonalna — możesz ją dodać lub zmienić później w
            historii stawek pracownika.
          </p>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Tworzenie…" : "Utwórz konto"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditMemberDialog({
  member,
  trigger,
}: {
  member: MemberRow;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateMemberAction(member.id, formData);
      if (result.ok) {
        toast.success(result.message);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edytuj pracownika</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Imię i nazwisko *</Label>
            <Input
              id="edit-name"
              name="name"
              required
              defaultValue={member.name}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="edit-email">E-mail *</Label>
              <Input
                id="edit-email"
                name="email"
                type="email"
                required
                defaultValue={member.email}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Rola *</Label>
              <Select name="role" defaultValue={member.role}>
                <SelectTrigger id="edit-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Anuluj
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Zapisywanie…" : "Zapisz"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
