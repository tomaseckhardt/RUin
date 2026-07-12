-- Phase 10: Web Push subscriptions + scheduled event reminders (day-before / hour-before).
-- Run this after the previous phases on existing databases.
--
-- Assumes all events.datetime values are wall-clock time in Europe/Prague (same
-- assumption the client already makes when formatting/parsing datetimes).
--
-- After running this migration you still need to:
--   1. Generate a VAPID key pair (see README notes) and store it as Edge Function secrets.
--   2. Deploy the `send-event-reminders` Edge Function.
--   3. Schedule it to run periodically (pg_cron + pg_net, or Supabase's dashboard Cron Jobs).

begin;

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_event_idx
  on public.push_subscriptions (event_id);

create table if not exists public.event_reminders_sent (
  event_id text not null references public.events(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('day_before', 'hour_before')),
  sent_at timestamptz not null default now(),
  primary key (event_id, reminder_type)
);

alter table public.push_subscriptions enable row level security;
alter table public.event_reminders_sent enable row level security;

drop policy if exists "push_subscriptions_no_direct_access" on public.push_subscriptions;
create policy "push_subscriptions_no_direct_access"
  on public.push_subscriptions
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "event_reminders_sent_no_direct_access" on public.event_reminders_sent;
create policy "event_reminders_sent_no_direct_access"
  on public.event_reminders_sent
  for all
  to anon, authenticated
  using (false)
  with check (false);

-- Guests/organizers only ever go through these two RPCs; direct table access stays
-- locked down (RLS above) so subscriptions can't be listed, scraped, or forged.

create or replace function public.register_push_subscription(
  p_event_id text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if nullif(trim(p_endpoint), '') is null
     or nullif(trim(p_p256dh), '') is null
     or nullif(trim(p_auth), '') is null then
    raise exception 'Neplatné přihlášení k odběru notifikací.';
  end if;

  insert into public.push_subscriptions (event_id, endpoint, p256dh, auth)
  values (p_event_id, trim(p_endpoint), trim(p_p256dh), trim(p_auth))
  on conflict (endpoint) do update
    set event_id = excluded.event_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.unregister_push_subscription(
  p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions where endpoint = trim(p_endpoint);
  return jsonb_build_object('success', true);
end;
$$;

-- Called by the send-event-reminders Edge Function (service role, bypasses RLS).
-- Returns events that just crossed the 24h-before or 1h-before mark and haven't
-- had that reminder type sent yet.
create or replace function public.get_pending_event_reminders()
returns table (
  event_id text,
  reminder_type text,
  name text,
  location text,
  datetime timestamp without time zone
)
language sql
security definer
set search_path = public
as $$
  with now_local as (
    select (now() at time zone 'Europe/Prague') as ts
  )
  select e.id, 'day_before', e.name, e.location, e.datetime
  from public.events e, now_local
  where e.datetime <= now_local.ts + interval '24 hours'
    and e.datetime > now_local.ts
    and not exists (
      select 1 from public.event_reminders_sent r
      where r.event_id = e.id and r.reminder_type = 'day_before'
    )
  union all
  select e.id, 'hour_before', e.name, e.location, e.datetime
  from public.events e, now_local
  where e.datetime <= now_local.ts + interval '1 hour'
    and e.datetime > now_local.ts
    and not exists (
      select 1 from public.event_reminders_sent r
      where r.event_id = e.id and r.reminder_type = 'hour_before'
    );
$$;

create or replace function public.mark_event_reminder_sent(
  p_event_id text,
  p_reminder_type text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.event_reminders_sent (event_id, reminder_type)
  values (p_event_id, p_reminder_type)
  on conflict (event_id, reminder_type) do nothing;
$$;

create or replace function public.get_push_subscriptions_for_event(
  p_event_id text
)
returns table (
  endpoint text,
  p256dh text,
  auth text
)
language sql
security definer
set search_path = public
as $$
  select endpoint, p256dh, auth
  from public.push_subscriptions
  where event_id = p_event_id;
$$;

create or replace function public.delete_push_subscription_by_endpoint(
  p_endpoint text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint;
$$;

grant execute on function public.register_push_subscription(text, text, text, text) to anon, authenticated;
grant execute on function public.unregister_push_subscription(text) to anon, authenticated;

-- The remaining functions are only meant to be called by the Edge Function using
-- the service role key, which bypasses grants entirely, but we scope grants to
-- service_role explicitly for clarity and to keep them out of anon/authenticated.
revoke all on function public.get_pending_event_reminders() from public;
revoke all on function public.mark_event_reminder_sent(text, text) from public;
revoke all on function public.get_push_subscriptions_for_event(text) from public;
revoke all on function public.delete_push_subscription_by_endpoint(text) from public;

grant execute on function public.get_pending_event_reminders() to service_role;
grant execute on function public.mark_event_reminder_sent(text, text) to service_role;
grant execute on function public.get_push_subscriptions_for_event(text) to service_role;
grant execute on function public.delete_push_subscription_by_endpoint(text) to service_role;

commit;
