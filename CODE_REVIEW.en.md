# Code review – RUin

[Čeština](CODE_REVIEW.md) · **English**

Date: 2026-07-30
Method: an automated multi-agent review across 12 topic areas (RLS/authorization, RPC logic, edge functions, frontend lib, individual pages, components, accessibility, tests/CI, build shell). Every finding of medium severity or higher was independently verified by a second agent that actively tried to refute it.

Result: 91 reported findings → **40 confirmed** (critical/high/medium), **2 refuted**, **48 low-severity** (minor issues that went through without a separate verification step).

Reviewed state: the current contents of the files on disk as of the review date (branch `refactoringBranch`), including uncommitted changes.

---

## Contents

1. [Critical](#critical)
2. [High severity](#high-severity)
3. [Medium severity](#medium-severity)
4. [Low severity / minor issues](#low-severity--minor-issues)
5. [Refuted findings](#refuted-findings)
6. [Recommended order of fixes](#recommended-order-of-fixes)

---

## Critical

### 1. Leak of the poll's secret token (`event_polls`)
**`supabase/sql/all-phases.sql:2818`**

The RLS policy `event_polls_select` has `USING (true)`, so the `event_polls` table (including the `creator_token` column, stored as plaintext) is readable by anyone with the public anon key – unlike `events.organizer_token`, which explicitly has `USING (false)` and is protected solely through SECURITY DEFINER RPCs.

**Failure scenario:** An attacker sends a direct REST request (`.../rest/v1/event_polls?select=id,creator_token`) with the public anon key and gets the `creator_token` of any poll, even someone else's, without ever visiting its link. With that token they call `finalize_event_poll` with their own `organizer_pin` before the real poll creator does, which makes them the organizer of the newly created event and blocks the legitimate creator from deciding the poll themselves.

**Recommendation:** Block direct SELECT on `creator_token` the same way as for `events` (`USING (false)` + access only via `get_poll_payload`/`finalize_event_poll`), or alternatively move the token into a separate table with no public SELECT policy.

---

### 2. "Deleted" photos stay publicly available forever
**`supabase/sql/all-phases.sql:3050`**, **`client/src/components/PhotoGallery.jsx:86`**

For `storage.objects`/the `event-photos` bucket there is only an INSERT and a SELECT RLS policy – no DELETE. `handleDelete` in `PhotoGallery.jsx` calls `storage.remove()` with the anon key, RLS rejects it, the code handles that only as a silent warning, and only the DB row gets deleted. The file stays permanently downloadable at its (albeit unguessable) public URL – the bucket is `public: true`.

**Failure scenario:** The organizer deletes an inappropriate/private photo. The UI shows success, but the photo is physically still in the bucket and available to anyone who knows/guesses/has cached the URL, until the whole event's 7-day expiry (which is only handled by the Edge Function with the service-role key).

**Cross-reference:** The same root cause is also confirmed by the refuted finding about `delete_event` (see [Refuted findings](#refuted-findings)) – manual event deletion in `ManageEventPage.jsx` does *call* `storage.remove()`, but for the same reason (the missing DELETE policy) it probably doesn't work either.

**Recommendation:** Add a DELETE RLS policy tied to `organizer_token` (e.g. via `storage.foldername` + a check against `events.organizer_token`), or move file deletion into an Edge Function with the service-role key, called from `delete_event_photo`.

---

### 3. CI checks nothing at all before deployment
**`.github/workflows/deploy-pages.yml:3`**

The repository's only workflow is triggered just by `push` to `main` and by `workflow_dispatch` – no `pull_request` trigger. The build job only does checkout → install → `npm run build` → deploy. `npm test`, `npm run lint`, `npm run test:a11y` and `npm run audit:a11y` aren't called anywhere, even though all of these scripts exist.

**Failure scenario:** A PR with a broken RSVP form or a lint error gets no automated check at all and goes through human review only; after the merge into `main` it's deployed straight to production GitHub Pages without any automated check.

**Recommendation:** Add a `pull_request` trigger with a separate CI job (lint + test + build) as a required check before merging; in `deploy-pages.yml`, insert `npm run lint` and `npm test` before `npm run build`.

---

### 4. The tests don't actually run at all
**`client/jest.config.js:7`**

`transform: {}` explicitly turns off the default babel-jest transform. Without a custom `babel.config.js`/`.babelrc`, all 3 test files fail right away on the `import` syntax in `src/test/setup.js` (`SyntaxError: Cannot use import statement outside a module`).

**Verified by reproduction:** Running `npm test` (on a copy without special characters in the path) really does end with `Test Suites: 3 failed, 3 total; Tests: 0 total`.

**Recommendation:** Remove `transform: {}` (so the default babel-jest is used), or configure an explicit transformer (babel-jest + `@babel/preset-react`, or `@swc/jest`), and verify that `npm test` actually runs with a non-zero number of tests.

---

## High severity

### 5. RLS doesn't enforce `event_id` on a number of tables
**`supabase/sql/all-phases.sql:1031`** (and `event_signup_items_select:2553`, `event_signup_claims_select:2560`, `event_stops_select:2716`, `event_poll_options_select:2823`, `event_poll_votes_select:2828`, `event_photos_select:3044`, `event_chat_message_reactions_select:2460`, `event_realtime_ticks_select_allowed:1479`)

The SELECT policies on these tables are either literally `USING (true)` or `USING (event_exists(event_id))`, which, thanks to FK+cascade, is trivially true for every existing row. The client-side `.eq('event_id', eventId)` filter in `client/src/lib/api.js` is purely voluntary; the DB doesn't enforce it.

**Failure scenario:** `curl '.../rest/v1/event_chat_messages?select=*'` with the public anon key and no filter returns the chat messages of ALL events in the app at once. In the same way, you can pull the names of drivers/passengers, itineraries, polls and photos across the whole app.

**Recommendation:** Replace these policies with a real restriction to a specific `event_id`, or read exclusively through a parameterized SECURITY DEFINER RPC (`get_event_payload`), as is already done for `push_subscriptions`/`event_reminders_sent`.

---

### 6. Edge Function `send-event-reminders` without authentication
**`supabase/functions/send-event-reminders/index.ts:110`**

`Deno.serve(async () => {...})` doesn't read the request/headers at all. The function is deployed with `--no-verify-jwt`. `SUPABASE_URL` (and therefore the project ref) is publicly visible in the frontend bundle, so anyone can work out the function's URL.

**Failure scenario:** An attacker calls the function repeatedly and concurrently outside the scheduled cron, which, combined with the race condition (see below), leads to duplicate push notifications actually being sent to all subscribers.

**Recommendation:** Add a shared-secret check (a header compared against a value from an env variable) at the start of the handler, with a 401 on mismatch.

---

### 7. `unclaim_signup_item` doesn't verify ownership
**`supabase/sql/all-phases.sql:2650`**

The function deletes from `event_signup_claims` by `lower(attendee_name) = lower(p_attendee_name)` without verifying that the caller really is that guest. `p_attendee_name` is a purely client-supplied string, and the function is `security definer` with a grant to `anon`.

**Failure scenario:** Anyone who knows another guest's publicly visible name (shown right in `SignupBoard`) can call the RPC via devtools/the console and take them off the bring list/carpool without their knowledge. The sister function `remove_signup_claim` does have the same check (ownership of the offer) – here the authors forgot about it.

**Recommendation:** Add a check that the caller provably is that guest (or the holder of `organizer_token`), analogous to `remove_signup_claim`.

---

### 8. Photo upload without server-side type/size validation
**`client/src/lib/api.js:360`**

`uploadEventPhoto` calls `storage.upload()` without any validation. The `event-photos` bucket has neither `file_size_limit` nor `allowed_mime_types` set. The only check (`file.type.startsWith('image/')`) is client-side, in `PhotoGallery.jsx:67`, and is trivially bypassed by calling the JS SDK directly with the public anon key.

*Confirmed independently by two reviewers (lib-layer and components-social).*

**Failure scenario:** An attacker uploads a file of any size or any type into the public bucket under any `event_id` – free public file hosting, a cost/abuse risk.

**Recommendation:** Set `file_size_limit`/`allowed_mime_types` directly on the bucket (Supabase supports this), and possibly also validate in `record_event_photo` as a second layer.

---

### 9. Session identity isn't reset when moving between events
**`client/src/pages/EventPage.jsx:112`**

The app uses `HashRouter` (invite links `#/event/:id`). `name`/`sessionName`/`isIdentityLocked` are initialized only once, through a `useState` lazy initializer – React Router doesn't remount the component just because a URL parameter changes on the same route.

**Failure scenario:** Moving between two invite links in the same tab keeps the identity from the old event. `sessionAttendee` finds no match in the new event, and the user sees "Jsi přihlášený" ("You're signed in")/"Načítám tvůj aktuální stav…" ("Loading your current status…") forever, until they click "Nejsem to já" ("That's not me").

**Recommendation:** Reset the identity-related state in an effect that watches `id`, or force a remount via `key={id}` on `<Route element>`.

---

### 10. The "organizer" identity is guessed from the order in an array
**`client/src/pages/ManageEventPage.jsx:540`**

`const organizerName = attendees[0]?.name || ''` – nothing in the data marks the organizer as such (no `is_organizer` column). When the organizer deletes their own row, `attendees[0]` shifts to a different guest.

**Failure scenario:** The organizer accidentally deletes their own row in the guest list (nothing stops them). `organizerName` silently becomes another person's name – further chat messages, nudges, bring-list sign-ups and uploaded photos made "as the organizer" are then saved under someone else's name.

**Recommendation:** Return the organizer's name as a separate field from `get_event_payload` (stored as early as `create_event`), instead of deriving it from the order.

---

### 11. Modals in event management without a focus trap/Escape/ARIA
**`client/src/pages/ManageEventPage.jsx:700`**

The four modals (nudge, editing the event, unlocking with the PIN, overview) are hand-written `<section className="fixed inset-0...">` instead of the existing `ModalOverlay` component, which handles all of this (and is used in `EventPage.jsx`).

**Failure scenario:** A keyboard user opens a modal – focus doesn't move anywhere, Tab falls through to the content under the modal, Escape closes nothing, and the screen reader doesn't announce that a dialog has opened.

**Recommendation:** Replace all four blocks with the `ModalOverlay` component.

---

### 12. Photo gallery lightbox – the same problem
**`client/src/components/PhotoGallery.jsx:203`**

The lightbox has no `role="dialog"`/`aria-modal`, no focus trap and no focus return; the keyboard handler responds only to the arrow keys, not to Escape.

**Recommendation:** Wrap it in the same `ModalOverlay` component as elsewhere in the app.

---

### 13. `npm run dev` breaks HMR completely
**`client/scripts/run-vite-safe.mjs:26`**

The script copies the whole `client/` into a temporary directory in `/tmp` (`fs.cpSync`) and only then starts `vite dev` there. The Vite watcher tracks the files in `/tmp`, not in the real working tree – syncing back only happens for `build`, never for `dev`.

**Failure scenario:** A developer edits a source file and saves it – Vite doesn't register any change. HMR/live reload doesn't work at all during development; `npm run dev` has to be restarted by hand after every change.

**Recommendation:** Run Vite directly in `clientRoot` and solve the problem with special characters in the path (`Are you in?`) some other way (e.g. a symlink), or implement two-way syncing.

---

### 14. No tests for the key business logic
**`client/src`** (in general)

There are only 3 test files, and all of them only cover the accessibility of two components. `api.js`, `SignupBoard.jsx`, `PollPage.jsx`, `EventPage.jsx`, `ManageEventPage.jsx` – that is, RSVP, claim/unclaim, voting and token-bound organizer actions – don't have a single test.

**Recommendation:** Add unit tests for `lib/api.js` (with a mocked Supabase client) and integration tests for `SignupBoard`, `PollPage`, `EventPage`, `ManageEventPage` – both the happy path and edge cases (a double claim, voting after the poll has closed, RSVP without a token).

---

## Medium severity

### SQL – data integrity

- **`update_event` doesn't delete `event_reminders_sent`** ([`:1906`](supabase/sql/all-phases.sql#L1906)) – moving an event's date silently blocks future push reminders for the new time, because the "already sent" row for the old date stays. *Fix:* delete the corresponding rows when `datetime` changes.
- **`check_in_attendee` doesn't verify the status** ([`:2292`](supabase/sql/all-phases.sql#L2292)) – even an excused guest (`excused`) can be marked as checked in on site. *Fix:* add a check for `a.status = 'confirmed'`.
- **`event_signup_items`/`event_stops` are missing from the realtime publication** ([`:3130`](supabase/sql/all-phases.sql#L3130)) – the client attaches a `postgres_changes` subscription to them, but it stays permanently silent; adding an item to the bring/ride list, or a new stop, doesn't reach the others without a manual refresh. *Fix:* `alter publication supabase_realtime add table ...`.
- **Storage bucket `event-photos` without path restrictions** ([`:3050`](supabase/sql/all-phases.sql#L3050)) – the insert/select policies check only `bucket_id`, not the path/link to an existing event; on top of that, the bucket is `public: true`. *Fix:* restrict the policies to a path matching an existing `event_id`.
- **`toggle_chat_reaction` doesn't verify membership** ([`:2502`](supabase/sql/all-phases.sql#L2502)) – unlike `can_post_event_chat`, it doesn't check that `p_sender_name` matches a real guest, which allows spoofing a reaction under someone else's name. *Fix:* add the same membership check.

### Edge Functions

- **`cleanup-expired-events` likewise without authentication** ([`:91`](supabase/functions/cleanup-expired-events/index.ts#L91)) – lower impact than with the reminders, because `get_expired_event_ids` is time-gated (deleting an active event can't be forced).
- **The find→send→mark sequence isn't atomic** ([`send-event-reminders/index.ts:95`](supabase/functions/send-event-reminders/index.ts#L95)) – concurrent runs can send the same reminder twice. *Fix:* claim via `insert ... on conflict do nothing` BEFORE sending, and send only if the insert actually inserted a row.
- **No try/catch in the main loop** ([`:130`](supabase/functions/send-event-reminders/index.ts#L130)) – an uncaught exception on one reminder stops the processing of all the remaining ones in that run.
- **Serial sending without a concurrency limit/timeout** ([`:69`](supabase/functions/send-event-reminders/index.ts#L69)) – for an event with dozens of subscribers, or with a slow-responding push server, the run time grows linearly, with a risk of an Edge Function timeout.

### Frontend pages

- **`EventPage` – an unnecessary 1s interval without memoization** ([`:147`](client/src/pages/EventPage.jsx#L147)) – re-renders the whole tree (chat, photo gallery, signup boards) every second regardless of whether a cooldown is active; no child component is wrapped in `React.memo`.
- **`ManageEventPage` – an invalid token is detected only on the first load** ([`:197`](client/src/pages/ManageEventPage.jsx#L197)) – neither the periodic refresh nor the actions (moderation, editing, deletion) have this check; the user gets stuck on a non-editable page with a recurring generic toast.
- **`ManageEventPage` – the organizer token is permanently visible as plain text** ([`:681`](client/src/pages/ManageEventPage.jsx#L681)) – without masking or a copy-to-clipboard button; a screenshot of the page gives the token away.
- **`CreatePollPage` doesn't check that the date is in the future** ([`:46`](client/src/pages/CreatePollPage.jsx#L46)) – unlike `CreateEventPage`; a poll with a date that has already passed goes through and, once finalized, creates an event dated in the past.
- **A partially filled-in afterparty is silently discarded** ([`CreateEventPage.jsx:68`](client/src/pages/CreateEventPage.jsx#L68)) – with no toast/error, so the user thinks it was saved.
- **`PollPage` state isn't reset between polls** ([`:26`](client/src/pages/PollPage.jsx#L26)) – the voter's name, the selection and the finalization PIN carry over from the old poll when navigating within the HashRouter.

### Components

- **"Nabídnout výměnu" ("Offer a swap") actually deletes the passenger immediately** ([`SignupBoard.jsx:260`](client/src/components/SignupBoard.jsx#L260)) – without confirmation; the label doesn't match a destructive action.
- **The bulk photo download fails as a whole** ([`PhotoGallery.jsx:117`](client/src/components/PhotoGallery.jsx#L117)) – `Promise.all` is fail-fast; one error throws away even the photos that downloaded successfully. *Fix:* `Promise.allSettled`.
- **Deleting an itinerary stop without confirmation** ([`EventStops.jsx:67`](client/src/components/EventStops.jsx#L67)) – inconsistent with the rest of the app (deleting an event/guest has a `window.confirm`).
- **`ModalOverlay` doesn't lock background scrolling** ([`:92`](client/src/components/ModalOverlay.jsx#L92)) – no `overflow: hidden` on the body when it opens.
- **The time picker doesn't check whether the time has already passed today** ([`EventDateTimePicker.jsx:139`](client/src/components/EventDateTimePicker.jsx#L139)) – the "can't pick the past" check works only at the day level.

### Accessibility

- **Form fields without `htmlFor`/`id` binding** ([`ManageEventPage.jsx:799`](client/src/pages/ManageEventPage.jsx#L799)) – PIN, event name, location, nudge message; the screen reader falls back to the placeholder instead of the label.
- **Chat without `aria-live`** ([`EventChat.jsx:286`](client/src/components/EventChat.jsx#L286)) – new messages from the realtime subscription aren't announced to screen reader users at all.
- **`role="radiogroup"` without roving tabindex/arrow keys** ([`EventPage.jsx:764`](client/src/pages/EventPage.jsx#L764)) – on the attendance status picker; violates the ARIA APG radiogroup pattern.

### CI

- **The `lint` script isn't called anywhere** ([`deploy-pages.yml:30`](.github/workflows/deploy-pages.yml#L30)).
- **`test:a11y`/`audit:a11y` run only locally** ([`client/package.json:11`](client/package.json#L11)) – never in CI.

### Build

- **No SIGINT/SIGTERM handler** ([`run-vite-safe.mjs:44`](client/scripts/run-vite-safe.mjs#L44)) – Ctrl+C during `npm run dev` can leave an orphaned copy of the project in `/tmp`, including `.env.local`; reproduced experimentally.

---

## Low severity / minor issues

These findings weren't individually verified by a second agent (their impact is smaller), but they're backed by specific code.

**Input validation**
- No upper length limit for names/titles/descriptions in `CreateEventPage.jsx:295`, `CreatePollPage.jsx:87`
- `CreateEventPage.jsx:320` – `required` without `.trim()` lets through a value made up only of spaces
- `add_signup_item` (`all-phases.sql:2600`) doesn't check the upper capacity limit (the CHECK constraint then throws a raw DB error)
- `create_event_poll` (`:3877`) doesn't validate that every item contains both a location and a datetime
- `vote_event_poll` (`:3945`) can be called even after the poll has been finalized

**Race conditions / consistency**
- `add_event_stop` (`:2722`) computes the position without a lock (read-then-write)
- `finalize_event_poll` (`:3994`) calls the cleanup of expired polls at its very start, so it can delete the very poll being finalized
- Timing-unsafe comparison of `organizer_token`/`creator_token` (`<>`/`=` instead of constant-time), across RPC functions (`:3785`)
- `unregister_push_subscription` (`:2165`) cancels a subscription by endpoint only, with no tie to event_id
- `register_push_subscription` (`:2132`) overwrites the event_id of an existing subscription based on the endpoint

**Duplicate code to refactor**
- PIN input duplicated between `CreateEventPage.jsx:305` and `PollPage.jsx`
- Confetti implemented twice, independently – `ConfettiBurst.jsx` vs `RsvpCelebration.jsx`
- Base path computation duplicated in `format.js:1` and `push.js`
- Mobile detection duplicated in `AddToHomeButton.jsx:38` and `AddToCalendarButton.jsx`
- Three nearly identical fetch blocks in `ManageEventPage.jsx:79` (loadEvent, the hydrate effect, the periodic refresh)
- `loadEvent`/`hydrateEvent` duplication in `EventPage.jsx:269`
- The "Party" button styling copy-pasted between `CreateEventPage.jsx:360` and `CreatePollPage.jsx`
- A set of four buttons duplicated for mobile/desktop in `ManageEventPage.jsx:571`

**Minor correctness bugs**
- The `.ics` generator (`AddToCalendarButton.jsx:97`) bypasses the shared `parseLocalDateTime`
- The file extension on upload is taken with a naive `file.name.split('.').pop()` (`api.js:361`) – without a dot it returns the whole name; on top of that, it can bring a `/` into the path
- `wrapCanvasText` (`qrPoster.js:46`) doesn't wrap the last line outside the main loop
- `PageShell.jsx:21` permanently saves the derived system theme to localStorage, and the app then stops reacting when it changes
- `EventDateTimePicker.jsx:52` doesn't handle the gap created by the switch to daylight saving time
- The color contrast of the day labels in the calendar is below WCAG AA (`EventDateTimePicker.jsx:221`, approx. 2.6:1); the same pattern also appears in `SignupBoard.jsx`/`EventChat.jsx`
- `organizerLinkStorage.js:115` – eviction is FIFO by insertion, not LRU by use
- `weather.js:135` doesn't check `Number.isFinite` before `Math.round`
- `callRpc` (`api.js:6`) passes on the raw DB error message without distinguishing it from a deliberate application exception
- Inconsistent `Number()` casting of IDs before RPC calls (`api.js:67`)
- `uploadEventPhoto`/`recordEventPhoto` (`api.js:372`) – with no compensating rollback, a failure of the second step leaves an orphaned file in storage
- The ZIP photo download (`PhotoGallery.jsx:115`) has no limit on count/size, and everything is held in memory at once
- `send-event-reminders/index.ts:89` – permanently dead push subscriptions (an error code other than 404/410) are never cleaned up
- `cleanup-expired-events/index.ts:81` – try/catch only around `listAllPhotoNames`, not around `storage.remove()`/the main loop

**Minor accessibility issues**
- The "+" button for reactions (`EventChat.jsx:330`) has no `aria-label`/`aria-expanded`, and reactions have no `aria-pressed`

**Minor CI/build issues**
- `npm i --legacy-peer-deps` instead of `npm ci` in `deploy-pages.yml:38`, even though the lockfile is cached
- `eslint-plugin-jsx-a11y` is missing in `eslint.config.js:11`
- `collectCoverageFrom` is configured, but coverage isn't collected/enforced anywhere (`jest.config.js:9`)
- `sw.js:40` – the push handler parses `event.data.json()` without try/catch
- Unused `manifest.webmanifest`/`favicon.svg` in `client/public/`
- Unused `server.proxy` section in `vite.config.js:11`

---

## Refuted findings

Two findings didn't hold up after verification:

1. **"`delete_event` never deletes photos from Storage"** – In fact, `ManageEventPage.jsx` (`handleDelete`) calls `storage.remove()` client-side before deleting the event – this is a documented architectural pattern (SQL/plpgsql can't call the Storage HTTP API). The finding described the architecture incorrectly. However, the verifying agent also pointed out that the missing DELETE RLS policy (see [critical finding #2](#2-deleted-photos-stay-publicly-available-forever)) means this call probably doesn't actually work – so this is a different, more specific problem that has already been captured.
2. **"The name in the RSVP form isn't trimmed, HTML5 `required` doesn't prevent submitting nothing but spaces"** – The client-side description is accurate, but the backend RPC `submit_rsvp` itself does `nullif(trim(p_name), '')` and throws an exception when the result is empty – the insert into the DB never happens. The impact is purely cosmetic (an error message instead of immediate client-side validation), not a data-integrity problem.

---

## Recommended order of fixes

1. RLS on `event_polls` + on the rest of the tables with `USING(true)`/trivially true policies (critical data and token leaks)
2. Storage DELETE policy for `event-photos`
3. Auth guard on both Edge Functions (`send-event-reminders`, `cleanup-expired-events`)
4. Fix `jest.config.js` + wire the tests/lint/a11y audit into CI (`pull_request` trigger)
5. `unclaim_signup_item` ownership check
6. The rest of the high-severity items (organizer identity, session identity reset, modal a11y, HMR), as team capacity allows
7. Gradual cleanup of the medium/low items, prioritizing data-integrity and UX regressions (the afterparty getting silently discarded, deletion without confirmation)
