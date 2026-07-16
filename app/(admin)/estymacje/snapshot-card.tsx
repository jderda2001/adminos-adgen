"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/date-picker";
import { StatusBadge } from "@/components/status-badge";
import { formatMoney, formatDate, dateToInput, todayUTC } from "@/lib/format";
import { setCashSnapshotAction, deleteCashSnapshotAction } from "./actions";

export interface SnapshotRow {
  id: string;
  dateIso: string;
  balanceGr: number;
  note: string | null;
}

export function SnapshotCard({
  snapshots,
  stale,
}: {
  snapshots: SnapshotRow[];
  stale: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(dateToInput(todayUTC()));
  const [balance, setBalance] = useState("");
  const [note, setNote] = useState("");
  const latest = snapshots[0];

  function save() {
    startTransition(async () => {
      const res = await setCashSnapshotAction({ date, balance, note });
      if (res.ok) {
        toast.success(res.message ?? "Zapisano");
        setBalance("");
        setNote("");
      } else toast.error(res.error);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteCashSnapshotAction(id);
      if (res.ok) toast.success(res.message ?? "Usunięto");
      else toast.error(res.error);
    });
  }

  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Wallet className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Stan kont (kotwica prognozy)</h3>
        </div>
        {latest && stale && <StatusBadge tone="amber">nieaktualny</StatusBadge>}
      </div>

      {latest ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Ostatni:{" "}
          <span className="font-semibold text-foreground tabular-nums">
            {formatMoney(latest.balanceGr)}
          </span>{" "}
          na dzień {formatDate(new Date(latest.dateIso))}
        </p>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Brak wpisu — podaj łączny stan wszystkich kont, aby prognozować gotówkę.
        </p>
      )}

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="snap-date">Data</Label>
          <DatePicker id="snap-date" value={date} onChange={setDate} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="snap-balance">Stan łączny (zł)</Label>
          <Input
            id="snap-balance"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            placeholder="np. 50 000,00"
          />
        </div>
        <Button onClick={save} disabled={pending || !balance.trim()}>
          {pending ? "Zapisywanie…" : "Zapisz stan"}
        </Button>
      </div>

      {snapshots.length > 0 && (
        <div className="mt-3 space-y-1 border-t pt-2">
          {snapshots.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground tabular-nums">
                {formatDate(new Date(s.dateIso))}
              </span>
              <span className="flex-1 text-right font-medium tabular-nums">
                {formatMoney(s.balanceGr)}
              </span>
              <button
                type="button"
                onClick={() => remove(s.id)}
                disabled={pending}
                aria-label="Usuń wpis"
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
