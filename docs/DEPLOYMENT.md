# Wdrożenie — OVH + Tailscale

## Aktualne wdrożenie (live)

Adres: **https://adminos.tail394d08.ts.net** (tylko w tailnecie).

| Element | Wartość |
|---|---|
| Serwer | OVH VPS `51.210.177.152`, użytkownik `ubuntu`, Ubuntu 24.04 |
| Węzeł Tailscale | `adminos.tail394d08.ts.net` (osobny węzeł, IP 100.66.233.54) |
| Katalog aplikacji | `/opt/adgen-finanse` |
| Baza | `/opt/adgen-finanse/prisma/adgen.db` (SQLite) |
| Usługa aplikacji | `systemctl {status,restart} adgen-finanse` (nasłuch `127.0.0.1:3001`) |
| Drugi daemon Tailscale | `systemctl … tailscaled-adgen` (`--statedir=/var/lib/tailscale-adgen`, `--socket=/run/tailscale-adgen/tailscaled.sock`) |
| Wystawienie | `tailscale --socket=/run/tailscale-adgen/tailscaled.sock serve --https=443 http://127.0.0.1:3001` |
| Logowanie | `AUTH_DISABLED=1` w `.env` — bez haseł (dostęp tylko z tailnetu); usunięcie flagi + restart przywraca logowanie |

