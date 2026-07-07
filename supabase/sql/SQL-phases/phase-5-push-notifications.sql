-- Phase 5: Realtime updates for attendee pings and event payload changes.
-- Run this after the previous phases on existing databases.

begin;

create table if not exists public.event_realtime_ticks (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  reason text not null check (reason in ('event', 'attendee', 'ping')),
  created_at timestamptz not null default now()
);

create index if not exists event_realtime_ticks_event_created_idx
  on public.event_realtime_ticks (event_id, created_at desc);

drop trigger if exists event_chat_messages_enqueue_push_tg on public.event_chat_messages;
drop trigger if exists attendee_pings_enqueue_push_tg on public.attendee_pings;

drop function if exists public.enqueue_push_notification_from_chat();
drop function if exists public.enqueue_push_notification_from_ping();
drop function if exists public.claim_push_notification_jobs(integer);
drop function if exists public.get_push_subscription_status(text, text);
drop function if exists public.unregister_push_subscription(text, text);
drop function if exists public.register_push_subscription(text, text, text, text, text, timestamptz, text);

drop table if exists public.push_notification_jobs;
drop table if exists public.push_subscriptions;

create or replace function public.emit_event_realtime_tick(
  p_event_id text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_event_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.events e
    where e.id = p_event_id
  ) then
    return;
  end if;

  insert into public.event_realtime_ticks (event_id, reason)
  values (p_event_id, p_reason);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_attendees()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_event_realtime_tick(coalesce(new.event_id, old.event_id), 'attendee');
  return coalesce(new, old);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_event_realtime_tick(coalesce(new.id, old.id), 'event');
  return coalesce(new, old);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_pings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_event_realtime_tick(new.event_id, 'ping');
  return new;
end;
$$;

drop trigger if exists attendees_emit_event_realtime_tick_tg on public.attendees;
create trigger attendees_emit_event_realtime_tick_tg
after insert or update or delete on public.attendees
for each row
execute function public.emit_event_realtime_tick_from_attendees();

drop trigger if exists events_emit_event_realtime_tick_tg on public.events;
create trigger events_emit_event_realtime_tick_tg
after update or delete on public.events
for each row
execute function public.emit_event_realtime_tick_from_events();

drop trigger if exists attendee_pings_emit_event_realtime_tick_tg on public.attendee_pings;
create trigger attendee_pings_emit_event_realtime_tick_tg
after insert on public.attendee_pings
for each row
execute function public.emit_event_realtime_tick_from_pings();

alter table public.event_realtime_ticks enable row level security;

drop policy if exists "event_realtime_ticks_select_allowed" on public.event_realtime_ticks;
drop policy if exists "event_realtime_ticks_insert_none" on public.event_realtime_ticks;
drop policy if exists "event_realtime_ticks_update_none" on public.event_realtime_ticks;
drop policy if exists "event_realtime_ticks_delete_none" on public.event_realtime_ticks;

create policy "event_realtime_ticks_select_allowed"
  on public.event_realtime_ticks
  for select
  to anon, authenticated
  using (public.event_exists(event_realtime_ticks.event_id));

create policy "event_realtime_ticks_insert_none"
  on public.event_realtime_ticks
  for insert
  to anon, authenticated
  with check (false);

create policy "event_realtime_ticks_update_none"
  on public.event_realtime_ticks
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "event_realtime_ticks_delete_none"
  on public.event_realtime_ticks
  for delete
  to anon, authenticated
  using (false);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'attendee_pings'
     ) then
    execute 'alter publication supabase_realtime add table public.attendee_pings';
  end if;

  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'event_realtime_ticks'
     ) then
    execute 'alter publication supabase_realtime add table public.event_realtime_ticks';
  end if;
end;
$$;

commit;
