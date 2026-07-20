"use client";

// „Dostawy vs kontrakt" — widok główny to KAFELKI nisz (wertykałów) z pulą:
// ile leadów marka wygenerowała (Meta) → ile przypisaliśmy klientom → ile leży
// nieprzypisanych. Kliknięcie kafelka wysuwa panel z klientami: kontrakt (z
// Przychodów), inline-edytowalne „Dowiezione" (przypisujecie ręcznie), bilans
// (dług/nadwyżka narastająco) i przycisk „paczka dostarczona" (domyka wiersz).

import { useState, useTransition } from "react";
import { Check, PackageCheck, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { DetailSheet } from "@/components/detail-sheet";
import { formatMoney, pluralPl } from "@/lib/format";
import { DeliveryDialog, type ClientOption } from "./delivery-dialog";
import { setDeliveredAction } from "./actions";
import type { BrandOption } from "./campaign-dialog";

export interface FulfillmentRow {
  clientId: string;
  clientName: string;
  vertical: string;
  owed: number; // zobowiązanie na ten miesiąc (kontrakt + dług z poprzednich)
  delivered: number;
  balance: number; // >0 dług, <0 nadwyżka, 0 rozliczone
  costGr: number; // dowiezione × CPL wertykalu
}

export interface VerticalSection {
  vertical: string;
  cplGr: number | null;
  generated: number; // leady wygenerowane w Mecie w tym miesiącu (Σ kampanii)
  assigned: number; // Σ dowiezionych klientom w tej niszy
  unassigned: number; // generated − assigned (leżące leady)
  rows: FulfillmentRow[];
}

function BalanceBadge({ balance }: { balance: number }) {
  if (balance === 0) return <StatusBadge tone="green" dot>rozliczone</StatusBadge>;
  if (balance > 0) return <StatusBadge tone="amber">−{balance} do dowiezienia</StatusBadge>;
  return <StatusBadge tone="blue">+{-balance} nadwyżka</StatusBadge>;
}

function UnassignedBadge({ value }: { value: number }) {
  if (value > 0) return <StatusBadge tone="blue">nieprzypisane {value}</StatusBadge>;
  if (value < 0) return <StatusBadge tone="neutral">z zapasu {-value}</StatusBadge>;
  return <StatusBadge tone="neutral">rozdane</StatusBadge>;
}

// Blok klienta w panelu niszy: inline-edytowalne „Dowiezione" + „paczka dostarczona".
function ClientBlock({ month, row }: { month: string; row: FulfillmentRow }) {
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(row.delivered));

  function commit(value: string) {
    startTransition(async () => {
      const res = await setDeliveredAction({
        period: month,
        clientId: row.clientId,
        vertical: row.vertical,
        leads: value,
      });
      if (res.ok) {
        toast.success(res.message ?? "Zapisano");
        setEditing(false);
      } else {
        toast.error(res.error);
      }
    });
  }

  function saveEdit() {
    const next = draft.trim();
    if (next === "" || next === String(row.delivered)) {
      setEditing(false);
      setDraft(String(row.delivered));
      return;
    }
    commit(next);
  }

  return (
    <div className="rounded-lg border px-3 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{row.clientName}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          kontrakt {row.owed} · koszt {formatMoney(row.costGr)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">dowiezione</span>
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <Input
              autoFocus
              inputMode="numeric"
              value={draft}
              disabled={pending}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEdit();
                } else if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(String(row.delivered));
                }
              }}
              className="h-7 w-16 text-right tabular-nums"
            />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={saveEdit}
              disabled={pending}
              aria-label="Zapisz dowiezione"
            >
              <Check />
            </Button>
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(String(row.delivered));
              setEditing(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2 py-1 text-sm tabular-nums transition-colors hover:bg-muted disabled:opacity-50"
          >
            {row.delivered}
            <Pencil className="size-3 text-muted-foreground" />
          </button>
        )}
        <BalanceBadge balance={row.balance} />
        {row.balance > 0 && (
          <Button
            size="xs"
            variant="ghost"
            className="ml-auto text-primary"
            disabled={pending}
            onClick={() => commit(String(row.owed))}
            title="Ustaw dowiezione = całe zobowiązanie (kontrakt + dług)"
          >
            <PackageCheck data-icon="inline-start" /> paczka dostarczona
          </Button>
        )}
      </div>
    </div>
  );
}

function PoolStat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2.5 text-center">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{children}</div>
    </div>
  );
}

