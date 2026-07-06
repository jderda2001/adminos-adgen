"use client";

// Panel szczegółów pracownika: dane konta, historia stawek kosztowych i akcje
// (Edytuj / Resetuj hasło / Aktywuj / Dezaktywuj). Otwierany klikiem w wiersz.

import { KeyRound, Pencil, UserCheck, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DetailSheet, DetailRow } from "@/components/detail-sheet";
import { StatusBadge } from "@/components/status-badge";
import { ROLE_LABELS, type Role } from "@/lib/types";
import { formatMoney } from "@/lib/format";
import { EditMemberDialog } from "./member-form";
import { RatesSection } from "./rates-section";
import type { MemberRow } from "./team-table";

export function MemberDetailSheet({
  member,
  open,
  onOpenChange,
  isSelf,
  onReset,
  onDeactivate,
  onActivate,
}: {
  member: MemberRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSelf: boolean;
  onReset: (member: MemberRow) => void;
  onDeactivate: (member: MemberRow) => void;
  onActivate: (member: MemberRow) => void;
}) {
  if (!member) return null;

  return (
    <DetailSheet
      open={open}
      onOpenChange={onOpenChange}
      title={member.name}
      description={member.email}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <EditMemberDialog
            member={member}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="size-4" /> Edytuj
              </Button>
            }
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => onReset(member)}
          >
            <KeyRound className="size-4" /> Resetuj hasło
          </Button>
          {member.active ? (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={isSelf}
              onClick={() => onDeactivate(member)}
            >
              <UserX className="size-4" /> Dezaktywuj
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onActivate(member)}
            >
              <UserCheck className="size-4" /> Aktywuj
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Konto
          </h3>
          <DetailRow label="Rola">
            <StatusBadge tone={member.role === "ADMIN" ? "indigo" : "neutral"}>
              {ROLE_LABELS[member.role as Role] ?? member.role}
            </StatusBadge>
          </DetailRow>
          <DetailRow label="Status">
            <StatusBadge tone={member.active ? "green" : "neutral"}>
              {member.active ? "Aktywny" : "Nieaktywny"}
            </StatusBadge>
          </DetailRow>
          <DetailRow label="Stawka kosztowa">
            {member.currentRateGr > 0
              ? `${formatMoney(member.currentRateGr)}/h`
              : "—"}
          </DetailRow>
        </section>

        <section>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Historia stawek
          </h3>
          <RatesSection member={member} />
        </section>
      </div>
    </DetailSheet>
  );
}
