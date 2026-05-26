-- Phase 3: RLS hardening
-- Goal: block direct table access from anon/authenticated and allow app flow through RPC only.

begin;

alter table public.events enable row level security;
alter table public.attendees enable row level security;

-- Optional cleanup if you iterate on policies repeatedly.
drop policy if exists "events_select_none" on public.events;
drop policy if exists "events_insert_none" on public.events;
drop policy if exists "events_update_none" on public.events;
drop policy if exists "events_delete_none" on public.events;

drop policy if exists "attendees_select_none" on public.attendees;
drop policy if exists "attendees_insert_none" on public.attendees;
drop policy if exists "attendees_update_none" on public.attendees;
drop policy if exists "attendees_delete_none" on public.attendees;

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

commit;
