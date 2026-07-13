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
- [Supabase setup (SQL fáze)](#supabase-setup-sql-faze)
- [Scénáře nasazení databáze](#scenare-nasazeni-databaze)
- [NPM skripty](#npm-skripty)
- [Nasazení na GitHub Pages](#nasazeni-na-github-pages)
- [Jak funguje routing na Pages](#jak-funguje-routing-na-pages)
- [Push notifikace a service worker](#push-notifikace-a-service-worker)
- [Pravidla pro contributory](#pravidla-pro-contributory)
- [Community standards](#community-standards)
- [Troubleshooting](#troubleshooting)

## Co aplikace umí

- vytvořit akci (název, místo, termín, popis)
- sbírat odpovědi RSVP (dorazím / nedorazím + omluvenka)
- moderovat účastníky v režimu organizátora
- chat k dané akci
- pings/šťouchnutí účastníků
- volitelně pracovat s telefonním číslem (dle nastavení akce)

## Technologický stack

- Frontend: React 19, Vite 8, Tailwind CSS 4, React Router
- Backend: Supabase Postgres + RPC funkce + RLS + Realtime
- Deploy: GitHub Actions -> GitHub Pages

## Struktura repozitáře

- `client/` - frontend aplikace ve Vite
  - `src/pages/` - hlavní obrazovky (vytvoření, detail, správa akce)
  - `src/components/` - znovupoužitelné UI komponenty
  - `src/lib/` - API vrstva, Supabase klient, helpery
  - `public/sw.js` - service worker (PWA/push)
- `supabase/sql/` - SQL skripty po jednotlivých fázích
- `supabase/functions/` - Edge Functions pro push dispatch
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

## Supabase setup (SQL fáze)

SQL skripty v `supabase/sql` spouštěj postupně podle čísel:

1. `phase-1-schema.sql`
2. `phase-2-rpc.sql`
3. `phase-3-rls.sql`
4. `phase-4-datetime-local-fix.sql`
5. `phase-5-push-notifications.sql`
6. `phase-6-phone-and-overview.sql`
7. `phase-7-realtime-tick-fk-hotfix.sql`
8. `phase-8-update-event-details.sql`
9. `phase-9-unique-phone-per-event.sql`
10. `phase-10-push-reminders.sql`
11. `phase-11-community-features.sql`

Co dělá každá fáze:

1. `phase-1-schema.sql`

- Vytvoří základní tabulky (`events`, `attendees`, `attendee_pings`, `event_chat_messages`, `organizer_pin_attempts`).
- Přidá indexy a unikátní omezení (např. jedno RSVP na jméno v rámci eventu, case-insensitive).
- Připraví trigger pro normalizaci chat zpráv a základní realtime publikaci chatu.

2. `phase-2-rpc.sql`

- Zavede hlavní RPC funkce pro aplikaci (create/get event, submit RSVP, ping, moderation, delete).
- Přidá pomocné funkce (`_random_token`, `_delete_expired_events`) a granty pro `anon`/`authenticated`.
- Sjednotí chování backendu do SQL funkcí se stejnými validačními hláškami.

3. `phase-3-rls.sql`

- Zapne a zpřísní RLS pro klíčové tabulky.
- Zablokuje přímý přístup na tabulky z klienta a nechá flow běžet přes RPC.
- Nastaví kontrolovaná pravidla pro čtení/vkládání chat zpráv.

4. `phase-4-datetime-local-fix.sql`

- Opraví práci s datem/časem na lokální `timestamp without time zone` (bez timezone posunů).
- Doplňuje kompatibilní změny pro starší projekty (PIN sloupce, chat/ping struktura, funkce).
- Reaplikuje navazující funkce/policy tak, aby vše fungovalo po změně typu času.

5. `phase-5-push-notifications.sql`

- Přidá `event_realtime_ticks` a triggery pro realtime refresh payloadu (event/attendee/ping).
- Připraví realtime tok pro změny účastníků a šťouchnutí.
- Uklidí starou push job/subscription strukturu (drop legacy objektů).

6. `phase-6-phone-and-overview.sql`

- Přidá volitelný sběr telefonu (`events.require_phone`, `attendees.phone`).
- Rozšíří `create_event`, `submit_rsvp`, `get_event_payload` a `update_event` o nové atributy.
- Umožní frontendu zobrazovat přehledy včetně telefonu a requirePhone flagu.

7. `phase-7-realtime-tick-fk-hotfix.sql`

- Hotfix funkce `emit_event_realtime_tick` proti FK chybám při mazání/expiraci eventů.
- Vkládá realtime tick jen pokud event ještě existuje.

8. `phase-8-update-event-details.sql`

- Rozšiřuje organizátorskou editaci detailů akce (název, místo, datum/čas).
- Aktualizuje a grantuje `update_event` funkci pro klienta.

9. `phase-9-unique-phone-per-event.sql`

- Zavede normalizaci telefonu (`normalize_phone`) a unikátní index telefonu v rámci eventu.
- Přidá ochranu proti duplicitě čísla u jiného jména v `submit_rsvp`.
- Migrace schválně selže, pokud už v datech duplicity existují (aby nevznikl rozbitý index).

10. `phase-10-push-reminders.sql`

- Přidá `push_subscriptions` (přihlášení k odběru Web Push notifikací) a `event_reminders_sent` (aby se stejná připomínka neposlala dvakrát).
- Zavede RPC `register_push_subscription`/`unregister_push_subscription` pro klienta a `get_pending_event_reminders`/`get_push_subscriptions_for_event`/`mark_event_reminder_sent`/`delete_push_subscription_by_endpoint` pro Edge Function (grant jen pro `service_role`).
- Vyžaduje ještě nasazení Edge Function a scheduled joby — viz [Push notifikace a service worker](#push-notifikace-a-service-worker).

11. `phase-11-community-features.sql`

- Check-in (`checked_in_at` na `attendees`, RPC `check_in_attendee`).
- Emoji reakce na chatové zprávy (`event_chat_message_reactions`, RPC `toggle_chat_reaction`).
- Seznamy "kdo co nese" / spolujízda (`event_signup_items` + `event_signup_claims`, kategorie `bring`/`ride`).
- Vícero zastávek za večer (`event_stops`).
- Ankety na termín/místo před založením akce (`event_polls`, `event_poll_options`, `event_poll_votes`) — hlasování má veřejný a tvůrčí (token) odkaz stejně jako akce, `finalize_event_poll` z vítězné možnosti rovnou zavolá `create_event`.
- Fotky z akce (`event_photos` + Storage bucket `event-photos`, veřejný pro čtení).

Doporučení:

- spouštěj je v Supabase SQL Editoru na stejném projektu, který používáš v `.env.local`
- po nasazení nové fáze otestuj vytvoření akce, RSVP i detail akce
- pokud chceš setup jedním během, použij `supabase/sql/all-phases.sql`

## Scénáře nasazení databáze

### A) Nový (čistý) Supabase projekt

Použij jeden soubor:

```sql
-- spusť celý obsah souboru
supabase/sql/all-phases.sql
```

Tohle je nejrychlejší cesta pro clean install.

### B) Existující projekt na starší verzi

Spouštěj fáze postupně od aktuálního stavu nahoru. Pokud si nejsi jistý, kde projekt skončil, je bezpečnější projít SQL fáze ručně v pořadí a sledovat případné chyby v SQL Editoru.

## NPM skripty

Kořen repozitáře (`package.json`):

- `npm run dev` - vývojový server klienta
- `npm run build` - produkční build klienta
- `npm run audit:a11y` - build + a11y audit skript

Klient (`client/package.json`):

- `npm --prefix client run dev`
- `npm --prefix client run build`
- `npm --prefix client run preview`
- `npm --prefix client run lint`

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

**3. Spusť `supabase/sql/SQL-phases/phase-10-push-reminders.sql`** v Supabase SQL Editoru.

**4. Nastav secrets a nasaď Edge Function:**

```bash
supabase secrets set VAPID_PUBLIC_KEY=tvuj-public-key
supabase secrets set VAPID_PRIVATE_KEY=tvuj-privatni-key
supabase secrets set VAPID_SUBJECT=mailto:tvuj@email.cz
supabase functions deploy send-event-reminders --no-verify-jwt
```

**5. Naplánuj pravidelné spouštění** (např. každých 15-30 minut), ať se stihne poslat "den předem" i "hodinu předem" upozornění včas. Nejjednodušší cesta je Supabase dashboard: `Edge Functions -> send-event-reminders -> Cron Jobs` a nastavit schedule (např. `*/15 * * * *`).

Alternativa přes SQL (pokud má projekt zapnuté `pg_cron` + `pg_net` rozšíření v `Database -> Extensions`):

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
