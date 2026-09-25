# RUin

[Čeština](README.md) · **English**

A web RSVP app for planning get-togethers with a group of friends. The production version runs at [ruin.eckhardt.cz](https://ruin.eckhardt.cz).

The frontend is a static app (React + Vite) deployed to GitHub Pages; data and logic live in Supabase (Postgres, RPC functions, RLS, Realtime, Storage, Edge Functions). The app has no user accounts or sign-in - how it still enforces permissions is described in [SECURITY_MODEL.en.md](SECURITY_MODEL.en.md).

## Contents

- [What the app does](#what-the-app-does)
- [App pages](#app-pages)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Quick start (local)](#quick-start-local)
- [Environment configuration](#environment-configuration)
- [Supabase setup (SQL)](#supabase-setup-sql)
- [NPM scripts](#npm-scripts)
- [Tests and CI](#tests-and-ci)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [How routing works on Pages](#how-routing-works-on-pages)
- [Service worker, offline mode and push notifications](#service-worker-offline-mode-and-push-notifications)
  - [Automatic event reminders](#automatic-event-reminders-a-day-and-an-hour-before)
  - [Automatic cleanup of expired events](#automatic-cleanup-of-expired-events-and-their-photos)
- [Localization (Czech and English)](#localization-czech-and-english)
- [Contributor rules](#contributor-rules)
- [Community standards](#community-standards)
- [Troubleshooting](#troubleshooting)

## What the app does

**Events and replies**

- create an event (name, place, date and time, description) with a 4-digit admin PIN - the organizer gets a public link for guests and a private management link
- optional event modules: "who brings what", carpool and an itinerary with stops; the organizer turns them on when creating the event or later, and can prefill items, rides and an afterparty right away
- a date/place poll before creating an event - the poll has its own public link and creator link, and once it's decided it creates the real event right away
- RSVPs (coming / excuse with a reason), optionally with a required phone number
- on-site check-in ("📍 I’m here")
- nudges (pings) with a message for people who aren't coming (the same person can be nudged again only after 10 minutes)
- a chat for each event, with emoji reactions to messages
- an event photo album with a clickable preview (arrows between photos) and a bulk download of everyone else's photos (one click, as a ZIP, without the ones the signed-in user uploaded themselves)
- a weather forecast for the event's place and time (Open-Meteo, up to 16 days ahead)
- adding the event to a calendar (Google Calendar; on iPhone an `.ics` file with a reminder 2 days before) and the app to the phone's home screen (PWA)
- sharing the invite (link, QR code, downloadable QR poster)
- push reminders a day and an hour before an event

**For organizers**

- event management: editing the details (name, place, date, description, required phone, modules), accepting and rejecting excuses, removing guests, stops, items and photos, removing anyone from an item, deleting the whole event
- getting into management through the link with its token, or from the invite by entering the PIN; the browser remembers the sign-in, and after repeated wrong attempts the PIN is temporarily locked
- "My recent events" on the home page - a shortcut into managing the events created in this browser
- inviting people in advance (name + phone) - they show up in the list as "Invited" until they reply themselves
- "My groups & templates" (`/moje`) - an account identified by name, phone and a 6-digit code, where the organizer keeps contact groups (invite them in one click) and event templates (prefill the form); works from any device

**General**

- Czech and English - the language is picked from the browser and switched with the CZ | EN toggle in the header (see [Localization](#localization-czech-and-english)); next to it is the light/dark mode toggle
- offline mode - when the connection drops, a notice appears, and RSVPs, check-ins and signing up for or backing out of items are sent once the connection is back; an app the browser has loaded before opens even without a network thanks to the service worker (it can't load data without a connection, though)
- a floating button on every page for reporting a bug or suggesting an improvement; all reports are listed at `/feedback` (a public page, no PIN)

## App pages

The app uses `HashRouter`, so addresses start with `/#/` (see [How routing works on Pages](#how-routing-works-on-pages)). An unknown address redirects to the home page.

| Path | Page |
| --- | --- |
| `/` | home page and the form for creating an event |
| `/event/:id` | the public invite for guests (RSVP, guest list, chat, photos, …) |
| `/event/:id/manage?token=…` | event management for the organizer; without a valid token it offers to enter the PIN |
| `/poll/new` | creating a date/place poll |
| `/poll/:id` | voting in a poll; with `?token=…` deciding it, for its creator |
| `/moje` | my groups & templates |
| `/feedback` | the list of reported bugs and ideas |

## Tech stack

- Frontend: React 19, Vite 8, Tailwind CSS 4, React Router 7, `sonner` (toasts), `qrcode` (QR codes), `jszip` (photo ZIPs)
- Backend: Supabase - Postgres + RPC functions (`SECURITY DEFINER`) + RLS + Realtime + Storage + Edge Functions (Deno)
- External services: Open-Meteo (geocoding and weather forecast), Google Fonts (Space Grotesk)
- Tests: Jest + Testing Library (`client/src/test/*.test.js`), `jest-axe` for a11y assertions in tests, Puppeteer + `axe-puppeteer` for `npm run audit:a11y` against the build
- Deploy: GitHub Actions -> GitHub Pages (custom domain `ruin.eckhardt.cz`)

## Repository structure

- `client/` - the Vite frontend app
  - `src/pages/` - main screens (home and event creation, invite, event management, polls, groups & templates, feedback)
  - `src/components/` - reusable UI components
  - `src/lib/` - the API layer (`api.js` is the only place that calls Supabase RPCs), the Supabase client, translations (`i18n.js`) and helpers (formatting, weather, push, QR poster, localStorage)
  - `src/locales/` - UI text dictionaries (`cs.js`, `en.js`) and the English wording of the database error messages (`serverMessages.en.js`)
  - `src/test/` - the tests (`*.test.js`), shared test helpers and the Jest setup
  - `public/` - service worker (`sw.js`), icons and the manifest
  - `scripts/run-vite-safe.mjs` - runs Vite from a temporary copy of the project (see [NPM scripts](#npm-scripts))
- `supabase/sql/all-phases.sql` - the whole database schema, a single SQL file
- `supabase/functions/` - Edge Functions (`send-event-reminders` for push reminders, `cleanup-expired-events` for cleaning up expired events)
- `scripts/audit-a11y.mjs` - a11y audit of the built app (Puppeteer + axe-core)
- `.github/` - CI/CD workflow (`workflows/deploy-pages.yml`) and the issue and pull request templates
- `CNAME` - the custom domain for GitHub Pages

## Requirements

- Node.js 22+ (the same version CI uses)
- npm 10+
- a Supabase project with permissions to create the schema, functions and policies
- to deploy the Edge Functions, the [Supabase CLI](https://supabase.com/docs/guides/cli)

## Quick start (local)

First create `client/.env.local` (see [Environment configuration](#environment-configuration)) - without it the app crashes right at startup. Then, from the repository root:

```bash
npm install
npm run dev
```

The root `npm install` also installs the dependencies in `client/` via `postinstall`, and the root `dev` script starts the client from the `client` directory. The development server runs at http://localhost:5173/.

## Environment configuration

The app needs a Supabase URL + public key.

Create a `client/.env.local` file:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
# optional - without it the push reminder button doesn't show up at all
VITE_VAPID_PUBLIC_KEY=your-vapid-public-key
```

Notes:

- instead of `VITE_SUPABASE_ANON_KEY` you can also use `VITE_SUPABASE_PUBLISHABLE_KEY`
- without the Supabase values the app crashes right at startup (on purpose, so the configuration error is obvious)
- how to get `VITE_VAPID_PUBLIC_KEY` is described in [Automatic event reminders](#automatic-event-reminders-a-day-and-an-hour-before)
- the anon/publishable key is public (it's visible in the build) - permissions are enforced by the database, not by keeping the key secret, see [SECURITY_MODEL.en.md](SECURITY_MODEL.en.md)

## Supabase setup (SQL)

The whole database schema lives in a single file:

```sql
-- run the whole file in the Supabase SQL Editor
supabase/sql/all-phases.sql
```

There are no separate "phases" to put together by hand - `all-phases.sql` is the single source of truth, and every further schema change is made directly in it (not in a new file next to it). It's written to be idempotent (`create table if not exists`, `create or replace function`, `drop policy/trigger if exists` before every `create`, `on conflict do nothing` on the only top-level insert), so it's safe to run the whole file again, even on a project that already has part of the schema - Postgres just skips or replaces whatever already exists. Inside, it's split into numbered sections (`-- Phase N: ...`) whose comments explain why each change was made.

What `all-phases.sql` contains:

- Base schema: `events`, `attendees`, `attendee_pings`, `event_chat_messages`, RLS on the key tables, RPC functions for create/get event, submit RSVP, ping, moderation and deletion.
- Local date/time without time zone shifts.
- Realtime payload refresh (`event_realtime_ticks` + triggers) when guests/nudges change.
- Optional phone number collection (`events.require_phone`, `attendees.phone`) with normalization and a unique index against duplicate numbers within an event.
- Organizer editing of event details (name, place, date/time, description, required phone).
- Web Push reminders (`push_subscriptions`, `event_reminders_sent`, RPCs for both the client and the Edge Function) - this also needs the Edge Function deployed and scheduled jobs, see [Service worker, offline mode and push notifications](#service-worker-offline-mode-and-push-notifications).
- Community features: check-in, emoji reactions in the chat, "who brings what" / carpool lists, several stops per night, date/place polls before creating an event (with their own public link and creator link), event photos (Storage bucket `event-photos`).
- Case-insensitive voting in polls.
- Nudges with a repeatable 10-minute cooldown instead of "once, forever" (an atomic `on conflict ... do update ... where`), with RLS on `attendee_pings`.
- Security hardening: `_random_token` via `pgcrypto`/`gen_random_bytes()` instead of the non-cryptographic `random()` (the token is the only authorization for `update_event`/`delete_event`/`delete_attendee`/`moderate_attendee`); `get_event_payload` returns phone numbers only with a valid `p_organizer_token`; a fixed race condition in `moderate_attendee`; a readable message instead of a raw Postgres error on a phone number conflict. Deliberately not addressed: `organizer_token` stays readable (not hashed), because the app can "recover" a forgotten manage link via the PIN, and that isn't possible with a one-way hash without rebuilding the whole recovery flow. The whole identity/authorization model (the app has no auth at all, the only "permissions" are tokens in links, RLS must deny everything by default) is written up in [SECURITY_MODEL.en.md](SECURITY_MODEL.en.md).
- Deleting photos from Storage when an event goes away - manual deletion goes through the client Storage API, automatic deletion after 7 days through `get_expired_event_ids()` and the `cleanup-expired-events` Edge Function (see [Automatic cleanup of expired events](#automatic-cleanup-of-expired-events-and-their-photos)) - and a lifecycle of their own for polls (an undecided poll expires 14 days after it was created, a decided one is removed automatically together with the event it created).
- Blocking a driver from signing up for their own ride offer + the option to remove a specific passenger from your own offer.
- Read hardening: chat, photos, polls, lists and stops can only be read through RPCs scoped to a specific event (the direct `select` policies are `using (false)`), and realtime goes through `event_realtime_ticks`.
- The organizer as a separate identity (`events.organizer_name`) - chat messages, nudges, photos and items from event management are signed with the organizer's name.
- Server-side limits on photo uploads (bucket `event-photos`: 10 MB max, images only).
- Feedback (bug reports and ideas): `feedback_reports` + RPCs `submit_feedback_report`/`get_feedback_reports`. Reading them at `/feedback` is deliberately public, without a PIN - anyone at that address sees the name and text of every report.
- Contact groups and event templates (`owners`, `contact_groups`, `contact_group_members`, `event_templates`) tied to an account identified by name, phone and a 6-digit code (`access_owner_account`; the code is stored as a bcrypt hash and is temporarily locked after repeated wrong attempts) + inviting people into an event in bulk (`invite_attendees`, status `invited`).
- Optional event modules (`enable_bring_list`, `enable_carpool`, `enable_stops`).
- The organizer can remove anyone from any "who brings what" item or carpool.

**Important:** the client sends the `p_organizer_token` parameter to `get_event_payload` and the matching checks to `remove_signup_claim`/`claim_signup_item` (see `client/src/lib/api.js`). If `all-phases.sql` hasn't been run on the same Supabase project that `.env.local` points to, the app stops working with the error `Could not find the function ... in the schema cache` (PostgREST can't find a matching function signature) - the client and the database schema must always be at the same version.

Recommendations:

- run it in the Supabase SQL Editor on the same project you use in `.env.local`
- after every run, test creating an event, an RSVP and the event detail

## NPM scripts

Repository root (`package.json`):

- `npm run dev` - client development server
- `npm run build` - client production build
- `npm run test` - runs the client tests (`npm --prefix client run test`)
- `npm run audit:a11y` - build + a11y audit script
- `npm run install:all` / `npm run postinstall` - installs the dependencies in `client/` (runs automatically after `npm install` in the root)

Client (`client/package.json`):

- `npm --prefix client run dev`
- `npm --prefix client run build`
- `npm --prefix client run preview`
- `npm --prefix client run lint` - ESLint
- `npm --prefix client run test` - Jest (unit, component + a11y tests, `*.test.js`)
- `npm --prefix client run test:a11y` - only the tests matching the `a11y` pattern

The client's `dev`, `build` and `preview` run through `client/scripts/run-vite-safe.mjs`. It copies the project into a temporary folder (only symlinking `src` and `public`) and runs Vite there, because Vite can't cope with a path that contains e.g. a `?` (the "Are you in?" folder). Changes in `src/` and `public/` show up right away; after changing `vite.config.js` or `package.json`, restart the dev server. Pass your own Vite options straight to this script, e.g. `node scripts/run-vite-safe.mjs dev --host 127.0.0.1` in the `client` directory - they don't get through `npm run dev -- ...`.

## Tests and CI

- `npm test` runs Jest (jsdom + Testing Library + `jest-axe`): unit tests for `lib/`, component tests and a11y tests.
- The localization tests check that `cs.js` and `en.js` have the same keys and `{placeholders}`, and that every message in `all-phases.sql` has an English translation (see [Localization](#localization-czech-and-english)).
- The Jest setup (`client/src/test/setup.js`) switches the UI to Czech - jsdom reports itself as `en-US`, so the app would otherwise run in English.
- `npm run audit:a11y` builds the app and runs an axe audit of the home page, the invite and event management in Puppeteer.
- CI (the `ci` job in `.github/workflows/deploy-pages.yml`) runs lint and tests on every pull request to `main` and on every push to `main`. Build and deploy run only on a push to `main` (or a manual run), and only when `ci` passes.
- Jest doesn't work when the project path contains a `?` - see [Troubleshooting](#troubleshooting).

## Deploying to GitHub Pages

The repo is deployed automatically by the `.github/workflows/deploy-pages.yml` workflow: the `ci` job (lint + tests), then `build` (production build of `client/dist`) and `deploy` (publishing to GitHub Pages).

### 1. Set the repository variables

In the GitHub repository, open:

`Settings -> Secrets and variables -> Actions -> Variables`

and add:

- `VITE_SUPABASE_URL` = the URL of your Supabase project
- `VITE_SUPABASE_ANON_KEY` = the anon/publishable key
- `VITE_VAPID_PUBLIC_KEY` = the public VAPID key for push reminders (optional)

### 2. Enable GitHub Pages via Actions

On GitHub:

`Settings -> Pages -> Source: GitHub Actions`

### 3. Custom domain

Production runs at `ruin.eckhardt.cz` (set in `Settings -> Pages -> Custom domain`; the domain is also in the `CNAME` file). The app therefore runs from the domain root, and `client/vite.config.js` has `base: '/'`. When deploying without a custom domain to `https://<user>.github.io/<repo>/`, change `base` to `'/<repo>/'`.

### 4. Push to the main branch

The workflow runs:

- on a push to `main` - lint, tests, build and deploy
- on a pull request to `main` - lint and tests only
- manually via `workflow_dispatch`

### 5. Check the result

Once the workflow finishes, you'll find the URL in:

- Actions (the Deploy to GitHub Pages job)
- or Settings -> Pages

## How routing works on Pages

The app uses `HashRouter` (`/#/`), which is the right choice for GitHub Pages without a server-side fallback. Thanks to that, direct links to subpages work too.

## Service worker, offline mode and push notifications

- the service worker is in `client/public/sw.js`, and the client registers it as soon as the app starts
- navigations go to the network first and fall back to the last saved copy of the page when offline, static files are served from the cache - so an app the browser has loaded before opens even offline
- requests to Supabase and other domains are never cached; neither are files from the Vite dev server (`/src/`, `/node_modules/`, `/@vite/`, …), so you always see the current code during development
- when you change the caching strategy, bump the version in `APP_SHELL_CACHE` - the `activate` handler then deletes the old cache
- offline mode in the app: when the connection drops, a notice appears, and writes that are safe to repeat (RSVPs, check-ins, signing up for and backing out of items) are saved and sent once the connection is back (`client/src/lib/api.js`)
- push notifications are shown by the service worker (the `push` event), and clicking one opens the event page; sending them is handled by Supabase Edge Functions (`supabase/functions/`)

If push notifications don't arrive, the usual cause is missing configuration in Supabase or missing notification permission in the browser.

### Automatic event reminders (a day and an hour before)

After RSVPing, a guest can turn on the "🔔 Remind me a day and an hour before" button in the app - that registers a Web Push subscription for the event. The notification itself is sent by the scheduled Edge Function `send-event-reminders`, which needs a one-time setup:

**1. Generate VAPID keys** (only once per project):

```bash
npx web-push generate-vapid-keys
```

**2. Set `client/.env.local`** (the public key, safe to have in the frontend):

```env
VITE_VAPID_PUBLIC_KEY=your-generated-public-key
```

Add the same value as the `VITE_VAPID_PUBLIC_KEY` repository variable for the GitHub Pages build as well (see [Deploying to GitHub Pages](#deploying-to-github-pages)).

**3. Make sure you've run `supabase/sql/all-phases.sql`** in the Supabase SQL Editor (it includes the push reminders schema too).

**4. Set the secrets and deploy the Edge Function:**

```bash
supabase secrets set VAPID_PUBLIC_KEY=your-public-key
supabase secrets set VAPID_PRIVATE_KEY=your-private-key
supabase secrets set VAPID_SUBJECT=mailto:you@example.com
supabase functions deploy send-event-reminders --no-verify-jwt
```

**5. Schedule it to run regularly** (e.g. every 15-30 minutes), so both the "a day before" and the "an hour before" notifications go out on time. The function runs with `--no-verify-jwt`, so it requires the `Authorization: Bearer <service-role-key>` header itself - without it, it returns 401 (see the comment in `index.ts`). When you set up the schedule (e.g. `*/15 * * * *`) in the Supabase dashboard (`Edge Functions -> send-event-reminders -> Cron Jobs`), you have to add this header by hand in the cron job's "HTTP Headers" section.

Alternatively via SQL (if the project has the `pg_cron` + `pg_net` extensions enabled in `Database -> Extensions`) - this already includes the header:

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

Without steps 3-5, the reminder button shows up in the app and the subscription gets saved, but no notification ever arrives - until the Edge Function runs on a schedule, nothing picks up `get_pending_event_reminders()` and sends them. The reminder texts are put together by the Edge Function and are only in Czech for now.

### Automatic cleanup of expired events (and their photos)

Events that are 7+ days past their date (in Europe/Prague time) are deleted by the scheduled Edge Function `cleanup-expired-events`: it first deletes their photos from the `event-photos` bucket through the Storage Admin API, and only then the events themselves (`delete_events_by_ids()`). An event whose photos couldn't be deleted stays and is retried on the next run. This can't be done straight from SQL - this Supabase project rejects deleting from the storage tables with `"Direct deletion from storage tables is not allowed. Use the Storage API instead."`.

**1. Deploy the Edge Function:**

```bash
supabase functions deploy cleanup-expired-events --no-verify-jwt
```

**2. Schedule it to run regularly** (once a day is plenty, expiry isn't time-critical). The function requires the same `Authorization: Bearer <service-role-key>` header as `send-event-reminders` above. In the Supabase dashboard (`Edge Functions -> cleanup-expired-events -> Cron Jobs`, schedule e.g. `0 3 * * *`), add it by hand in the "HTTP Headers" section.

Alternatively via SQL (`pg_cron` + `pg_net`) - this already includes the header:

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

Without this step, expired events aren't deleted at all - the earlier automatic deletion straight in SQL (`_delete_expired_events()`) was removed because it couldn't delete photos from Storage. Polls have a cleanup of their own that the database handles by itself: an undecided poll expires 14 days after it was created, a decided one together with the event it created. Manual deletion (an organizer deletes an event/photo in the app) doesn't depend on this Edge Function - it goes straight through the client Storage API (`client/src/lib/supabase.js`).

## Localization (Czech and English)

The UI comes in two languages. Czech is the source language; English has the same keys.

- On the first visit, the language is picked from the browser (`cs` and `sk` -> Czech, anything else -> English), and it's switched with the CZ | EN toggle in the top-right corner of every page's header. The choice is saved in `localStorage` (`ruin-locale`), and `<html lang>` is set as well.
- Dates and times are formatted for the language (`cs-CZ`; in English `en-GB` with a 24-hour clock).
- The texts live in `client/src/locales/cs.js` and `client/src/locales/en.js`. In a component: `const { t } = useI18n()` and `t('section.key', { param })`; outside React (`lib/`), just import `t` from `client/src/lib/i18n.js`. Plurals are objects keyed by `Intl.PluralRules` category (`{ one, few, other }`); a missing form falls back to `other`.
- Add every new text to both dictionaries - `client/src/test/i18n.test.js` checks that they have the same keys and the same `{placeholders}`.
- Database error messages (`raise exception` in `all-phases.sql`) stay in Czech; for the English UI, the client translates them by their exact text using `client/src/locales/serverMessages.en.js`. When you add or reword a message in the SQL, add it there too - otherwise the same test fails. Code that branches on a specific message compares the original text from `error.serverMessage`, not the translated `error.message`.
- Push reminders are still in Czech for now: their text is put together by the `send-event-reminders` Edge Function, and the language isn't stored with the subscription.

## Contributor rules

One simple rule applies to external contributors:

- don't push directly to `main`
- always create your own branch
- send changes via a Pull Request to `main`

The workflow details are in [CONTRIBUTING.en.md](CONTRIBUTING.en.md).

## Community standards

- [Code of conduct](CODE_OF_CONDUCT.en.md)
- [Contributing](CONTRIBUTING.en.md)
- [Security policy (reporting vulnerabilities)](SECURITY.en.md)
- [Security model (identity, authorization, RLS)](SECURITY_MODEL.en.md)
- [Code review from 30 July 2026](CODE_REVIEW.en.md)
- [License (MIT)](LICENSE)
- [Issue templates](.github/ISSUE_TEMPLATE)
- [Pull request template](.github/pull_request_template.md)

Every document also has a Czech version (the files without `.en`).

## Troubleshooting

### The GitHub Actions build fails on environment variables

Check that both required repository variables are set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### The app runs locally, but can't find its assets on Pages

`client/vite.config.js` has `base: '/'`, because production runs on a custom domain. When deploying without a custom domain to `https://<user>.github.io/<repo>/`, `base` must match the repository name, i.e. `'/<repo>/'`.

### RPC calls return permission errors

Usually the Supabase project that `.env.local` points to isn't running the current `all-phases.sql`, or the RLS/policy layer is missing or doesn't match. Run the whole `supabase/sql/all-phases.sql` again - it's idempotent.

### Organizer mode won't open

Event management is tied to the token in the management link. Without the token, management can be unlocked with the 4-digit admin PIN (the "Manage event" button on the invite). After 5 wrong attempts the PIN is locked for 15 minutes, after 10 for an hour and after 15 for 24 hours.

### Error "Could not find the function ... in the schema cache"

The client code sends RPC calls with parameters the current database schema doesn't know (typically after a `git pull`, when the latest `all-phases.sql` hasn't been run yet). Run the whole `supabase/sql/all-phases.sql` again - it's idempotent, so it safely adds only what's missing. The frontend and the database schema must always be at the same version.

### The dev server shows an old version of the app

An older version of the service worker (`ruin-app-shell-v1`) also cached files from the Vite dev server and kept serving them from the cache after the code changed. Reload the page once with Ctrl+Shift+R, or clear the site data in DevTools (`Application -> Storage -> Clear site data`). This doesn't happen since `ruin-app-shell-v2`.

### The page won't open at http://127.0.0.1:5173

Vite listens on `localhost`, which may resolve to IPv6 only (`::1`). Open http://localhost:5173/, or start the dev server with `--host 127.0.0.1` (see [NPM scripts](#npm-scripts)).

### `npm test` reports "Module <rootDir>/src/test/setup.js ... was not found"

Jest can't cope with a project path that contains a `?` (e.g. the "Are you in?" folder). Vite works around this with `run-vite-safe.mjs`, Jest doesn't - clone or copy the project to a path without special characters and run the tests there.
