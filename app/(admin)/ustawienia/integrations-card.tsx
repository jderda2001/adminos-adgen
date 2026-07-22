"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy, Link2, Link2Off } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/status-badge";
import { SettingsCard } from "./settings-card";
import {
  saveMetaAutosyncAction,
  saveMetaCredentialsAction,
  disconnectMetaAction,
} from "./actions";

const FLASH: Record<string, { ok: boolean; msg: string }> = {
  connected: { ok: true, msg: "Połączono z Meta 🎉" },
  odrzucono: { ok: false, msg: "Logowanie anulowane w Facebooku" },
  blad_state: { ok: false, msg: "Sesja logowania wygasła — spróbuj ponownie" },
  brak_app_id: { ok: false, msg: "Najpierw zapisz App ID i App Secret" },
  blad: { ok: false, msg: "Błąd połączenia z Meta" },
};

export function IntegrationsCard({
  connected,
  appId,
  hasSecret,
  baseUrl,
  callbackUrl,
  metaAutosyncEnabled,
  flash,
  flashMsg,
}: {
  connected: boolean;
  appId: string;
  hasSecret: boolean;
  baseUrl: string;
  callbackUrl: string;
  metaAutosyncEnabled: boolean;
  flash: string | null;
  flashMsg: string | null;
}) {
  const router = useRouter();
  const [appIdVal, setAppIdVal] = useState(appId);
  const [secretVal, setSecretVal] = useState("");
  const [baseVal, setBaseVal] = useState(baseUrl);
  const [autosync, setAutosync] = useState(metaAutosyncEnabled);
  const [copied, setCopied] = useState(false);
  const [savingCreds, startSaveCreds] = useTransition();
  const [savingSync, startSaveSync] = useTransition();
  const [disc, startDisc] = useTransition();

  // komunikat po powrocie z logowania Facebooka (?meta=…)
  useEffect(() => {
    if (!flash) return;
    const f = FLASH[flash] ?? { ok: false, msg: "Nieznany status logowania" };
    if (f.ok) toast.success(f.msg);
    else toast.error(flashMsg ? `${f.msg}: ${flashMsg}` : f.msg);
    router.replace("/ustawienia"); // wyczyść parametr, żeby nie powtarzać
  }, [flash, flashMsg, router]);

  function saveCreds(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("appId", appIdVal);
    fd.set("appSecret", secretVal);
    fd.set("baseUrl", baseVal);
    startSaveCreds(async () => {
      const r = await saveMetaCredentialsAction(fd);
      if (r.ok) {
        toast.success(r.message);
        setSecretVal("");
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function saveSync(next: boolean) {
    setAutosync(next);
    const fd = new FormData();
    fd.set("metaAutosyncEnabled", next ? "1" : "0");
    startSaveSync(async () => {
      const r = await saveMetaAutosyncAction(fd);
      if (r.ok) toast.success(r.message);
      else {
        toast.error(r.error);
        setAutosync(!next);
      }
    });
  }

  function disconnect() {
    startDisc(async () => {
      const r = await disconnectMetaAction();
      if (r.ok) {
        toast.success(r.message);
        router.refresh();
      } else toast.error(r.error);
    });
  }

  function copyCallback() {
    navigator.clipboard?.writeText(callbackUrl).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => toast.error("Nie udało się skopiować")
    );
  }

  const canConnect = appIdVal.trim() !== "" && (hasSecret || secretVal.trim() !== "");

  return (
    <SettingsCard
      title="Integracje — Meta Ads"
      description="Podłącz konto Meta, aby zaciągać wydatki i leady kampanii z całego portfolio do modułu Leady"
    >
      <div className="space-y-6">
        {/* Status połączenia */}
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Status</span>
            {connected ? (
              <StatusBadge tone="green" dot>
                połączono
              </StatusBadge>
            ) : (
              <StatusBadge tone="amber" dot>
                niepołączone (dane testowe)
              </StatusBadge>
            )}
          </div>
          {connected ? (
            <Button variant="outline" size="sm" onClick={disconnect} disabled={disc}>
              <Link2Off data-icon="inline-start" />
              {disc ? "Rozłączam…" : "Rozłącz"}
            </Button>
          ) : (
            <a
              href="/api/meta/oauth/start"
              className={buttonVariants({ size: "sm" })}
              aria-disabled={!canConnect}
              onClick={(e) => {
                if (!canConnect) {
                  e.preventDefault();
                  toast.error("Najpierw zapisz App ID i App Secret poniżej");
                }
              }}
              style={!canConnect ? { opacity: 0.5, pointerEvents: "auto" } : undefined}
            >
              <Link2 data-icon="inline-start" />
              Połącz z Facebookiem
            </a>
          )}
        </div>

        {/* Dane aplikacji Meta */}
        <form onSubmit={saveCreds} className="space-y-4 border-t pt-5">
          <div className="space-y-1">
            <Label htmlFor="appId">App ID aplikacji Meta</Label>
            <Input
              id="appId"
              value={appIdVal}
              onChange={(e) => setAppIdVal(e.target.value)}
              placeholder="np. 1234567890123456"
              inputMode="numeric"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="appSecret">App Secret</Label>
            <Input
              id="appSecret"
              type="password"
              value={secretVal}
              onChange={(e) => setSecretVal(e.target.value)}
              placeholder={hasSecret ? "•••••••• (zapisany — wpisz, aby zmienić)" : "wklej App Secret"}
              autoComplete="off"
            />
            <p className="text-sm text-muted-foreground">
              Znajdziesz je w panelu aplikacji Meta → Ustawienia → Podstawowe. Trzymane
              są na serwerze, nie w kodzie.
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="baseUrl">Adres aplikacji (HTTPS)</Label>
            <Input
              id="baseUrl"
              value={baseVal}
              onChange={(e) => setBaseVal(e.target.value)}
              placeholder="https://twoja-aplikacja.example.com"
            />
            <p className="text-sm text-muted-foreground">
              Adres, pod którym otwierasz tę aplikację. Zostaw puste, aby wykryć
              automatycznie.
            </p>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={savingCreds}>
              {savingCreds ? "Zapisywanie…" : "Zapisz dane aplikacji"}
            </Button>
          </div>
        </form>

        {/* Adres powrotny do wklejenia w Meta */}
        <div className="space-y-1 border-t pt-5">
          <Label>Adres powrotny (wklej w Meta)</Label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-2.5 py-1.5 text-xs">
              {callbackUrl}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copyCallback}>
              {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
              {copied ? "Skopiowano" : "Kopiuj"}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            W panelu Meta → Logowanie przez Facebooka → Ustawienia dodaj ten adres do
            „Prawidłowe identyfikatory URI przekierowania OAuth".
          </p>
        </div>

        {/* Autosync */}
        <div className="flex items-start justify-between gap-4 border-t pt-5">
          <div className="space-y-1">
            <Label htmlFor="metaAutosyncEnabled">Codzienna synchronizacja (automat)</Label>
            <p className="text-sm text-muted-foreground">
              Raz dziennie system sam pobiera kampanie za bieżący miesiąc. Ręczne wpisy
              pozostają nietknięte.
            </p>
          </div>
          <Switch
            id="metaAutosyncEnabled"
            checked={autosync}
            disabled={savingSync}
            onCheckedChange={saveSync}
            aria-label="Codzienna synchronizacja z Meta"
          />
        </div>
      </div>
    </SettingsCard>
  );
}
