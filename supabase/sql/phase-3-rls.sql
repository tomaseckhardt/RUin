-- Phase 3: RLS hardening
-- Goal: block direct table access from anon/authenticated and allow app flow through RPC only.

begin;

alter table public.events enable row level security;
alter table public.attendees enable row level security;
alter table public.event_chat_messages enable row level security;

-- Optional cleanup if you iterate on policies repeatedly.
drop policy if exists "events_select_none" on public.events;
drop policy if exists "events_insert_none" on public.events;
drop policy if exists "events_update_none" on public.events;
drop policy if exists "events_delete_none" on public.events;

drop policy if exists "attendees_select_none" on public.attendees;
drop policy if exists "attendees_insert_none" on public.attendees;
drop policy if exists "attendees_update_none" on public.attendees;
drop policy if exists "attendees_delete_none" on public.attendees;

drop policy if exists "event_chat_select_allowed" on public.event_chat_messages;
drop policy if exists "event_chat_insert_allowed" on public.event_chat_messages;
drop policy if exists "event_chat_update_none" on public.event_chat_messages;
drop policy if exists "event_chat_delete_none" on public.event_chat_messages;

-- Explicit deny policies keep intent clear in dashboard.
create policy "events_select_none"
  on public.events
  for select
  to anon, authenticated
  using (false);

create policy "events_insert_none"
  on public.events
  for insert
  to anon, authenticated
  with check (false);

create policy "events_update_none"
  on public.events
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "events_delete_none"
  on public.events
  for delete
  to anon, authenticated
  using (false);

create policy "attendees_select_none"
  on public.attendees
  for select
  to anon, authenticated
  using (false);

create policy "attendees_insert_none"
  on public.attendees
  for insert
  to anon, authenticated
  with check (false);

create policy "attendees_update_none"
  on public.attendees
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "attendees_delete_none"
  on public.attendees
  for delete
  to anon, authenticated
  using (false);

create policy "event_chat_select_allowed"
  on public.event_chat_messages
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.events e
      where e.id = event_chat_messages.event_id
    )
  );

create policy "event_chat_insert_allowed"
  on public.event_chat_messages
  for insert
  to anon, authenticated
  with check (
    exists (
      select 1
      from public.events e
      where e.id = event_chat_messages.event_id
    )
    and length(trim(sender_name)) between 1 and 80
    and length(trim(message)) between 1 and 500
  );

create policy "event_chat_update_none"
  on public.event_chat_messages
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "event_chat_delete_none"
  on public.event_chat_messages
  for delete
  to anon, authenticated
  using (false);

commit;
