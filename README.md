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
- [NPM skripty](#npm-skripty)
- [Nasazení na GitHub Pages](#nasazeni-na-github-pages)
- [Jak funguje routing na Pages](#jak-funguje-routing-na-pages)
- [Push notifikace a service worker](#push-notifikace-a-service-worker)
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

Doporučení:

- spouštěj je v Supabase SQL Editoru na stejném projektu, který používáš v `.env.local`
- po nasazení nové fáze otestuj vytvoření akce, RSVP i detail akce
- pokud chceš setup jedním během, použij `supabase/sql/all-phases.sql`

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
