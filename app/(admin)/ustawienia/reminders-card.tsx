"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingsCard } from "./settings-card";
import { saveReminderSettingsAction } from "./actions";

export function ReminderSettingsCard(props: {
  enabled: boolean;
  notifyMode: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpFrom: string;
  smtpPassSet: boolean;
  smsApiUrl: string;
  smsSender: string;
  smsApiKeySet: boolean;
  emailFooter: string;
}) {
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(props.enabled);
  const [notifyMode, setNotifyMode] = useState(props.notifyMode === "live" ? "live" : "off");
  const [smtpHost, setSmtpHost] = useState(props.smtpHost);
  const [smtpPort, setSmtpPort] = useState(props.smtpPort);
  const [smtpUser, setSmtpUser] = useState(props.smtpUser);
  const [smtpPass, setSmtpPass] = useState("");
  const [smtpFrom, setSmtpFrom] = useState(props.smtpFrom);
  const [smsApiUrl, setSmsApiUrl] = useState(props.smsApiUrl);
  const [smsApiKey, setSmsApiKey] = useState("");
  const [smsSender, setSmsSender] = useState(props.smsSender);
  const [emailFooter, setEmailFooter] = useState(props.emailFooter);

  function save() {
    startTransition(async () => {
      const r = await saveReminderSettingsAction({
        enabled,
        notifyMode: notifyMode as "off" | "live",
        smtpHost,
        smtpPort,
        smtpUser,
        smtpPass,
        smtpFrom,
        smsApiUrl,
        smsApiKey,
        smsSender,
        emailFooter,
      });
      if (r.ok) {
        toast.success(r.message);
        setSmtpPass("");
        setSmsApiKey("");
      } else toast.error(r.error);
    });
  }

  return (
    <SettingsCard
      title="Przypomnienia o płatnościach"
      description="Sekwencja SMS + e-mail wokół terminu płatności faktur (Wystawiona/Przeterminowana). Cron kolejkuje należne kroki, wysyłasz je ręcznie z osi czasu w Przychodach."
    >
      <div className="space-y-5">
        <label className="flex items-center justify-between gap-3">
          <span className="text-sm">
            Automatyczne kolejkowanie kroków (cron)
            <span className="block text-xs text-muted-foreground">
              Codzienne wystawianie należnego kroku na oś czasu. Wysyłka i tak jest ręczna.
            </span>
          </span>
          <Switch checked={enabled} onCheckedChange={setEnabled} disabled={pending} />
        </label>

        <div className="space-y-1">
          <Label htmlFor="notifyMode">Tryb wysyłki</Label>
          <Select value={notifyMode} onValueChange={setNotifyMode}>
            <SelectTrigger id="notifyMode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">Symulacja (nic nie wychodzi)</SelectItem>
              <SelectItem value="live">Na żywo (realna wysyłka)</SelectItem>
            </SelectContent>
          </Select>
          {notifyMode === "live" ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Uwaga: w trybie „na żywo" SMS-y i e-maile trafiają do klientów. Upewnij się, że dane
              SMTP/SMS są poprawne.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Bezpieczny domyślny tryb — „Wyślij" zapisuje krok jako symulację, nic nie wychodzi.
            </p>
          )}
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground">SMTP (e-mail)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="smtpHost">Host</Label>
              <Input id="smtpHost" value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="np. smtp.example.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpPort">Port</Label>
              <Input id="smtpPort" value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} inputMode="numeric" placeholder="587" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpUser">Użytkownik</Label>
              <Input id="smtpUser" value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} placeholder="login SMTP" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpPass">Hasło</Label>
              <Input id="smtpPass" type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} placeholder={props.smtpPassSet ? "•••• (bez zmian)" : "hasło SMTP"} />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="smtpFrom">Nadawca (From)</Label>
              <Input id="smtpFrom" value={smtpFrom} onChange={(e) => setSmtpFrom(e.target.value)} placeholder="adGen <biuro@adgen.pl>" />
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border p-3">
          <p className="text-xs font-medium text-muted-foreground">API SMS</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="smsApiUrl">Endpoint (URL POST)</Label>
              <Input id="smsApiUrl" value={smsApiUrl} onChange={(e) => setSmsApiUrl(e.target.value)} placeholder="https://api.dostawcy-sms.pl/send" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smsApiKey">Klucz API</Label>
              <Input id="smsApiKey" type="password" value={smsApiKey} onChange={(e) => setSmsApiKey(e.target.value)} placeholder={props.smsApiKeySet ? "•••• (bez zmian)" : "klucz API"} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smsSender">Nadawca SMS</Label>
              <Input id="smsSender" value={smsSender} onChange={(e) => setSmsSender(e.target.value)} placeholder="np. adGen" />
            </div>
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="emailFooter">Stopka e-maili</Label>
          <Textarea id="emailFooter" value={emailFooter} onChange={(e) => setEmailFooter(e.target.value)} rows={4} />
          <p className="text-xs text-muted-foreground">
            Doklejana pod treść e-maili przypomnień (m.in. informacja o 25% prowizji za polecenie).
          </p>
        </div>

        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? "Zapisywanie…" : "Zapisz"}
          </Button>
        </div>
      </div>
    </SettingsCard>
  );
}
