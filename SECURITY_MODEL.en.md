# RUin security model

[Čeština](SECURITY_MODEL.md) · **English**

This document describes how the app handles (and doesn't handle) identity and
authorization. It used to be tribal knowledge in the heads of the people around
the project plus the list of mistakes already found in
[CODE_REVIEW.en.md](CODE_REVIEW.en.md) - this is an attempt to write it down
properly once, so the same mistakes don't come back in new code.

It isn't the same as [SECURITY.en.md](SECURITY.en.md) - that one describes where
to privately report a vulnerability you've found. This document describes the
architecture and the mental model that everyone adding a new table, RPC function
or endpoint needs to keep in mind.

## In a nutshell

- There's no authentication in the app. Supabase Auth isn't used at all.
- The only "identity" of guests is the name everyone types into the form
  themselves. Two different people can both type "Peter", and the app can't
  tell them apart.
- The exception is random tokens that act as bearer credentials:
  `organizer_token` (event management), `event_polls.creator_token` (deciding a
  poll) and `owners.token` (contact groups and event templates). Whoever has the
  token has the role, full stop.
- Because the client has nothing stronger than "I typed my name" or "I have this
  token", **RLS on every table must deny everything by default**, and **all
  authorization is checked inside SECURITY DEFINER RPC functions**, not through
  a client-side filter.

## 1. No authentication - identity is just a self-declared name

RUin doesn't use Supabase Auth, user accounts, passwords or session tokens tied
to a user. The guest's name in the RSVP form, the sender's name in the chat, the
name in the "who brings what" list, the name on a nudge (ping) - all of it is
plain text that the author typed into an input, and the app saves it without
any verification.

The consequence: if two people at the same event type the same name (on purpose
or by accident), the app can't tell them apart in the data. Anyone who knows (or
guesses) the name of another guest, visible publicly on the event page, can in
theory call the same RPC under that name - that isn't a bug that can be "fixed"
in one function, it's a consequence of the app having no auth layer at all. A
concrete example where this difference (between "checking that a field doesn't
play two roles" and "actually verifying identity") came up is described right
in the code at `unclaim_signup_item` (the "Realtime read hardening" phase,
`supabase/sql/all-phases.sql`) - it's worth reading as a precise statement of
this model's limits.

What this means for new code: never assume that `p_attendee_name`,
`p_sender_name` etc. prove who actually made the call. They're just a label the
caller made up.

## 2. The exception: tokens as bearer credentials

### Organizer: `organizer_token` and the admin PIN

An event's organizer has no account or password - they just have **the event
management link** (`.../#/event/:eventId/manage?token=...`). That `token` is a
random string (`_random_token()` via `pgcrypto`/`gen_random_bytes()`, see the
"Security hardening" phase), stored in `events.organizer_token` and sent in the
link's query string in plain text.

The key property: **whoever has this URL is the organizer** - no session, no
cookie, no tie to a device. The token is passed as a parameter to the RPC
functions (`p_token`/`p_organizer_token`), and the function compares it with the
value stored for the event. After management is opened for the first time, the
client saves the token in `localStorage` (`ruin-organizer-tokens`, the last 30
events) and removes it from the address bar - so whoever has access to that
browser is the organizer too.

Someone without the link can unlock management with the 4-digit admin PIN the
organizer picks when creating the event (`get_organizer_path_with_pin`). The PIN
is stored as a bcrypt hash (`events.organizer_pin_hash`), and since 4 digits are
only 10,000 combinations, it locks after wrong attempts: after 5 for 15 minutes,
after 10 for an hour, after 15 for 24 hours.

The token is deliberately stored as readable plain text, not as a one-way hash.
That's a conscious trade-off, not an oversight - the "forgot the management link?
enter the PIN" flow returns **the original token back to the user** after
verifying the PIN, so they can open event management again. That isn't possible
with a one-way hash - a hash can't be turned back into the original. Exactly this
trade-off (and why fixing it would mean rebuilding the whole recovery flow, not
just one function) is documented in the comment on phase 14
(`-- Phase 14: Security/correctness hardening...`) in
`supabase/sql/all-phases.sql`.

### Poll creator: `event_polls.creator_token`

The same principle (the token is verified on the server against the stored one,
no session) applies to `event_polls.creator_token` for events that haven't been
created yet (date/place polls) - the creator's link looks like
`.../#/poll/:pollId?token=...`.

### Groups and templates: `owners.token`, phone and a 6-digit code

Contact groups and event templates belong to an "owner" (the `owners` table),
who is identified by a phone number and a 6-digit code through
`access_owner_account(name, phone, code)`. It's one function for both signing in
and signing up: if an account with the given (normalized) phone exists, it
verifies the code, otherwise it creates the account. The code is stored as a
bcrypt hash (`owners.code_hash`), with the same lock after wrong attempts as the
PIN. The function returns `ownerId` and `token`, the client saves them in
`localStorage` (`ruin-owner-identity`), and every RPC for groups and templates
verifies them (`v_owner.token <> p_token`). The token doesn't change on later
sign-ins.

## 3. Therefore: RLS must deny everything by default, and RPCs check authorization themselves

Because the client has nothing stronger to prove identity or ownership with than
a token or a name it sends itself, **that claim must not be trusted at the Row
Level Security policy level**. If RLS relied on the client sending the right
`event_id` filter, or on "nobody's going to ask for other people's data anyway",
a direct REST query with the public anon key (it's publicly visible in the
frontend bundle) outside the app, without a filter, is all it takes, and
authorization is gone.

The established pattern in `supabase/sql/all-phases.sql` is:

- SELECT/INSERT/UPDATE/DELETE policies for `anon`/`authenticated` on sensitive
  tables are `using (false)` (or `with check (false)`) - no direct access from
  the client is allowed at all. They're easy to find:

  ```bash
  grep -n "using (false)" supabase/sql/all-phases.sql
  ```

- All reads and writes go through `SECURITY DEFINER` RPC functions
  (`language plpgsql security definer set search_path = public`), which check
  authorization **themselves, inside the function body** - typically by
  comparing a caller-supplied token with the value stored in the database, not
  by accepting the client's claim as a fact. An example from
  `moderate_attendee`:

  ```sql
  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;
  ```

  The same pattern (look for the line `v_event.organizer_token <> p_token`,
  `v_poll.creator_token <> p_token` or `v_owner.token <> p_token` and an
  exception with a Czech message) is used by `delete_event`, `update_event`,
  `finalize_event_poll`, the RPCs for groups and templates and others - whenever
  a function changes or reveals something tied to an event, a poll or an owner,
  the first thing it does is this comparison check.

Why this matters so much has its own story in the app, not just theory: the
"Realtime read hardening" phase (`-- ==================== Realtime read
hardening ====================` in `supabase/sql/all-phases.sql`) describes
exactly this kind of bug, found and fixed on nine tables at once
(`event_polls`/`event_poll_options`/`event_poll_votes`, `event_photos`,
`event_chat_messages`/`event_chat_message_reactions`,
`event_signup_items`/`event_signup_claims`, `event_stops`) - the policies were
`using (true)` or `using (event_exists(event_id))` (which, thanks to the FK, is
trivially true for every existing row), so a direct REST query without an
`event_id` filter could read the chat, photos, polls and lists of ALL events in
the app at once, not just the one the caller has a link to. The comment on that
phase is worth reading in full - it also explains why the tables with realtime
subscriptions (chat, signup lists, stops) couldn't simply be locked down to
`using (false)`, and an RPC layer plus a switch to the "listen to
`event_realtime_ticks`, then fetch the data again" pattern had to be introduced.

## 4. The rule for new code

When you add a new table or RPC function:

1. **Never trust an `event_id`, token or name sent by the client as proof of
   identity or ownership on its own.** It's just an input parameter, not a
   verified fact.
2. A new table has `using (false)` (and `with check (false)` for writes) by
   default on SELECT/INSERT/UPDATE/DELETE for `anon`/`authenticated`, until
   there's a concrete reason otherwise.
3. Reads and writes go through a `SECURITY DEFINER` RPC that:
   - is `language plpgsql security definer set search_path = public`,
   - checks authorization inside its body - typically `if v_event.organizer_token
     <> p_token then raise exception '...'` (or similar scoping by `event_id`),
     exactly like `moderate_attendee`/`delete_event`/`update_event`,
   - ends with `grant execute on function public.fn_name(...) to anon,
     authenticated;`.
4. If a function changes an existing signature (adds/removes/renames a
   parameter), it needs `drop function if exists public.fn_name(old, types);`
   in front of it - see the general convention described at the top of
   `all-phases.sql` (and [CONTRIBUTING.en.md](CONTRIBUTING.en.md) on how to
   contribute to the schema).
5. Error messages inside RPCs are always in Czech, understandable for the end
   user (`raise exception 'Neplatný organizátorský odkaz.'`), never a raw
   Postgres error. For the English UI, the client translates them by their
   exact text, so add every new message to
   `client/src/locales/serverMessages.en.js` as well (enforced by
   `client/src/test/i18n.test.js`). When the client decides something based on
   a specific message, it has to compare `error.serverMessage` (the original
   text), not the translated `error.message`.

If you're not sure whether something is "fine to check on the client" - it
isn't. The client code in `client/src/lib/api.js` (the only place allowed to
call `supabase.rpc(...)`) is just a thin layer over the RPCs; the only place
where authorization is actually enforced is the body of a SECURITY DEFINER
function in `supabase/sql/all-phases.sql`.

## What this model doesn't address (on purpose)

- Name spoofing between guests of the same event - the app has no way to verify
  that the "Peter" calling an RPC is the same "Peter" who RSVPed earlier. This
  can't be fixed without a fundamental auth rebuild, only mitigated (see point 1
  above).
- Losing/sharing the manage link = losing/sharing the organizer role - whoever
  has the URL with the token is the organizer, even if it's an accidentally
  forwarded link. The same goes for tokens saved in `localStorage` on a shared
  or someone else's computer.
- The groups-and-templates account is tied to a phone number that isn't
  verified in any way (no SMS) - whoever registers a number first owns the
  account for it. The name is simply overwritten on sign-in.
- `/feedback` is public on purpose - anyone can read every report, names
  included (phase 21 in `all-phases.sql`).
- Other specific findings (a missing ownership check in one RPC, missing
  server-side upload validation, etc.) are tracked as issues/findings in
  [CODE_REVIEW.en.md](CODE_REVIEW.en.md), not duplicated here - this document
  describes the model, not the current list of bugs.
