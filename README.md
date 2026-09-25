# RUin

**Čeština** · [English](README.en.md)

Webová RSVP aplikace pro domlouvání akcí ve skupině přátel. Produkční verze běží na [ruin.eckhardt.cz](https://ruin.eckhardt.cz).

Frontend je statická aplikace (React + Vite) nasazená na GitHub Pages, data a logika jsou v Supabase (Postgres, RPC funkce, RLS, Realtime, Storage, Edge Functions). Aplikace nemá uživatelské účty ani přihlašování - jak přesto hlídá oprávnění, popisuje [SECURITY_MODEL.md](SECURITY_MODEL.md).

## Obsah

- [Co aplikace umí](#co-aplikace-umí)
- [Stránky aplikace](#stránky-aplikace)
- [Technologický stack](#technologický-stack)
- [Struktura repozitáře](#struktura-repozitáře)
- [Požadavky](#požadavky)
- [Rychlý start lokálně](#rychlý-start-lokálně)
- [Konfigurace prostředí](#konfigurace-prostředí)
- [Supabase setup (SQL)](#supabase-setup-sql)
- [NPM skripty](#npm-skripty)
- [Testy a CI](#testy-a-ci)
- [Nasazení na GitHub Pages](#nasazení-na-github-pages)
- [Jak funguje routing na Pages](#jak-funguje-routing-na-pages)
- [Service worker, offline režim a push notifikace](#service-worker-offline-režim-a-push-notifikace)
  - [Automatické připomínky před akcí](#automatické-připomínky-před-akcí-den-a-hodinu-předem)
  - [Automatický úklid expirovaných akcí](#automatický-úklid-expirovaných-akcí-a-jejich-fotek)
- [Lokalizace (čeština a angličtina)](#lokalizace-čeština-a-angličtina)
- [Pravidla pro contributory](#pravidla-pro-contributory)
- [Community standards](#community-standards)
- [Troubleshooting](#troubleshooting)

## Co aplikace umí

**Akce a odpovědi**

- založení akce (název, místo, termín, popis) se 4místným správcovským PINem - organizátor dostane veřejný odkaz pro hosty a soukromý odkaz na správu
- volitelné moduly akce: "kdo co bere", spolujízda a itinerář se zastávkami; organizátor je zapíná při založení i později a může rovnou předvyplnit věci, odvozy i afterparty
- anketa na termín/místo před založením akce - má vlastní veřejný i tvůrčí odkaz a po vyhodnocení rovnou založí ostrou akci
- RSVP (dorazím / omluvenka s důvodem), volitelně s povinným telefonním číslem
- check-in na místě ("📍 Dorazil/a jsem")
- šťouchnutí (ping) se vzkazem pro ty, kdo nejdou (stejnou osobu lze šťouchnout znovu až po 10 minutách)
- chat k akci s emoji reakcemi na zprávy
- album fotek z akce s rozklikávacím náhledem (šipky mezi fotkami) a hromadným stažením fotek ostatních (jedním klikem jako ZIP, bez těch, které nahrál přihlášený uživatel sám)
- předpověď počasí pro místo a čas akce (Open-Meteo, až 16 dní dopředu)
- přidání do kalendáře (Google Kalendář, na iPhonu `.ics` soubor s upozorněním 2 dny předem) a na plochu telefonu (PWA)
- sdílení pozvánky (odkaz, QR kód, QR plakátek ke stažení)
- push připomínky den a hodinu před akcí

**Pro organizátora**

- správa akce: úprava detailů (název, místo, termín, popis, povinný telefon, moduly), schvalování a zamítání omluvenek, mazání účastníků, zastávek, položek a fotek, odebrání kohokoli z položky, smazání celé akce
- vstup do správy přes odkaz s tokenem, nebo z pozvánky zadáním PINu; přihlášení si prohlížeč pamatuje a po opakovaných chybných pokusech se PIN dočasně zablokuje
- "Moje poslední akce" na úvodní stránce - rychlý vstup do správy akcí založených v tomhle prohlížeči
- pozvání lidí předem (jméno + telefon) - v seznamu se ukážou jako "Pozváno", dokud sami neodpoví
- "Moje skupiny a šablony" (`/moje`) - účet podle jména, telefonu a 6místného kódu, ve kterém si organizátor ukládá skupiny kontaktů (pozve je jedním kliknutím) a šablony akcí (předvyplní formulář); funguje z jakéhokoli zařízení

**Obecně**

- čeština a angličtina - jazyk se vybere podle prohlížeče a přepíná se přepínačem CZ | EN v hlavičce (viz [Lokalizace](#lokalizace-čeština-a-angličtina)); vedle je přepínač světlého a tmavého režimu
- offline režim - při výpadku připojení se ukáže upozornění a RSVP, check-in i přihlášení/odhlášení u položek se odešlou, až bude připojení zpátky; aplikaci, kterou prohlížeč už jednou načetl, jde díky service workeru otevřít i bez sítě (data ale bez připojení nenačte)
- plovoucí tlačítko na každé stránce pro nahlášení chyby nebo nápadu na vylepšení; přehled všech hlášení je na `/feedback` (veřejná stránka, bez PINu)

## Stránky aplikace

Aplikace používá `HashRouter`, adresy tedy začínají `/#/` (viz [Jak funguje routing na Pages](#jak-funguje-routing-na-pages)). Neznámá adresa přesměruje na úvod.

| Cesta | Stránka |
| --- | --- |
| `/` | úvod a formulář pro založení akce |
| `/event/:id` | veřejná pozvánka pro hosty (RSVP, seznam hostů, chat, fotky, …) |
| `/event/:id/manage?token=…` | správa akce pro organizátora; bez platného tokenu nabídne zadání PINu |
| `/poll/new` | založení ankety na termín a místo |
| `/poll/:id` | hlasování v anketě; s `?token=…` vyhodnocení pro jejího tvůrce |
| `/moje` | moje skupiny a šablony |
| `/feedback` | přehled nahlášených chyb a nápadů |

## Technologický stack

- Frontend: React 19, Vite 8, Tailwind CSS 4, React Router 7, `sonner` (toasty), `qrcode` (QR kódy), `jszip` (ZIP s fotkami)
- Backend: Supabase - Postgres + RPC funkce (`SECURITY DEFINER`) + RLS + Realtime + Storage + Edge Functions (Deno)
- Externí služby: Open-Meteo (geokódování a předpověď počasí), Google Fonts (Space Grotesk)
- Testy: Jest + Testing Library (`client/src/**/*.test.js`), `jest-axe` pro a11y assertions v testech, Puppeteer + `axe-puppeteer` pro `npm run audit:a11y` proti buildu
- Deploy: GitHub Actions -> GitHub Pages (vlastní doména `ruin.eckhardt.cz`)

## Struktura repozitáře

- `client/` - frontend aplikace ve Vite
  - `src/pages/` - hlavní obrazovky (úvod a založení akce, pozvánka, správa akce, ankety, skupiny a šablony, feedback)
  - `src/components/` - znovupoužitelné UI komponenty
  - `src/lib/` - API vrstva (`api.js` je jediné místo, které volá Supabase RPC), Supabase klient, překlady (`i18n.js`) a helpery (formátování, počasí, push, QR plakátek, localStorage)
  - `src/locales/` - slovníky textů UI (`cs.js`, `en.js`) a anglické znění chybových hlášek z databáze (`serverMessages.en.js`)
  - `src/test/` - sdílené testovací helpery a Jest setup
  - `public/` - service worker (`sw.js`), ikony a manifest
  - `scripts/run-vite-safe.mjs` - spouští Vite z dočasné kopie projektu (viz [NPM skripty](#npm-skripty))
- `supabase/sql/all-phases.sql` - celé databázové schéma, jediný SQL soubor
- `supabase/functions/` - Edge Functions (`send-event-reminders` pro push připomínky, `cleanup-expired-events` pro úklid expirovaných akcí)
- `scripts/audit-a11y.mjs` - a11y audit postaveného buildu (Puppeteer + axe-core)
- `.github/` - CI/CD workflow (`workflows/deploy-pages.yml`) a šablony pro issues a pull requesty
- `CNAME` - vlastní doména pro GitHub Pages

## Požadavky

- Node.js 22+ (stejnou verzi používá CI)
- npm 10+
- Supabase projekt s právy pro vytvoření schématu, funkcí a policies
- pro nasazení Edge Functions [Supabase CLI](https://supabase.com/docs/guides/cli)

## Rychlý start lokálně

Nejdřív vytvoř `client/.env.local` (viz [Konfigurace prostředí](#konfigurace-prostředí)), bez něj aplikace hned při startu spadne. Pak z kořene repozitáře:

```bash
npm install
npm run dev
```

Kořenový `npm install` doinstaluje přes `postinstall` i závislosti v `client/` a kořenový `dev` skript spouští klienta z adresáře `client`. Vývojový server běží na http://localhost:5173/.

## Konfigurace prostředí

Aplikace vyžaduje Supabase URL + veřejný klíč.

Vytvoř soubor `client/.env.local`:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
# nepovinné - bez něj se tlačítko pro push připomínky vůbec nezobrazí
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key
```

Poznámka:

- místo `VITE_SUPABASE_ANON_KEY` lze použít i `VITE_SUPABASE_PUBLISHABLE_KEY`
- bez Supabase hodnot aplikace spadne hned při startu (záměrně, kvůli jasné chybě konfigurace)
- jak získat `VITE_VAPID_PUBLIC_KEY`, popisuje [Automatické připomínky před akcí](#automatické-připomínky-před-akcí-den-a-hodinu-předem)
- anon/publishable klíč je veřejný (je vidět v buildu) - oprávnění hlídá databáze, ne utajení klíče, viz [SECURITY_MODEL.md](SECURITY_MODEL.md)

## Supabase setup (SQL)

Celé databázové schéma žije v jednom souboru:

```sql
-- spusť celý obsah souboru v Supabase SQL Editoru
supabase/sql/all-phases.sql
```

Žádné samostatné "fáze" k ručnímu skládání - `all-phases.sql` je jediný zdroj pravdy a při každé další změně schématu se upravuje přímo on (ne nový soubor vedle). Je napsaný idempotentně (`create table if not exists`, `create or replace function`, `drop policy/trigger if exists` před každým `create`, `on conflict do nothing` u jediného top-level insertu), takže ho lze bezpečně spustit znovu celý i na projektu, který už část schématu má - Postgres jen přeskočí nebo nahradí to, co už existuje. Uvnitř je rozdělený do očíslovaných sekcí (`-- Phase N: ...`), jejichž komentáře vysvětlují, proč daná změna vznikla.

Co všechno `all-phases.sql` obsahuje:

- Základní schéma: `events`, `attendees`, `attendee_pings`, `event_chat_messages`, RLS na klíčových tabulkách, RPC funkce pro create/get event, submit RSVP, ping, moderaci a mazání.
- Lokální datum/čas bez timezone posunů.
- Realtime refresh payloadu (`event_realtime_ticks` + triggery) při změně účastníků/šťouchnutí.
- Volitelný sběr telefonu (`events.require_phone`, `attendees.phone`) s normalizací a unikátním indexem proti duplicitě čísla v rámci akce.
- Organizátorská editace detailů akce (název, místo, datum/čas, popis, povinný telefon).
- Web Push připomínky (`push_subscriptions`, `event_reminders_sent`, RPC pro klienta i pro Edge Function) - vyžaduje ještě nasazení Edge Function a scheduled joby, viz [Service worker, offline režim a push notifikace](#service-worker-offline-režim-a-push-notifikace).
- Komunitní prvky: check-in, emoji reakce na chat, seznamy "kdo co nese" / spolujízda, vícero zastávek za večer, ankety na termín/místo před založením akce (s vlastním veřejným i tvůrčím odkazem), fotky z akce (Storage bucket `event-photos`).
- Case-insensitive hlasování v anketách.
- Šťouchnutí s opakovatelným 10minutovým cooldownem místo "jednou navždy" (atomický `on conflict ... do update ... where`), s RLS na `attendee_pings`.
- Bezpečnostní hardening: `_random_token` přes `pgcrypto`/`gen_random_bytes()` místo nekryptografického `random()` (token je jediné oprávnění k `update_event`/`delete_event`/`delete_attendee`/`moderate_attendee`); `get_event_payload` vrací telefonní čísla jen s platným `p_organizer_token`; opravená race podmínka v `moderate_attendee`; srozumitelná hláška místo syrové Postgres chyby při konfliktu telefonního čísla. Záměrně neřeší: `organizer_token` zůstává čitelný (ne hash), protože appka přes PIN umí "obnovit" zapomenutý manage odkaz a to s jednosměrným hashem nejde bez přestavby celého recovery flow. Celý model identity/autorizace (appka nemá auth vůbec, jediná "oprávnění" jsou tokeny v odkazech, RLS musí defaultně vše zamítat) je sepsaný v [SECURITY_MODEL.md](SECURITY_MODEL.md).
- Mazání fotek ze Storage při zániku akce - ruční mazání jde přes klientské Storage API, automatické po 7 dnech přes `get_expired_event_ids()` a Edge Function `cleanup-expired-events` (viz [Automatický úklid expirovaných akcí](#automatický-úklid-expirovaných-akcí-a-jejich-fotek)) - a vlastní životní cyklus anket (nevyhodnocená zanikne 14 dní od vytvoření, vyhodnocená automaticky spolu s akcí, co z ní vznikla).
- Blokace přihlášení řidiče na vlastní nabídku odvozu + možnost odebrat konkrétního spolujezdce z vlastní nabídky.
- Read hardening: chat, fotky, ankety, seznamy i zastávky jdou číst jen přes RPC omezené na konkrétní akci (přímé `select` politiky jsou `using (false)`), realtime běží přes `event_realtime_ticks`.
- Organizátor jako samostatná identita (`events.organizer_name`) - chat, šťouchnutí, fotky i položky ze správy akce se podepisují jménem organizátora.
- Serverové omezení uploadu fotek (bucket `event-photos`: max 10 MB, jen obrázky).
- Feedback (hlášení chyb a nápadů): `feedback_reports` + RPC `submit_feedback_report`/`get_feedback_reports`. Čtení přes `/feedback` je záměrně veřejné bez PINu - kdokoliv na tuhle adresu uvidí jméno i text všech hlášení.
- Skupiny kontaktů a šablony akcí (`owners`, `contact_groups`, `contact_group_members`, `event_templates`) vázané na účet podle jména, telefonu a 6místného kódu (`access_owner_account`; kód je uložený jako bcrypt hash a po opakovaných chybách se dočasně zablokuje) + hromadné pozvání lidí do akce (`invite_attendees`, stav `invited`).
- Volitelné moduly akce (`enable_bring_list`, `enable_carpool`, `enable_stops`).
- Organizátor může odebrat kohokoli z libovolné položky "kdo co bere" i spolujízdy.

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
- `npm --prefix client run lint` - ESLint
- `npm --prefix client run test` - Jest (jednotkové, komponentové + a11y testy, `*.test.js`)
- `npm --prefix client run test:a11y` - jen testy odpovídající vzoru `a11y`

`dev`, `build` i `preview` v klientovi běží přes `client/scripts/run-vite-safe.mjs`. Ten zkopíruje projekt do dočasné složky (`src` a `public` jen nalinkuje) a Vite spustí tam, protože Vite si neporadí s cestou obsahující třeba `?` (složka "Are you in?"). Úpravy v `src/` a `public/` se projeví hned, po změně `vite.config.js` nebo `package.json` je potřeba dev server restartovat. Vlastní parametry pro Vite předej přímo tomuhle skriptu, např. `node scripts/run-vite-safe.mjs dev --host 127.0.0.1` v adresáři `client` - přes `npm run dev -- ...` se neprojdou.

## Testy a CI

- `npm test` spustí Jest (jsdom + Testing Library + `jest-axe`): jednotkové testy `lib/`, testy komponent a a11y testy.
- Testy lokalizace hlídají, že `cs.js` a `en.js` mají stejné klíče i `{placeholdery}` a že každá hláška z `all-phases.sql` má anglický překlad (viz [Lokalizace](#lokalizace-čeština-a-angličtina)).
- Jest setup (`client/src/test/setup.js`) přepíná UI do češtiny - jsdom se jinak hlásí jako `en-US` a aplikace by běžela anglicky.
- `npm run audit:a11y` postaví aplikaci a projde úvod, pozvánku a správu akce axe auditem v Puppeteeru.
- CI (job `ci` v `.github/workflows/deploy-pages.yml`) spouští lint a testy při každém pull requestu do `main` i při push do `main`. Build a deploy běží jen při push do `main` (nebo ručním spuštění) a jen když `ci` projde.
- Jest nefunguje, když cesta k projektu obsahuje `?` - viz [Troubleshooting](#troubleshooting).

## Nasazení na GitHub Pages

Repo se nasazuje automaticky přes workflow `.github/workflows/deploy-pages.yml`: job `ci` (lint + testy), potom `build` (produkční build `client/dist`) a `deploy` (publikace na GitHub Pages).

### 1. Nastav repository variables

V GitHub repozitáři otevři:

`Settings -> Secrets and variables -> Actions -> Variables`

a přidej:

- `VITE_SUPABASE_URL` = URL tvého Supabase projektu
- `VITE_SUPABASE_ANON_KEY` = anon/publishable key
- `VITE_VAPID_PUBLIC_KEY` = veřejný VAPID klíč pro push připomínky (nepovinné)

### 2. Zapni GitHub Pages přes Actions

V GitHubu:

`Settings -> Pages -> Source: GitHub Actions`

### 3. Vlastní doména

Produkce běží na `ruin.eckhardt.cz` (nastavené v `Settings -> Pages -> Custom domain`, doména je i v souboru `CNAME`). Aplikace proto běží z kořene domény a `client/vite.config.js` má `base: '/'`. Při nasazení bez vlastní domény na `https://<user>.github.io/<repo>/` změň `base` na `'/<repo>/'`.

### 4. Push do větve main

Workflow se spouští:

- při push do `main` - lint, testy, build a deploy
- při pull requestu do `main` - jen lint a testy
- ručně přes `workflow_dispatch`

### 5. Ověř výsledek

Po doběhnutí workflow najdeš URL v:

- Actions (job Deploy to GitHub Pages)
- nebo Settings -> Pages

## Jak funguje routing na Pages

Aplikace používá `HashRouter` (`/#/`), což je správně pro GitHub Pages bez server-side fallbacku. Díky tomu fungují i přímé odkazy na podstránky.

## Service worker, offline režim a push notifikace

- service worker je v `client/public/sw.js` a klient ho registruje hned při startu aplikace
- navigace jde nejdřív na síť a při výpadku se vezme poslední uložená verze stránky, statické soubory se berou z cache - aplikace, kterou prohlížeč už jednou načetl, se tak otevře i offline
- požadavky na Supabase a na jiné domény se do cache nikdy neukládají; soubory z Vite dev serveru (`/src/`, `/node_modules/`, `/@vite/`, …) taky ne, takže při vývoji vždycky vidíš aktuální kód
- při změně strategie cachování zvyš verzi v `APP_SHELL_CACHE` - `activate` handler pak starou cache smaže
- offline režim v aplikaci: při výpadku připojení se ukáže upozornění a zápisy, které jde bezpečně zopakovat (RSVP, check-in, přihlášení a odhlášení u položek), se uloží a odešlou po obnovení připojení (`client/src/lib/api.js`)
- push notifikace zobrazuje service worker (`push` event), klik na notifikaci otevře stránku akce; samotné odesílání řeší Supabase Edge Functions (`supabase/functions/`)

Pokud push notifikace nechodí, nejčastěji chybí správná konfigurace v Supabase nebo oprávnění notifikací v prohlížeči.

### Automatické připomínky před akcí (den a hodinu předem)

Účastník si po RSVP může v appce zapnout tlačítko "🔔 Připomenout den a hodinu předem" - to zaregistruje Web Push subscription k dané akci. Skutečné odeslání notifikace zajišťuje scheduled Edge Function `send-event-reminders`, kterou je potřeba jednorázově nastavit:

**1. Vygeneruj VAPID klíče** (jen jednou za projekt):

```bash
npx web-push generate-vapid-keys
```

**2. Nastav `client/.env.local`** (veřejný klíč, bezpečné mít na frontendu):

```env
VITE_VAPID_PUBLIC_KEY=tvuj-vygenerovany-public-key
```

Stejnou hodnotu přidej i jako repository variable `VITE_VAPID_PUBLIC_KEY` pro GitHub Pages build (viz [Nasazení na GitHub Pages](#nasazení-na-github-pages)).

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

Bez kroků 3-5 se tlačítko připomínky v appce zobrazí a subscription se uloží, ale žádná notifikace nikdy nepřijde - dokud Edge Function neběží na scheduleru, nemá kdo `get_pending_event_reminders()` vyzvednout a poslat. Texty připomínek skládá Edge Function a jsou zatím jen česky.

### Automatický úklid expirovaných akcí (a jejich fotek)

Akce, kterým je 7+ dní po termínu (počítáno v čase Europe/Prague), maže scheduled Edge Function `cleanup-expired-events`: nejdřív přes Storage Admin API smaže jejich fotky z bucketu `event-photos` a teprve potom samotné akce (`delete_events_by_ids()`). Akce, u které se smazání fotek nepovede, zůstane a zkusí se znovu při dalším běhu. Přímo v SQL to nejde - tenhle Supabase projekt odmítá mazání ze storage tabulek hláškou `"Direct deletion from storage tables is not allowed. Use the Storage API instead."`.

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

Bez tohohle kroku se expirované akce nemažou vůbec - dřívější automatické mazání přímo v SQL (`_delete_expired_events()`) bylo odstraněné, protože nemohlo mazat fotky ze Storage. Ankety mají vlastní úklid, který řeší databáze sama: nevyhodnocená anketa zanikne 14 dní od založení, vyhodnocená spolu s akcí, která z ní vznikla. Ruční mazání (organizátor smaže akci/fotku z appky) na téhle Edge Function nezávisí - jde přes klientské Storage API rovnou (`client/src/lib/supabase.js`).

## Lokalizace (čeština a angličtina)

UI je ve dvou jazycích. Čeština je zdrojový jazyk, angličtina má stejné klíče.

- Jazyk se při první návštěvě vybere podle prohlížeče (`cs` a `sk` -> čeština, cokoliv jiného -> angličtina) a přepíná se přepínačem CZ | EN v pravém horním rohu hlavičky každé stránky. Volba se ukládá do `localStorage` (`ruin-locale`), nastavuje se i `<html lang>`.
- Datum a čas se formátují podle jazyka (`cs-CZ`, v angličtině `en-GB` s 24hodinovým časem).
- Texty žijí v `client/src/locales/cs.js` a `client/src/locales/en.js`. V komponentě: `const { t } = useI18n()` a `t('sekce.klic', { parametr })`; mimo React (`lib/`) stačí importovat `t` z `client/src/lib/i18n.js`. Plurály jsou objekty podle `Intl.PluralRules` (`{ one, few, other }`), chybějící tvar spadne na `other`.
- Nový text přidej do obou slovníků - `client/src/lib/i18n.test.js` hlídá, že mají stejné klíče i stejné `{placeholdery}`.
- Chybové hlášky z databáze (`raise exception` v `all-phases.sql`) zůstávají česky; klient je pro anglické UI přeloží podle přesného textu v `client/src/locales/serverMessages.en.js`. Když v SQL přidáš nebo přeformuluješ hlášku, doplň ji tam taky - stejný test jinak spadne. Kód, který se rozhoduje podle konkrétní hlášky, porovnává původní text z `error.serverMessage`, ne přeložené `error.message`.
- Zatím česky zůstávají push připomínky: jejich text skládá Edge Function `send-event-reminders` a u odběru se jazyk neukládá.

## Pravidla pro contributory

Pro externí contributory platí jednoduché pravidlo:

- nepushovat přímo do `main`
- vždy vytvořit vlastní branch
- změny posílat přes Pull Request do `main`

Detaily workflow jsou v [CONTRIBUTING.md](CONTRIBUTING.md).

## Community standards

- [Kodex chování](CODE_OF_CONDUCT.md)
- [Příspěvky do projektu](CONTRIBUTING.md)
- [Bezpečnostní politika (hlášení zranitelností)](SECURITY.md)
- [Bezpečnostní model (identita, autorizace, RLS)](SECURITY_MODEL.md)
- [Code review z 30. 7. 2026](CODE_REVIEW.md)
- [Licence (MIT)](LICENSE)
- [Issue templates](.github/ISSUE_TEMPLATE)
- [Pull request template](.github/pull_request_template.md)

Všechny dokumenty mají i anglickou verzi (soubory `*.en.md`).

## Troubleshooting

### Build na GitHub Actions padá na env proměnných

Zkontroluj, že jsou nastavené obě povinné repository variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Aplikace běží lokálně, ale na Pages nenajde assety

`client/vite.config.js` má `base: '/'`, protože produkce běží na vlastní doméně. Při nasazení bez vlastní domény na `https://<user>.github.io/<repo>/` musí `base` odpovídat názvu repozitáře, tedy `'/<repo>/'`.

### RPC volání vrací chyby oprávnění

Zpravidla na Supabase projektu, na který ukazuje `.env.local`, neběží aktuální `all-phases.sql`, nebo chybí či nesedí RLS/policy vrstva. Spusť celý `supabase/sql/all-phases.sql` znovu - je idempotentní.

### Nejde otevřít režim organizátora

Správa akce je vázaná na token v odkazu na správu. Bez tokenu jde správu odemknout 4místným správcovským PINem (tlačítko "Spravovat akci" na pozvánce). Po 5 chybných pokusech se PIN zablokuje na 15 minut, po 10 na hodinu a po 15 na 24 hodin.

### Chyba "Could not find the function ... in the schema cache"

Klientský kód posílá RPC volání s parametry, které aktuální databázové schéma nezná (typicky po `git pull`, když ještě neběžel nejnovější `all-phases.sql`). Spusť celý `supabase/sql/all-phases.sql` znovu - je idempotentní, takže bezpečně doplní jen to, co chybí. Frontend a databázové schéma musí být vždy na stejné verzi.

### Dev server ukazuje starou verzi aplikace

Starší verze service workeru (`ruin-app-shell-v1`) si ukládala i soubory z Vite dev serveru a podávala je z cache i po změně kódu. Načti stránku jednou s Ctrl+Shift+R, případně v DevTools smaž data webu (`Application -> Storage -> Clear site data`). Od verze `ruin-app-shell-v2` se to neděje.

### Stránka se neotevře na http://127.0.0.1:5173

Vite poslouchá na `localhost`, což se může přeložit jen na IPv6 (`::1`). Otevři http://localhost:5173/, nebo dev server spusť s `--host 127.0.0.1` (viz [NPM skripty](#npm-skripty)).

### `npm test` hlásí "Module <rootDir>/src/test/setup.js ... was not found"

Jest si neporadí s cestou k projektu, která obsahuje `?` (třeba složka "Are you in?"). Vite to obchází přes `run-vite-safe.mjs`, Jest ne - naklonuj nebo zkopíruj projekt do cesty bez zvláštních znaků a testy spusť tam.
