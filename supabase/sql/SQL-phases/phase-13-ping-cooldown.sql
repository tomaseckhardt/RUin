-- Phase 13: Ping cooldown + lock down attendee_pings with RLS.
-- Run this after phase-12 on existing databases.
--
-- 1) ping_attendee currently allows exactly one ping ever per (event, target,
--    source name) pair - a repeat ping is rejected forever with "Tohle
--    stouchnuti uz od tebe dorazilo." This changes it to a rolling 10-minute
--    cooldown per pair: you can ping the same person again once 10 minutes
--    have passed since your last ping to them, and again 10 minutes after
--    that, etc. Implemented as a single atomic upsert (ON CONFLICT ... DO
--    UPDATE ... WHERE <cooldown elapsed>) so there is no separate
--    check-then-act race between concurrent requests.
--
-- 2) attendee_pings was created without RLS, unlike every other
--    user-writable table in this app (events, attendees, event_chat_messages
--    all got explicit deny-by-default policies in phase 3). Without RLS, the
--    public anon key can read/insert/update/delete rows in this table
--    directly, bypassing every check ping_attendee() performs (self-ping
--    guard, "only excused attendees" guard, message length cap, and now the
--    10-minute cooldown too). Locking it down the same way as the other
--    tables is required for the cooldown above to actually mean anything.

begin;

create or replace function public.ping_attendee(
  p_event_id text,
  p_target_attendee_id bigint,
  p_source_name text,
  p_message text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_name text := nullif(trim(p_source_name), '');
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_attendee public.attendees%rowtype;
  v_ping_count integer;
begin
  perform public._delete_expired_events();

  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if v_source_name is null then
    raise exception 'Vyplň svoje jméno pro šťouchnutí.';
  end if;

  if v_message is not null and length(v_message) > 280 then
    raise exception 'Zpráva ke šťouchnutí může mít maximálně 280 znaků.';
  end if;

  select *
  into v_attendee
  from public.attendees a
  where a.event_id = p_event_id and a.id = p_target_attendee_id;

  if not found then
    raise exception 'Účastník nebyl nalezen.';
  end if;

  if lower(trim(v_attendee.name)) = lower(v_source_name) then
    raise exception 'Nemůžeš šťouchnout sám sebe.';
  end if;

  if v_attendee.status not in ('excused', 'excused_rejected') then
    raise exception 'Šťouchnout jde jen účastníka, který nejde.';
  end if;

  insert into public.attendee_pings (event_id, target_attendee_id, source_name, message)
  values (p_event_id, p_target_attendee_id, v_source_name, v_message)
  on conflict (event_id, target_attendee_id, lower(source_name))
  do update set
    message = excluded.message,
    created_at = now()
  where public.attendee_pings.created_at <= now() - interval '10 minutes';

  if not found then
    raise exception 'Tuhle osobu můžeš šťouchnout znovu až za 10 minut od posledního šťouchnutí.';
  end if;

  select count(*)::integer
  into v_ping_count
  from public.attendee_pings ap
  where ap.event_id = p_event_id and ap.target_attendee_id = p_target_attendee_id;

  return jsonb_build_object(
    'success', true,
    'pingCount', coalesce(v_ping_count, 0),
    'lastMessage', v_message
  );
end;
$$;

grant execute on function public.ping_attendee(text, bigint, text, text) to anon, authenticated;

alter table public.attendee_pings enable row level security;

drop policy if exists "attendee_pings_select_none" on public.attendee_pings;
drop policy if exists "attendee_pings_insert_none" on public.attendee_pings;
drop policy if exists "attendee_pings_update_none" on public.attendee_pings;
drop policy if exists "attendee_pings_delete_none" on public.attendee_pings;

create policy "attendee_pings_select_none"
  on public.attendee_pings
  for select
  to anon, authenticated
  using (false);

create policy "attendee_pings_insert_none"
  on public.attendee_pings
  for insert
  to anon, authenticated
  with check (false);

create policy "attendee_pings_update_none"
  on public.attendee_pings
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "attendee_pings_delete_none"
  on public.attendee_pings
  for delete
  to anon, authenticated
  using (false);

commit;
