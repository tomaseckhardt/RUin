# RUin

[Čeština](README.md) · **English**

A web RSVP app for planning get-togethers with a group of friends.

The frontend runs as a static app (React + Vite); data and logic live in Supabase (Postgres, RPC functions, RLS, Realtime).

## Contents

- [What the app does](#what-the-app-does)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Requirements](#requirements)
- [Quick start (local)](#quick-start-local)
- [Environment configuration](#environment-configuration)
- [Supabase setup (SQL)](#supabase-setup-sql)
- [NPM scripts](#npm-scripts)
- [Deploying to GitHub Pages](#deploying-to-github-pages)
- [How routing works on Pages](#how-routing-works-on-pages)
- [Push notifications and the service worker](#push-notifications-and-the-service-worker)
  - [Automatic event reminders](#automatic-event-reminders-a-day-and-an-hour-before)
  - [Automatic cleanup of expired events](#automatic-cleanup-of-expired-events-photos-in-storage)
- [Localization (Czech and English)](#localization-czech-and-english)
- [Contributor rules](#contributor-rules)
- [Community standards](#community-standards)
- [Troubleshooting](#troubleshooting)

## What the app does

- create an event (name, place, date and time, description), or talk it through first with a date/place poll — the poll has its own public link and creator link, and once it's decided it creates the real event right away
- collect RSVPs (coming / excuse), optionally with a phone number (depending on the event settings)
- on-site check-in ("📍 I’m here")
- moderate guests and excuses in organizer mode
- a chat for each event, with emoji reactions to messages
- pings/nudges for guests (the same person can be nudged again only after 10 minutes)
- "who brings what" lists and carpooling
- an itinerary for the night (several stops, afterparty included)
- an event photo album with a clickable preview (arrows between photos) and a bulk download of everyone else's photos (one click, as a ZIP, without the ones the signed-in user uploaded themselves)
- a weather forecast for the event's place and time
- adding the event to a calendar (.ics file) and the app to the phone's home screen (PWA)
- sharing the invite (link, QR code, downloadable QR poster)
- push reminders a day and an hour before an event
- a floating button on every page for reporting a bug or suggesting an improvement; all reports are listed at `/feedback` (a public page, no PIN)
- Czech and English — the language is picked from the browser and can be switched with the toggle in the header (see [Localization](#localization-czech-and-english))

## Tech stack

- Frontend: React 19, Vite 8, Tailwind CSS 4, React Router
- Backend: Supabase Postgres + RPC functions + RLS + Realtime
- Client-side ZIP packaging of photos for the bulk download: `jszip`
- Tests: Jest + Testing Library (`client/src/**/*.test.js`), `jest-axe` for a11y assertions in tests, Puppeteer + `axe-puppeteer` for `npm run audit:a11y` against the build
- Deploy: GitHub Actions -> GitHub Pages

## Repository structure

- `client/` - the Vite frontend app
  - `src/pages/` - main screens (creating an event, RSVP detail, event management, creating/viewing a poll)
  - `src/components/` - reusable UI components
  - `src/lib/` - API layer, Supabase client, helpers (including `i18n.js` for translations)
  - `src/locales/` - UI text dictionaries (`cs.js`, `en.js`) and the English wording of the database error messages
  - `src/test/` - shared test helpers and the Jest setup
  - `public/sw.js` - service worker (PWA/push)
- `supabase/sql/all-phases.sql` - the whole database schema, a single SQL file
- `supabase/functions/` - Edge Functions (push reminders, cleanup of expired events)
- `scripts/audit-a11y.mjs` - a11y audit of the built app (Puppeteer + axe-core)
- `.github/workflows/deploy-pages.yml` - CI/CD workflow for GitHub Pages

## Requirements

- Node.js 22+ (recommended)
- npm 10+
- a Supabase project with permissions to create the schema, functions and policies

## Quick start (local)

From the repository root:

```bash
npm install
npm run dev
```

The root `dev` script starts the client from the `client` directory.

## Environment configuration

The app needs a Supabase URL + public key.

Create a `client/.env.local` file:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Notes:

- instead of `VITE_SUPABASE_ANON_KEY` you can also use `VITE_SUPABASE_PUBLISHABLE_KEY`
- without these values the app crashes right at startup (on purpose, so the configuration error is obvious)

## Supabase setup (SQL)

The whole database schema lives in a single file:

```sql
-- run the whole file in the Supabase SQL Editor
supabase/sql/all-phases.sql
```

There are no separate "phases" to put together by hand - `all-phases.sql` is the single source of truth, and every further schema change is made directly in it (not in a new file next to it). It's written to be idempotent (`create table if not exists`, `create or replace function`, `drop policy/trigger if exists` before every `create`, `on conflict do nothing` on the only top-level insert), so it's safe to run the whole file again, even on a project that already has part of the schema - Postgres just skips or replaces whatever already exists.

What `all-phases.sql` contains:

- Base schema: `events`, `attendees`, `attendee_pings`, `event_chat_messages`, RLS on the key tables, RPC functions for create/get event, submit RSVP, ping, moderation and deletion.
- Local date/time without time zone shifts.
- Realtime payload refresh (`event_realtime_ticks` + triggers) when guests/nudges change.
- Optional phone number collection (`events.require_phone`, `attendees.phone`) with normalization and a unique index against duplicate numbers within an event.
- Organizer editing of event details (name, place, date/time).
- Web Push reminders (`push_subscriptions`, `event_reminders_sent`, RPCs for both the client and the Edge Function) - this also needs the Edge Function deployed and scheduled jobs, see [Push notifications and the service worker](#push-notifications-and-the-service-worker).
- Community features: check-in, emoji reactions in the chat, "who brings what" / carpool lists, several stops per night, date/place polls before creating an event (with their own public link and creator link), event photos (Storage bucket `event-photos`).
- Case-insensitive voting in polls.
- Nudges with a repeatable 10-minute cooldown instead of "once, forever" (an atomic `on conflict ... do update ... where`), with RLS on `attendee_pings`.
- Security hardening: `_random_token` via `pgcrypto`/`gen_random_bytes()` instead of the non-cryptographic `random()` (the token is the only authorization for `update_event`/`delete_event`/`delete_attendee`/`moderate_attendee`); `get_event_payload` returns phone numbers only with a valid `p_organizer_token`; a fixed race condition in `moderate_attendee`; a readable message instead of a raw Postgres error on a phone number conflict. Deliberately not addressed: `organizer_token` stays readable (not hashed), because the app can "recover" a forgotten manage link via the PIN, and that isn't possible with a one-way hash without rebuilding the whole recovery flow. The whole identity/authorization model (the app has no auth at all, `organizer_token` is the only exception, RLS must deny everything by default) is written up in [SECURITY_MODEL.md](SECURITY_MODEL.md).
- Deleting photos from Storage when an event goes away (they used to stay there forever without a reference) - manual deletion goes through the client Storage API, automatic deletion after 7 days through `get_expired_event_ids()` and the `cleanup-expired-events` Edge Function (see [Automatic cleanup of expired events](#automatic-cleanup-of-expired-events-photos-in-storage)) - and a lifecycle of their own for polls (an undecided poll expires 14 days after it was created, a decided one is removed automatically together with the event it created).
- Blocking a driver from signing up for their own ride offer + the option to remove a specific passenger from your own offer.
- Feedback (bug reports and ideas): `feedback_reports` + RPCs `submit_feedback_report`/`get_feedback_reports`. Reading them at `/feedback` is deliberately public, without a PIN - anyone at that address sees the name and text of every report.

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
- `npm --prefix client run lint`
- `npm --prefix client run test` - Jest (unit + a11y tests, `*.test.js`)
- `npm --prefix client run test:a11y` - only the tests matching the `a11y` pattern

## Deploying to GitHub Pages

The repo is set up for automatic deployment via the `.github/workflows/deploy-pages.yml` workflow.

### 1. Set the repository variables

In the GitHub repository, open:

`Settings -> Secrets and variables -> Actions -> Variables`

and add:

- `VITE_SUPABASE_URL` = the URL of your Supabase project
- `VITE_SUPABASE_ANON_KEY` = the anon/publishable key

### 2. Enable GitHub Pages via Actions

On GitHub:

`Settings -> Pages -> Source: GitHub Actions`

### 3. Push to the main branch

The workflow is set to:

- run automatically on a push to `main`
- run manually via `workflow_dispatch`

### 4. Check the result

Once the workflow finishes, you'll find the URL in:

- Actions (the Deploy to GitHub Pages job)
- or Settings -> Pages

## How routing works on Pages

The app uses `HashRouter` (`/#/`), which is the right choice for GitHub Pages without a server-side fallback. Thanks to that, direct links to subpages work too.

## Push notifications and the service worker

- the service worker is in `client/public/sw.js`
- the client registers the push SW while the app runs
- the dispatch logic is in Supabase Edge Functions (`supabase/functions/`)

If push notifications don't arrive, the usual cause is missing configuration in Supabase or missing notification permission in the browser.

### Automatic event reminders (a day and an hour before)

After RSVPing, a guest can turn on the "🔔 Remind me a day and an hour before" button in the app — that registers a Web Push subscription for the event. The notification itself is sent by the scheduled Edge Function `send-event-reminders`, which needs a one-time setup:

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

Without steps 3-5, the reminder button shows up in the app and the subscription gets saved, but no notification ever arrives — until the Edge Function runs on a schedule, nothing picks up `get_pending_event_reminders()` and sends them.

### Automatic cleanup of expired events (photos in Storage)

Events that are 7+ days past their date are deleted automatically - but the files themselves in the `event-photos` Storage bucket can't be deleted straight from SQL (this Supabase project rejects that with `"Direct deletion from storage tables is not allowed. Use the Storage API instead."`). Cleaning up the photos is therefore handled by a separate scheduled Edge Function that uses the Storage Admin API:

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

Without this step, expired events (and their DB rows) are still deleted normally after 7 days - only their photos stay in Storage without a reference. Manual deletion (an organizer deletes an event/photo in the app) doesn't depend on this Edge Function - it goes straight through the client Storage API (`client/src/lib/supabase.js`).

## Localization (Czech and English)

The UI comes in two languages. Czech is the source language; English has the same keys.

- On the first visit, the language is picked from the browser (`cs` and `sk` -> Czech, anything else -> English), and it's switched with the CZ | EN toggle in the top-right corner of every page's header. The choice is saved in `localStorage` (`ruin-locale`), and `<html lang>` is set as well.
- The texts live in `client/src/locales/cs.js` and `client/src/locales/en.js`. In a component: `const { t } = useI18n()` and `t('section.key', { param })`; outside React (`lib/`), just import `t` from `client/src/lib/i18n.js`. Plurals are objects keyed by `Intl.PluralRules` category (`{ one, few, other }`); a missing form falls back to `other`.
- Add every new text to both dictionaries - `client/src/lib/i18n.test.js` checks that they have the same keys and the same `{placeholders}`.
- Database error messages (`raise exception` in `all-phases.sql`) stay in Czech; for the English UI, the client translates them by their exact text using `client/src/locales/serverMessages.en.js`. When you add or reword a message in the SQL, add it there too - otherwise the same test fails. Code that branches on a specific message compares the original text from `error.serverMessage`, not the translated `error.message`.
- Push reminders are still in Czech for now: their text is put together by the `send-event-reminders` Edge Function, and the language isn't stored with the subscription.

## Contributor rules

One simple rule applies to external contributors:

- don't push directly to `main`
- always create your own branch
- send changes via a Pull Request to `main`

The workflow details are in [CONTRIBUTING.en.md](CONTRIBUTING.en.md).

## Community standards

Apart from the contributing guide and the license, the documents below are in Czech.

- [Code of conduct](CODE_OF_CONDUCT.md)
- [Contributing](CONTRIBUTING.en.md)
- [Security policy (reporting vulnerabilities)](SECURITY.md)
- [Security model (identity, authorization, RLS)](SECURITY_MODEL.md)
- [License (MIT)](LICENSE)
- [Issue templates](.github/ISSUE_TEMPLATE)
- [Pull request template](.github/pull_request_template.md)

## Troubleshooting

### The GitHub Actions build fails on environment variables

Check that both repository variables are set:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### The app runs locally, but can't find its assets on Pages

Check the base path in the workflow (`VITE_BASE_PATH`). It must match the repository name, typically `/RUin/`.

### RPC calls return permission errors

Usually the RLS/policy layer is missing or doesn't match. Check that all the SQL phases were run in the right order.

### Organizer mode won't open

Event management is tied to the token in the manage URL. Without the right token, organizer actions aren't possible.

### Error "Could not find the function ... in the schema cache"

The client code sends RPC calls with parameters the current database schema doesn't know (typically after a `git pull`, when the latest `all-phases.sql` hasn't been run yet). Run the whole `supabase/sql/all-phases.sql` again - it's idempotent, so it safely adds only what's missing. The frontend and the database schema must always be at the same version.