> **Rozdzielenie od businessbrain:** na tym VPS działa też druga aplikacja
> **businessbrain** (Docker: front `:3000`, API `:8000`, Postgres `:5432`) na
> OSOBNYM węźle Tailscale `businessbrain` (`:443`, `/` i `/api`). adGen ma
> **własny węzeł `adminos`** (drugi `tailscaled` w trybie userspace) i własny
> adres — projekty są w pełni rozdzielone. Nie ruszaj portu 3000 ani węzła
> businessbrain.
>
> Uwaga do drugiego węzła: `tailscaled` MUSI dostać `--statedir` (nie tylko
> `--state`), inaczej brak katalogu na certy TLS („no TailscaleVarRoot") i HTTPS
> nie wstanie.

Aktualizacja live: `cd /opt/adgen-finanse && ./deploy/update.sh`
(używa istniejącej usługi i portu z `.env`).

---

## Instrukcja generyczna (od zera)

Instrukcja wdrożenia adGen Finanse na serwerze OVH, z dostępem dla zespołu przez
sieć **Tailscale** (tailnet). Ruch po tailnecie jest szyfrowany (WireGuard), więc
aplikacji **nie wystawiamy do publicznego internetu** — logujecie się pod adresem
`https://<serwer>.<twoj-tailnet>.ts.net`.

Zakładam serwer z Ubuntu 22.04/24.04 (Debian analogicznie) i dostępem `sudo`.

---

## 1. Przygotowanie serwera

```bash
# Node.js 20 LTS + git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

node -v   # v20.x
npm -v

# Konto systemowe dla aplikacji (bez logowania powłoką)
sudo adduser --system --group --home /var/www/adgen-finanse adgen
```

## 2. Kod aplikacji

```bash
sudo mkdir -p /var/www/adgen-finanse
sudo chown -R adgen:adgen /var/www/adgen-finanse

# jako użytkownik adgen (lub sklonuj i nadaj chown -R adgen:adgen)
sudo -u adgen git clone <URL_REPOZYTORIUM> /var/www/adgen-finanse
cd /var/www/adgen-finanse
```

> Jeśli nie używacie repozytorium git, skopiuj katalog projektu na serwer
> (np. `rsync`), **z pominięciem** `node_modules/`, `.next/`, `prisma/dev.db`.

## 3. Konfiguracja `.env`

```bash
sudo -u adgen cp .env.production.example .env
sudo -u adgen nano .env
```

Ustaw:
- `DATABASE_URL="file:/var/www/adgen-finanse/prisma/adgen.db"` — ścieżka **bezwzględna**.
- `AUTH_SECURE_COOKIE=1` — bo łączymy się po HTTPS (Tailscale Serve, krok 6).
- `PORT=3000`
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` — dane pierwszego administratora
  (użyte jednorazowo w kroku 4; potem możesz je usunąć z `.env`).

## 4. Instalacja, baza, build

```bash
cd /var/www/adgen-finanse

sudo -u adgen npm ci                 # zależności (+ prisma generate w postinstall)
sudo -u adgen npx prisma db push     # utworzenie schematu w prisma/adgen.db
sudo -u adgen -E npm run db:bootstrap # kategorie kosztów + ustawienia + konto admina
sudo -u adgen npm run build          # produkcyjny build
```

`db:bootstrap` **nie wgrywa danych demo** — zakłada tylko domyślne kategorie
kosztów, ustawienia i Twoje konto admina. (Danych przykładowych z `npm run db:seed`
**nie uruchamiaj na produkcji** — to polecenie czyści bazę.)

## 5. Usługa systemd (autostart, restart po awarii)

```bash
sudo cp deploy/adgen-finanse.service /etc/systemd/system/
# sprawdź w pliku User/Group/WorkingDirectory oraz ścieżkę npm (which npm)
sudo systemctl daemon-reload
sudo systemctl enable --now adgen-finanse

systemctl status adgen-finanse       # powinno być "active (running)"
curl -sS http://127.0.0.1:3000/login -o /dev/null -w "%{http_code}\n"  # 200
```

Logi na żywo: `journalctl -u adgen-finanse -f`

Aplikacja nasłuchuje na `127.0.0.1:3000` (loopback) — na zewnątrz wystawia ją
dopiero Tailscale w następnym kroku.

## 6. Tailscale — dostęp dla zespołu (HTTPS)

```bash
# instalacja i podłączenie serwera do tailnetu
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

W panelu Tailscale (admin console → DNS) włącz **MagicDNS** oraz **HTTPS
Certificates**. Następnie wystaw aplikację po HTTPS:

```bash
sudo tailscale serve --bg 3000
# albo równoważnie:
# sudo tailscale serve --bg --https=443 http://127.0.0.1:3000
sudo tailscale serve status
```

Od teraz każdy w Waszym tailnecie otwiera:

```
https://<nazwa-serwera>.<twoj-tailnet>.ts.net
```

Certyfikat HTTPS jest wystawiany automatycznie przez Tailscale (stąd
`AUTH_SECURE_COOKIE=1`).

> Alternatywa bez HTTPS: pomiń `tailscale serve`, w `adgen-finanse.service` zmień
> nasłuch na `0.0.0.0`, ustaw `AUTH_SECURE_COOKIE=0` i łącz się pod
> `http://<tailscale-ip>:3000`. Wtedy koniecznie zablokuj port 3000 publicznie
> (krok 7).

## 7. Firewall (nie wystawiaj do internetu)

Przy `tailscale serve` + nasłuchu na `127.0.0.1` port 3000 i tak nie jest
dostępny publicznie. Dla pewności:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow in on tailscale0     # ruch z tailnetu
sudo ufw allow 22/tcp               # SSH (rozważ ograniczenie do tailnetu)
sudo ufw enable
```

Upewnij się też, że w panelu OVH (firewall sieciowy) port 3000 **nie** jest
otwarty na świat.

## 8. Aktualizacje

```bash
cd /var/www/adgen-finanse
sudo -u adgen ./deploy/update.sh
```

Skrypt: `git pull` → `npm ci` → `prisma db push` → `build` → restart usługi.
Baza (`prisma/adgen.db`) i `uploads/` pozostają nietknięte.

> **Dane osobowe poza repo:** auto-kategoryzacja wyciągów używa reguł
> „nazwisko → kategoria" z `config/rw-people.json`. Ten plik jest w `.gitignore`
> (repo jest publiczne), więc `git pull` go NIE przyniesie — musi być na serwerze
> osobno (skopiuj przez `scp`/`rsync`; wzór: `config/rw-people.example.json`).
> Bez niego wynagrodzenia trafią do „Inne" i trzeba je ręcznie poprawić w przeglądzie.

> `update.sh` woła `sudo systemctl restart adgen-finanse`. Aby użytkownik `adgen`
> mógł to zrobić bez hasła, dodaj regułę sudoers:
> `adgen ALL=(root) NOPASSWD: /usr/bin/systemctl restart adgen-finanse`
> (`sudo visudo -f /etc/sudoers.d/adgen`). Albo uruchamiaj `update.sh` przez sudo.

## 9. Kopie zapasowe

SQLite = jeden plik. Codzienny backup bazy i załączników (cron roota):

```bash
# /etc/cron.d/adgen-backup
0 2 * * * adgen sqlite3 /var/www/adgen-finanse/prisma/adgen.db ".backup '/var/backups/adgen/adgen-$(date +\%F).db'" && find /var/backups/adgen -name '*.db' -mtime +30 -delete
```

```bash
sudo mkdir -p /var/backups/adgen && sudo chown adgen:adgen /var/backups/adgen
sudo apt-get install -y sqlite3
```

Załączniki kosztów są w `uploads/` — dołącz je do backupu (np. `tar`/`rsync`
tego katalogu).

---

## Po wdrożeniu

1. Zaloguj się na `https://<serwer>.<tailnet>.ts.net` kontem z `ADMIN_EMAIL`.
2. **Zmień hasło administratora** i usuń `ADMIN_PASSWORD` z `.env`.
3. W **Ustawieniach** uzupełnij dane firmy i numer rachunku (do eksportu Elixir).
4. Zaproś zespół (moduł **Zespół** → „Zaproś pracownika"), ustaw stawki i założenia.
5. Wprowadź realnych klientów, przychody i koszty (lub poproś o import z CSV).

## Skalowanie do Postgresa (opcjonalnie, później)

Schemat jest neutralny (bez typów SQLite-only). Migracja:
1. `datasource db { provider = "postgresql" }` w `prisma/schema.prisma`.
2. `DATABASE_URL` na connection string Postgresa.
3. `npx prisma db push`, przeniesienie danych, `npm run build`, restart.

SQLite spokojnie obsłuży 5–15 użytkowników — Postgres rozważ dopiero przy
większym obciążeniu lub potrzebie replikacji.