export function FulfillmentCard({
  month,
  sections,
  brands,
  clients,
  verticals,
  verticalsWithCampaign,
}: {
  month: string;
  sections: VerticalSection[];
  brands: BrandOption[];
  clients: ClientOption[];
  verticals: string[];
  verticalsWithCampaign: string[];
}) {
  const [openVertical, setOpenVertical] = useState<string | null>(null);
  const active = sections.find((s) => s.vertical === openVertical) ?? null;
  const unassignedClass =
    active && active.unassigned > 0
      ? "text-blue-600 dark:text-blue-400"
      : active && active.unassigned < 0
        ? "text-muted-foreground"
        : "";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Dostawy vs kontrakt</h2>
          <p className="text-xs text-muted-foreground">
            Kafelki nisz: wygenerowane (Meta) → przypisane → nieprzypisane. Kliknij niszę,
            aby zobaczyć klientów i wpisać „dowiezione".
          </p>
        </div>
        <DeliveryDialog
          month={month}
          brands={brands}
          clients={clients}
          verticals={verticals}
          verticalsWithCampaign={verticalsWithCampaign}
          trigger={
            <Button size="sm" className="shrink-0">
              <Plus data-icon="inline-start" /> Dodaj dostawę
            </Button>
          }
        />
      </div>

      {sections.length === 0 ? (
        <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
          <EmptyState
            title="Brak kontraktów i kampanii w tym miesiącu"
            description={'Dodaj klientom leadowym fakturę „PAKIETY LEADÓW” w Przychodach (kontrakt) albo zaciągnij kampanie z Mety — nisze pojawią się tu automatycznie.'}
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {sections.map((sec) => {
            const openDebt = sec.rows.reduce((n, r) => n + Math.max(0, r.balance), 0);
            return (
              <button
                key={sec.vertical}
                type="button"
                onClick={() => setOpenVertical(sec.vertical)}
                className="rounded-xl border bg-card p-4 text-left shadow-[var(--shadow-card)] transition-colors hover:border-primary/40 hover:bg-muted/30"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{sec.vertical}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    CPL {sec.cplGr !== null ? formatMoney(sec.cplGr) : "—"}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    wygen.{" "}
                    <span className="font-medium text-foreground tabular-nums">{sec.generated}</span>
                  </span>
                  <span>
                    przyp.{" "}
                    <span className="font-medium text-foreground tabular-nums">{sec.assigned}</span>
                  </span>
                  <UnassignedBadge value={sec.unassigned} />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2 text-xs">
                  <span className="text-muted-foreground">
                    {sec.rows.length}{" "}
                    {pluralPl(sec.rows.length, "klient", "klienci", "klientów")}
                  </span>
                  {openDebt > 0 ? (
                    <StatusBadge tone="amber">−{openDebt} do dowiezienia</StatusBadge>
                  ) : sec.rows.length > 0 ? (
                    <StatusBadge tone="green" dot>
                      rozliczone
                    </StatusBadge>
                  ) : (
                    <span className="text-muted-foreground">brak przypisań</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <DetailSheet
        open={active !== null}
        onOpenChange={(o) => !o && setOpenVertical(null)}
        title={active ? active.vertical : "Nisza"}
        description={
          active
            ? `CPL ${active.cplGr !== null ? formatMoney(active.cplGr) : "—"} · koszt leadów ${formatMoney(
                active.rows.reduce((n, r) => n + r.costGr, 0)
              )}`
            : undefined
        }
        footer={
          active ? (
            <DeliveryDialog
              month={month}
              brands={brands}
              clients={clients}
              verticals={verticals}
              verticalsWithCampaign={verticalsWithCampaign}
              trigger={
                <Button variant="outline" size="sm" className="w-full">
                  <Plus data-icon="inline-start" /> Dodaj dostawę
                </Button>
              }
            />
          ) : undefined
        }
      >
        {active && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <PoolStat label="wygenerowane">{active.generated}</PoolStat>
              <PoolStat label="przypisane">{active.assigned}</PoolStat>
              <PoolStat label="nieprzypisane">
                <span className={unassignedClass}>{active.unassigned}</span>
              </PoolStat>
            </div>

            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Klienci ({active.rows.length})
              </div>
              {active.rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Brak przypisań —{" "}
                  {active.generated > 0
                    ? `wszystkie ${active.generated} leadów tej niszy leży nieprzypisane.`
                    : "brak kontraktów i leadów w tym miesiącu."}
                </p>
              ) : (
                <div className="space-y-2">
                  {active.rows.map((r) => (
                    <ClientBlock key={r.clientId} month={month} row={r} />
                  ))}
                </div>
              )}
            </div>

            <p className="text-[11px] leading-snug text-muted-foreground">
              „Nieprzypisane" = wygenerowane w niszy − przypisane klientom. Liczbę
              „dowiezione" wpisujesz ręcznie (klik w liczbę); „paczka dostarczona"
              ustawia ją na całe zobowiązanie wiersza.
            </p>
          </div>
        )}
      </DetailSheet>
    </div>
  );
}
