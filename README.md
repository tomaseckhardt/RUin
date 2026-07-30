# RUin

Webová RSVP aplikace pro domlouvání akcí ve skupině přátel.

Frontend běží jako statická aplikace (React + Vite), data a logika jsou v Supabase (Postgres, RPC funkce, RLS, Realtime).

## Obsah

- [Co aplikace umí](#co-aplikace-umi)
- [Technologický stack](#technologicky-stack)
- [Struktura repozitáře](#struktura-repozitare)
- [Požadavky](#pozadavky)
- [Rychlý start lokálně](#rychly-start-lokalne)
- [Konfigurace prostředí](#konfigurace-prostredi)
- [Supabase setup (SQL)](#supabase-setup-sql)
- [NPM skripty](#npm-skripty)
- [Nasazení na GitHub Pages](#nasazeni-na-github-pages)
- [Jak funguje routing na Pages](#jak-funguje-routing-na-pages)
- [Push notifikace a service worker](#push-notifikace-a-service-worker)
  - [Automatické připomínky před akcí](#automaticke-pripominky-pred-akci-den-predem--hodinu-predem)
  - [Automatický úklid expirovaných akcí](#automaticky-uklid-expirovanych-akci-fotky-ze-storage)
- [Pravidla pro contributory](#pravidla-pro-contributory)
- [Community standards](#community-standards)
- [Troubleshooting](#troubleshooting)

## Co aplikace umí

- vytvořit akci (název, místo, termín, popis), nebo ji nejdřív vydiskutovat přes anketu na termín/místo — anketa má vlastní veřejný i tvůrčí odkaz a po vyhodnocení rovnou založí ostrou akci
- sbírat odpovědi RSVP (dorazím / omluvenka), volitelně s telefonním číslem (dle nastavení akce)
- check-in na místě ("📍 Dorazil/a jsem")
- moderovat účastníky a omluvenky v režimu organizátora
- chat k dané akci s emoji reakcemi na zprávy
- pings/šťouchnutí účastníků (stejnou osobu lze šťouchnout znovu vždy až po 10 minutách)
- seznamy "kdo co nese" a spolujízda
- itinerář večera (vícero zastávek, včetně afterparty)
- album fotek z akce s rozklikávacím náhledem (šipky mezi fotkami) a hromadným stažením fotek ostatních (jedním klikem jako ZIP, bez těch, které nahrál přihlášený uživatel sám)
- předpověď počasí pro místo a čas akce
- přidání do kalendáře (.ics soubor) a na plochu telefonu (PWA)
- sdílení pozvánky (odkaz, QR kód, QR plakátek ke stažení)
- push připomínky den a hodinu předem akcí

## Technologický stack

- Frontend: React 19, Vite 8, Tailwind CSS 4, React Router
- Backend: Supabase Postgres + RPC funkce + RLS + Realtime
- Klientské balení fotek do ZIP pro hromadné stažení: `jszip`
- Testy: Jest + Testing Library (`client/src/**/*.test.js`), `jest-axe` pro a11y assertions v testech, Puppeteer + `axe-puppeteer` pro `npm run audit:a11y` proti buildu
- Deploy: GitHub Actions -> GitHub Pages

## Struktura repozitáře

- `client/` - frontend aplikace ve Vite
  - `src/pages/` - hlavní obrazovky (vytvoření akce, RSVP detail, správa akce, vytvoření/detail ankety)
  - `src/components/` - znovupoužitelné UI komponenty
  - `src/lib/` - API vrstva, Supabase klient, helpery
  - `src/test/` - sdílené testovací helpery a Jest setup
  - `public/sw.js` - service worker (PWA/push)
- `supabase/sql/all-phases.sql` - celé databázové schéma, jediný SQL soubor
- `supabase/functions/` - Edge Functions (push připomínky, úklid expirovaných akcí)
- `scripts/audit-a11y.mjs` - a11y audit postaveného buildu (Puppeteer + axe-core)
- `.github/workflows/deploy-pages.yml` - CI/CD workflow pro GitHub Pages

## Požadavky

- Node.js 22+ (doporučeno)
- npm 10+
- Supabase projekt s právy pro vytvoření schématu, funkcí a policies

## Rychlý start lokálně

Z kořene repozitáře:

```bash
npm install
npm run dev
```

Kořenový `dev` skript spouští klienta z adresáře `client`.

## Konfigurace prostředí

Aplikace vyžaduje Supabase URL + veřejný klíč.

Vytvoř soubor `client/.env.local`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Poznámka:

- místo `VITE_SUPABASE_ANON_KEY` lze použít i `VITE_SUPABASE_PUBLISHABLE_KEY`
- bez těchto hodnot aplikace spadne hned při startu (záměrně, kvůli jasné chybě konfigurace)

## Supabase setup (SQL)

Celé databázové schéma žije v jednom souboru:

```sql
-- spusť celý obsah souboru v Supabase SQL Editoru
supabase/sql/all-phases.sql
```

Žádné samostatné "fáze" k ručnímu skládání - `all-phases.sql` je jediný zdroj pravdy a při každé další změně schématu se upravuje přímo on (ne nový soubor vedle). Je napsaný idempotentně (`create table if not exists`, `create or replace function`, `drop policy/trigger if exists` před každým `create`, `on conflict do nothing` u jediného top-level insertu), takže ho lze bezpečně spustit znovu celý i na projektu, který už část schématu má - Postgres jen přeskočí nebo nahradí to, co už existuje.

Co všechno `all-phases.sql` obsahuje:

- Základní schéma: `events`, `attendees`, `attendee_pings`, `event_chat_messages`, RLS na klíčových tabulkách, RPC funkce pro create/get event, submit RSVP, ping, moderaci a mazání.
- Lokální datum/čas bez timezone posunů.
- Realtime refresh payloadu (`event_realtime_ticks` + triggery) při změně účastníků/šťouchnutí.
- Volitelný sběr telefonu (`events.require_phone`, `attendees.phone`) s normalizací a unikátním indexem proti duplicitě čísla v rámci akce.
- Organizátorská editace detailů akce (název, místo, datum/čas).
- Web Push připomínky (`push_subscriptions`, `event_reminders_sent`, RPC pro klienta i pro Edge Function) - vyžaduje ještě nasazení Edge Function a scheduled joby, viz [Push notifikace a service worker](#push-notifikace-a-service-worker).
- Komunitní prvky: check-in, emoji reakce na chat, seznamy "kdo co nese" / spolujízda, vícero zastávek za večer, ankety na termín/místo před založením akce (s vlastním veřejným i tvůrčím odkazem), fotky z akce (Storage bucket `event-photos`).
- Case-insensitive hlasování v anketách.
- Šťouchnutí s opakovatelným 10minutovým cooldownem místo "jednou navždy" (atomický `on conflict ... do update ... where`), s RLS na `attendee_pings`.
- Bezpečnostní hardening: `_random_token` přes `pgcrypto`/`gen_random_bytes()` místo nekryptografického `random()` (token je jediné oprávnění k `update_event`/`delete_event`/`delete_attendee`/`moderate_attendee`); `get_event_payload` vrací telefonní čísla jen s platným `p_organizer_token`; opravená race podmínka v `moderate_attendee`; srozumitelná hláška místo syrové Postgres chyby při konfliktu telefonního čísla. Záměrně neřeší: `organizer_token` zůstává čitelný (ne hash), protože appka přes PIN umí "obnovit" zapomenutý manage odkaz a to s jednosměrným hashem nejde bez přestavby celého recovery flow.
- Mazání fotek ze Storage při zániku akce (dřív zůstávaly navždy ležet bez reference) - ruční mazání jde přes klientské Storage API, automatické po 7 dnech přes `get_expired_event_ids()` a Edge Function `cleanup-expired-events` (viz [Automatický úklid expirovaných akcí](#automaticky-uklid-expirovanych-akci-fotky-ze-storage)) - a vlastní životní cyklus anket (nefinalizovaná zanikne 14 dní od vytvoření, finalizovaná automaticky spolu s akcí, co z ní vznikla).
- Blokace přihlášení řidiče na vlastní nabídku odvozu + možnost odebrat konkrétního spolujezdce z vlastní nabídky.

**Důležité:** klient posílá do `get_event_payload` parametr `p_organizer_token` a do `remove_signup_claim`/`claim_signup_item` odpovídající kontroly (viz `client/src/lib/api.js`). Pokud `all-phases.sql` neběží na stejném Supabase projektu, jako na který ukazuje `.env.local`, appka přestane fungovat s chybou `Could not find the function ... in the schema cache` (PostgREST nenajde odpovídající signaturu funkce) - klient a databázové schéma musí být vždycky na stejné verzi.

Doporučení:

- spouštěj v Supabase SQL Editoru na stejném projektu, který používáš v `.env.local`
- po každém spuštění otestuj vytvoření akce, RSVP i detail akce

## NPM skripty

Kořen repozitáře (`package.json`):

- `npm run dev` - vývojový server klienta
- `npm run build` - produkční build klienta
- `npm run test` - spustí testy klienta (`npm --prefix client run test`)
- `npm run audit:a11y` - build + a11y audit skript
- `npm run install:all` / `npm run postinstall` - doinstaluje závislosti v `client/` (spouští se automaticky po `npm install` v kořeni)

Klient (`client/package.json`):

- `npm --prefix client run dev`
- `npm --prefix client run build`
- `npm --prefix client run preview`
- `npm --prefix client run lint`
- `npm --prefix client run test` - Jest (jednotkové + a11y testy, `*.test.js`)
- `npm --prefix client run test:a11y` - jen testy odpovídající vzoru `a11y`

## Nasazení na GitHub Pages

Repo je připravené na automatický deploy přes workflow `.github/workflows/deploy-pages.yml`.

### 1. Nastav repository variables

V GitHub repozitáři otevři:

`Settings -> Secrets and variables -> Actions -> Variables`

a přidej:

- `VITE_SUPABASE_URL` = URL tvého Supabase projektu
- `VITE_SUPABASE_ANON_KEY` = anon/publishable key

### 2. Zapni GitHub Pages přes Actions

V GitHubu:

`Settings -> Pages -> Source: GitHub Actions`

### 3. Push do větve main

Workflow je nastavený na:

- automatické spuštění při push do `main`
- ruční spuštění přes `workflow_dispatch`

### 4. Ověř výsledek

Po doběhnutí workflow najdeš URL v:

- Actions (job Deploy to GitHub Pages)
- nebo Settings -> Pages

## Jak funguje routing na Pages

Aplikace používá `HashRouter` (`/#/`), což je správně pro GitHub Pages bez server-side fallbacku. Díky tomu fungují i přímé odkazy na podstránky.

## Push notifikace a service worker

- service worker je v `client/public/sw.js`
- klient registruje push SW při běhu aplikace
- dispatch logika je v Supabase Edge Functions (`supabase/functions/`)

Pokud push notifikace nechodí, nejčastěji chybí správná konfigurace v Supabase nebo oprávnění notifikací v prohlížeči.

### Automatické připomínky před akcí (den předem / hodinu předem)

Účastník si po RSVP může v appce zapnout tlačítko "🔔 Připomenout den a hodinu předem" — to zaregistruje Web Push subscription k dané akci. Skutečné odeslání notifikace zajišťuje scheduled Edge Function `send-event-reminders`, kterou je potřeba jednorázově nastavit:

**1. Vygeneruj VAPID klíče** (jen jednou za projekt):

```bash
npx web-push generate-vapid-keys
```

**2. Nastav `client/.env.local`** (veřejný klíč, bezpečné mít na frontendu):

```env
VITE_VAPID_PUBLIC_KEY=tvuj-vygenerovany-public-key
```

Stejnou hodnotu přidej i jako repository variable `VITE_VAPID_PUBLIC_KEY` pro GitHub Pages build (viz [Nasazení na GitHub Pages](#nasazeni-na-github-pages)).

**3. Ověř, že máš puštěný `supabase/sql/all-phases.sql`** v Supabase SQL Editoru (obsahuje i push reminders schéma).

**4. Nastav secrets a nasaď Edge Function:**

```bash
supabase secrets set VAPID_PUBLIC_KEY=tvuj-public-key
supabase secrets set VAPID_PRIVATE_KEY=tvuj-privatni-key
supabase secrets set VAPID_SUBJECT=mailto:tvuj@email.cz
supabase functions deploy send-event-reminders --no-verify-jwt
```

**5. Naplánuj pravidelné spouštění** (např. každých 15-30 minut), ať se stihne poslat "den předem" i "hodinu předem" upozornění včas. Funkce běží s `--no-verify-jwt`, takže sama vyžaduje hlavičku `Authorization: Bearer <service-role-key>` - bez ní vrátí 401 (viz komentář v `index.ts`). Přes Supabase dashboard (`Edge Functions -> send-event-reminders -> Cron Jobs`) je potřeba při nastavení schedule (např. `*/15 * * * *`) tuhle hlavičku ručně přidat do "HTTP Headers" sekce cron jobu.

Alternativa přes SQL (pokud má projekt zapnuté `pg_cron` + `pg_net` rozšíření v `Database -> Extensions`) - hlavičku už obsahuje:

```sql
select cron.schedule(
  'send-event-reminders',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/send-event-reminders',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
  );
  $$
);
```

Bez kroků 3-5 se tlačítko připomínky v appce zobrazí a subscription se uloží, ale žádná notifikace nikdy nepřijde — dokud Edge Function neběží na scheduleru, nemá kdo `get_pending_event_reminders()` vyzvednout a poslat.

### Automatický úklid expirovaných akcí (fotky ze Storage)

Akce, kterým je 7+ dní po termínu, se mažou automaticky - ale samotné soubory v `event-photos` Storage bucketu nejde smazat přímo z SQL (tenhle Supabase projekt to odmítá hláškou `"Direct deletion from storage tables is not allowed. Use the Storage API instead."`). Úklid fotek proto zajišťuje samostatná scheduled Edge Function přes Storage Admin API:

**1. Nasaď Edge Function:**

```bash
supabase functions deploy cleanup-expired-events --no-verify-jwt
```

**2. Naplánuj pravidelné spouštění** (denně bohatě stačí, expirace není časově kritická). Funkce vyžaduje stejnou hlavičku `Authorization: Bearer <service-role-key>` jako `send-event-reminders` výše. Přes Supabase dashboard (`Edge Functions -> cleanup-expired-events -> Cron Jobs`, schedule např. `0 3 * * *`) ji přidej ručně do "HTTP Headers" sekce.

Alternativa přes SQL (`pg_cron` + `pg_net`) - hlavičku už obsahuje:

```sql
select cron.schedule(
  'cleanup-expired-events',
  '0 3 * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/cleanup-expired-events',
    headers := jsonb_build_object('Authorization', 'Bearer <service-role-key>')
  );
  $$
);
```

Bez tohohle kroku se expirované akce (a jejich DB řádky) po 7 dnech pořád smažou normálně - jen jejich fotky zůstanou ležet ve Storage bez reference. Ruční mazání (organizátor smaže akci/fotku z appky) funguje bez závislosti na téhle Edge Function - to jde přes klientské Storage API rovnou (`client/src/lib/supabase.js`).

## Pravidla pro contributory

Pro externí contributory platí jednoduché pravidlo:

- nepushovat přímo do `main`
- vždy vytvořit vlastní branch
- změny posílat přes Pull Request do `main`

Detaily workflow jsou v [CONTRIBUTING.md](CONTRIBUTING.md).

## Community standards

- [Kodex chování](CODE_OF_CONDUCT.md)
- [Příspěvky do projektu](CONTRIBUTING.md)
- [Bezpečnostní politika](SECURITY.md)
- [Licence (MIT)](LICENSE)
- [Issue templates](.github/ISSUE_TEMPLATE)
- [Pull request template](.github/pull_request_template.md)

## Troubleshooting

### Build na GitHub Actions padá na env proměnných

Zkontroluj, že jsou nastavené obě repository variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Aplikace běží lokálně, ale na Pages nenajde assety

Zkontroluj base path ve workflow (`VITE_BASE_PATH`). Musí odpovídat názvu repozitáře, typicky `/RUin/`.

### RPC volání vrací chyby oprávnění

Zpravidla chybí nebo neodpovídá RLS/policy vrstva. Ověř, že byly spuštěné všechny SQL fáze ve správném pořadí.

### Nejde otevřít režim organizátora

Správa akce je vázaná na token v manage URL. Bez správného tokenu není možné provádět organizátorské akce.

### Chyba "Could not find the function ... in the schema cache"

Klientský kód posílá RPC volání s parametry, které aktuální databázové schéma nezná (typicky po `git pull`, když ještě neběžel nejnovější `all-phases.sql`). Spusť celý `supabase/sql/all-phases.sql` znovu - je idempotentní, takže bezpečně doplní jen to, co chybí. Frontend a databázové schéma musí být vždy na stejné verzi.
