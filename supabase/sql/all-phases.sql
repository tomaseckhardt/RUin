-- ============================================================
-- RUin: all-phases.sql
--
-- This is the entire database schema - the single source of truth. Run it
-- in full in the Supabase SQL Editor, on a fresh project or an existing one;
-- it's idempotent (create table/index/extension use "if not exists",
-- policies/triggers are dropped before being recreated, the one top-level
-- insert uses "on conflict do nothing"), so re-running it is always safe and
-- will only apply whatever's missing.
--
-- There are no separate per-change files anymore - when the schema changes,
-- this file is edited directly. The section headers below still group
-- statements by the feature/fix that introduced them (useful history), but
-- none of them are standalone files you can run individually.
-- ============================================================

-- ==================== Base schema ====================
-- Phase 1: Base schema in Supabase (Postgres)
-- Mirrors current SQLite model from server/src/db.js

begin;

create table if not exists public.events (
  id text primary key,
  name text not null,
  location text not null,
  datetime timestamp without time zone not null,
  description text not null,
  organizer_token text not null unique,
  organizer_pin_hash text not null,
  organizer_pin_failed_attempts integer not null default 0,
  organizer_pin_locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.attendees (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  status text not null check (
    status in ('confirmed', 'excused', 'excused_accepted', 'excused_rejected')
  ),
  excuse_reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.attendee_pings (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  target_attendee_id bigint not null references public.attendees(id) on delete cascade,
  source_name text not null,
  message text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_chat_messages (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  sender_name text not null check (length(trim(sender_name)) between 1 and 80),
  message text not null check (length(trim(message)) between 1 and 500),
  created_at timestamptz not null default now()
);

create or replace function public.normalize_event_chat_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sender_name := trim(new.sender_name);
  new.message := trim(new.message);
  return new;
end;
$$;

drop trigger if exists event_chat_messages_normalize_tg on public.event_chat_messages;
create trigger event_chat_messages_normalize_tg
before insert or update on public.event_chat_messages
for each row
execute function public.normalize_event_chat_message();

-- Enforce one RSVP per attendee name in the same event, case-insensitive.
create unique index if not exists attendees_event_id_name_lower_uidx
  on public.attendees (event_id, lower(name));

create index if not exists attendees_event_id_idx
  on public.attendees (event_id);

create index if not exists attendees_event_id_status_idx
  on public.attendees (event_id, status);

create unique index if not exists attendee_pings_event_target_source_uidx
  on public.attendee_pings (event_id, target_attendee_id, lower(source_name));

create index if not exists attendee_pings_event_target_idx
  on public.attendee_pings (event_id, target_attendee_id);

create index if not exists event_chat_messages_event_created_idx
  on public.event_chat_messages (event_id, created_at asc);

create index if not exists event_chat_messages_created_idx
  on public.event_chat_messages (created_at desc);

create index if not exists events_created_at_idx
  on public.events (created_at desc);

create index if not exists events_datetime_idx
  on public.events (datetime);

grant select, insert on table public.event_chat_messages to anon, authenticated;
grant usage, select on sequence public.event_chat_messages_id_seq to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'event_chat_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.event_chat_messages';
  end if;
end;
$$;

commit;

-- ==================== Core RPC functions ====================
-- Phase 2: RPC functions that replace server/src/routes/events.js
-- These functions keep the same behavior and Czech error messages as the current backend.

begin;

create extension if not exists pgcrypto;

alter table if exists public.attendee_pings
  add column if not exists message text;

drop function if exists public.create_event(text, text, timestamptz, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text, text, text);
drop function if exists public.ping_attendee(text, bigint, text);
drop function if exists public.ping_attendee(text, bigint, text, text);
drop function if exists public.delete_attendee(text, bigint, text);

-- Re-running this whole file on a database that already has phase 14's
-- _random_token(p_token_length integer) applied would otherwise hit the same
-- "cannot change name of input parameter" error phase 14 works around, just
-- in the opposite direction (p_token_length -> token_length). Drop first so
-- a full top-to-bottom re-run is idempotent either way.
drop function if exists public._random_token(integer);

create or replace function public._random_token(token_length integer)
returns text
language plpgsql
as $$
declare
  chars constant text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  result text := '';
  i integer;
begin
  if token_length is null or token_length < 1 then
    raise exception 'Neplatná délka tokenu.';
  end if;

  for i in 1..token_length loop
    result := result || substr(chars, floor(random() * length(chars) + 1)::integer, 1);
  end loop;

  return result;
end;
$$;

create or replace function public._delete_expired_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.events e
  where e.datetime + interval '7 days' < now()::timestamp;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.get_event_payload(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendees jsonb;
  v_summary jsonb;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Tahle akce už neexistuje.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'event_id', a.event_id,
        'name', a.name,
        'status', a.status,
        'excuse_reason', a.excuse_reason,
        'created_at', a.created_at,
        'ping_count', coalesce(p.ping_count, 0),
        'ping_last_source_name', p.last_source_name,
        'ping_last_message', p.last_message,
        'ping_last_created_at', p.last_created_at
      )
      order by
        case a.status
          when 'confirmed' then 1
          when 'excused' then 2
          when 'excused_accepted' then 3
          when 'excused_rejected' then 4
          else 5
        end,
        a.created_at asc,
        a.name asc
    ),
    '[]'::jsonb
  )
  into v_attendees
  from public.attendees a
  left join lateral (
    select
      (
        select count(*)::integer
        from public.attendee_pings ap_count
        where ap_count.event_id = p_event_id
          and ap_count.target_attendee_id = a.id
      ) as ping_count,
      (
        select ap_last.source_name
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_source_name,
      (
        select ap_last.message
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_message,
      (
        select ap_last.created_at
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_created_at
  ) p on true
  where a.event_id = p_event_id;

  select jsonb_build_object(
    'confirmed', count(*) filter (where a.status = 'confirmed'),
    'excused', count(*) filter (where a.status in ('excused', 'excused_accepted')),
    'rejected', count(*) filter (where a.status = 'excused_rejected')
  )
  into v_summary
  from public.attendees a
  where a.event_id = p_event_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'createdAt', v_event.created_at
    ),
    'attendees', v_attendees,
    'summary', v_summary
  );
end;
$$;

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
  on conflict (event_id, target_attendee_id, lower(source_name)) do nothing;

  if not found then
    raise exception 'Tohle šťouchnutí už od tebe dorazilo.';
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

create or replace function public.create_event(
  p_name text,
  p_location text,
  p_datetime timestamp without time zone,
  p_description text,
  p_organizer_name text,
  p_organizer_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_location text := nullif(trim(p_location), '');
  v_description text := nullif(trim(p_description), '');
  v_organizer_name text := nullif(trim(p_organizer_name), '');
  v_organizer_pin text := nullif(trim(p_organizer_pin), '');
  v_id text;
  v_token text;
  v_attempts integer := 0;
begin
  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Nepodařilo se vytvořit jedinečný identifikátor akce.';
    end if;

    v_id := public._random_token(10);
    exit when not exists (select 1 from public.events e where e.id = v_id);
  end loop;

  loop
    v_token := public._random_token(24);
    exit when not exists (select 1 from public.events e where e.organizer_token = v_token);
  end loop;

  insert into public.events (
    id,
    name,
    location,
    datetime,
    description,
    organizer_token,
    organizer_pin_hash,
    organizer_pin_failed_attempts,
    organizer_pin_locked_until
  )
  values (
    v_id,
    v_name,
    v_location,
    p_datetime,
    v_description,
    v_token,
    extensions.crypt(v_organizer_pin, extensions.gen_salt('bf')),
    0,
    null
  );

  insert into public.attendees (event_id, name, status, excuse_reason)
  values (v_id, v_organizer_name, 'confirmed', null);

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_id,
      'name', v_name,
      'location', v_location,
      'datetime', p_datetime,
      'description', v_description
    ),
    'guestPath', '/event/' || v_id,
    'organizerPath', '/event/' || v_id || '/manage?token=' || v_token
  );
end;
$$;

create or replace function public.get_organizer_path_with_pin(
  p_event_id text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_pin text := nullif(trim(p_pin), '');
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'Akce neexistuje.';
  end if;

  if v_event.organizer_pin_hash is null then
    raise exception 'Správa přes PIN zatím pro tuto akci není dostupná.';
  end if;

  if v_event.organizer_pin_locked_until is not null and v_event.organizer_pin_locked_until > now() then
    raise exception 'PIN je dočasně zablokovaný. Zkus to později.';
  end if;

  if v_pin is null or extensions.crypt(v_pin, v_event.organizer_pin_hash) <> v_event.organizer_pin_hash then
    update public.events
    set
      organizer_pin_failed_attempts = organizer_pin_failed_attempts + 1,
      organizer_pin_locked_until = case
        when organizer_pin_failed_attempts + 1 >= 15 then now() + interval '24 hours'
        when organizer_pin_failed_attempts + 1 >= 10 then now() + interval '1 hour'
        when organizer_pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
        else organizer_pin_locked_until
      end
    where id = p_event_id;

    raise exception 'Neplatný správcovský PIN.';
  end if;

  update public.events
  set
    organizer_pin_failed_attempts = 0,
    organizer_pin_locked_until = null
  where id = p_event_id;

  return jsonb_build_object(
    'organizerPath', '/event/' || p_event_id || '/manage?token=' || v_event.organizer_token
  );
end;
$$;

create or replace function public.submit_rsvp(
  p_event_id text,
  p_name text,
  p_status text,
  p_excuse_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_excuse_reason text := nullif(trim(coalesce(p_excuse_reason, '')), '');
  v_attendee public.attendees%rowtype;
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Na tuhle akci se už nedá odpovědět.';
  end if;

  if v_name is null then
    raise exception 'Vyplň svoje jméno.';
  end if;

  if p_status not in ('confirmed', 'excused') then
    raise exception 'Neplatný typ odpovědi.';
  end if;

  insert into public.attendees (event_id, name, status, excuse_reason)
  values (
    p_event_id,
    v_name,
    p_status,
    case when p_status = 'excused' then v_excuse_reason else null end
  )
  on conflict (event_id, lower(name))
  do update set
    status = excluded.status,
    excuse_reason = excluded.excuse_reason
  returning * into v_attendee;

  return jsonb_build_object('attendee', to_jsonb(v_attendee));
end;
$$;

create or replace function public.moderate_attendee(
  p_event_id text,
  p_attendee_id bigint,
  p_token text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Akce neexistuje.';
  end if;

  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  if p_status not in ('excused_accepted', 'excused_rejected') then
    raise exception 'Neplatná změna stavu omluvenky.';
  end if;

  select *
  into v_attendee
  from public.attendees a
  where a.event_id = p_event_id and a.id = p_attendee_id;

  if not found then
    raise exception 'Účastník nebyl nalezen.';
  end if;

  if v_attendee.status not like 'excused%' then
    raise exception 'Měnit lze jen omluvené účastníky.';
  end if;

  update public.attendees a
  set status = p_status
  where a.event_id = p_event_id and a.id = p_attendee_id
  returning * into v_attendee;

  return jsonb_build_object('attendee', to_jsonb(v_attendee));
end;
$$;

create or replace function public.delete_event(
  p_event_id text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Akce už neexistuje.';
  end if;

  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  delete from public.events e
  where e.id = p_event_id;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.delete_attendee(
  p_event_id text,
  p_attendee_id bigint,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Akce neexistuje.';
  end if;

  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  select *
  into v_attendee
  from public.attendees a
  where a.event_id = p_event_id and a.id = p_attendee_id;

  if not found then
    raise exception 'Účastník nebyl nalezen.';
  end if;

  delete from public.attendees a
  where a.event_id = p_event_id and a.id = p_attendee_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.get_event_payload(text) to anon, authenticated;
grant execute on function public.create_event(text, text, timestamp without time zone, text, text, text) to anon, authenticated;
grant execute on function public.get_organizer_path_with_pin(text, text) to anon, authenticated;
grant execute on function public.ping_attendee(text, bigint, text, text) to anon, authenticated;
grant execute on function public.submit_rsvp(text, text, text, text) to anon, authenticated;
grant execute on function public.moderate_attendee(text, bigint, text, text) to anon, authenticated;
grant execute on function public.delete_attendee(text, bigint, text) to anon, authenticated;
grant execute on function public.delete_event(text, text) to anon, authenticated;

commit;

-- ==================== Row level security ====================
-- Phase 3: RLS hardening
-- Goal: block direct table access from anon/authenticated and allow app flow through RPC only.

begin;

alter table public.events enable row level security;
alter table public.attendees enable row level security;
alter table public.event_chat_messages enable row level security;

create or replace function public.event_exists(p_event_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
  );
$$;

grant execute on function public.event_exists(text) to anon, authenticated;

create or replace function public.can_post_event_chat(
  p_event_id text,
  p_sender_name text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text := nullif(trim(p_sender_name), '');
  v_message text := nullif(trim(p_message), '');
  v_last_message_at timestamptz;
begin
  if not public.event_exists(p_event_id) then
    return false;
  end if;

  if v_sender_name is null or length(v_sender_name) > 80 then
    return false;
  end if;

  if v_message is null or length(v_message) > 500 then
    return false;
  end if;

  if not exists (
    select 1
    from public.attendees a
    where a.event_id = p_event_id
      and lower(trim(a.name)) = lower(v_sender_name)
      and a.status in ('confirmed', 'excused', 'excused_accepted', 'excused_rejected')
  ) then
    return false;
  end if;

  select max(m.created_at)
  into v_last_message_at
  from public.event_chat_messages m
  where m.event_id = p_event_id
    and lower(trim(m.sender_name)) = lower(v_sender_name);

  if v_last_message_at is not null and v_last_message_at > now() - interval '3 seconds' then
    return false;
  end if;

  return true;
end;
$$;

grant execute on function public.can_post_event_chat(text, text, text) to anon, authenticated;

create or replace function public.normalize_event_chat_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sender_name := trim(new.sender_name);
  new.message := trim(new.message);
  return new;
end;
$$;

drop trigger if exists event_chat_messages_normalize_tg on public.event_chat_messages;
create trigger event_chat_messages_normalize_tg
before insert or update on public.event_chat_messages
for each row
execute function public.normalize_event_chat_message();

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
  using (public.event_exists(event_chat_messages.event_id));

create policy "event_chat_insert_allowed"
  on public.event_chat_messages
  for insert
  to anon, authenticated
  with check (
    public.can_post_event_chat(event_chat_messages.event_id, event_chat_messages.sender_name, event_chat_messages.message)
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

-- ==================== Local date/time fix ====================
-- Phase 4: Preserve event time as local wall-clock value (no timezone shifts)

begin;

create extension if not exists pgcrypto;

alter table public.events
  alter column datetime type timestamp without time zone
  using datetime::timestamp;

alter table public.events
  add column if not exists organizer_pin_hash text;

alter table public.events
  add column if not exists organizer_pin_failed_attempts integer not null default 0;

alter table public.events
  add column if not exists organizer_pin_locked_until timestamptz;

create table if not exists public.attendee_pings (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  target_attendee_id bigint not null references public.attendees(id) on delete cascade,
  source_name text not null,
  message text,
  created_at timestamptz not null default now()
);

alter table if exists public.attendee_pings
  add column if not exists message text;

create unique index if not exists attendee_pings_event_target_source_uidx
  on public.attendee_pings (event_id, target_attendee_id, lower(source_name));

create index if not exists attendee_pings_event_target_idx
  on public.attendee_pings (event_id, target_attendee_id);

create table if not exists public.event_chat_messages (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  sender_name text not null check (length(trim(sender_name)) between 1 and 80),
  message text not null check (length(trim(message)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists event_chat_messages_event_created_idx
  on public.event_chat_messages (event_id, created_at asc);

create index if not exists event_chat_messages_created_idx
  on public.event_chat_messages (created_at desc);

grant select, insert on table public.event_chat_messages to anon, authenticated;
grant usage, select on sequence public.event_chat_messages_id_seq to anon, authenticated;

alter table if exists public.event_chat_messages enable row level security;

create or replace function public.event_exists(p_event_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
  );
$$;

grant execute on function public.event_exists(text) to anon, authenticated;

create or replace function public.can_post_event_chat(
  p_event_id text,
  p_sender_name text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text := nullif(trim(p_sender_name), '');
  v_message text := nullif(trim(p_message), '');
  v_last_message_at timestamptz;
begin
  if not public.event_exists(p_event_id) then
    return false;
  end if;

  if v_sender_name is null or length(v_sender_name) > 80 then
    return false;
  end if;

  if v_message is null or length(v_message) > 500 then
    return false;
  end if;

  if not exists (
    select 1
    from public.attendees a
    where a.event_id = p_event_id
      and lower(trim(a.name)) = lower(v_sender_name)
      and a.status in ('confirmed', 'excused', 'excused_accepted', 'excused_rejected')
  ) then
    return false;
  end if;

  select max(m.created_at)
  into v_last_message_at
  from public.event_chat_messages m
  where m.event_id = p_event_id
    and lower(trim(m.sender_name)) = lower(v_sender_name);

  if v_last_message_at is not null and v_last_message_at > now() - interval '3 seconds' then
    return false;
  end if;

  return true;
end;
$$;

grant execute on function public.can_post_event_chat(text, text, text) to anon, authenticated;

create or replace function public.normalize_event_chat_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sender_name := trim(new.sender_name);
  new.message := trim(new.message);
  return new;
end;
$$;

drop trigger if exists event_chat_messages_normalize_tg on public.event_chat_messages;
create trigger event_chat_messages_normalize_tg
before insert or update on public.event_chat_messages
for each row
execute function public.normalize_event_chat_message();

drop policy if exists "event_chat_select_allowed" on public.event_chat_messages;
drop policy if exists "event_chat_insert_allowed" on public.event_chat_messages;
drop policy if exists "event_chat_update_none" on public.event_chat_messages;
drop policy if exists "event_chat_delete_none" on public.event_chat_messages;

create policy "event_chat_select_allowed"
  on public.event_chat_messages
  for select
  to anon, authenticated
  using (public.event_exists(event_chat_messages.event_id));

create policy "event_chat_insert_allowed"
  on public.event_chat_messages
  for insert
  to anon, authenticated
  with check (
    public.can_post_event_chat(event_chat_messages.event_id, event_chat_messages.sender_name, event_chat_messages.message)
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

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'event_chat_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.event_chat_messages';
  end if;
end;
$$;

drop function if exists public.create_event(text, text, timestamptz, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text, text, text);
drop function if exists public.ping_attendee(text, bigint, text);
drop function if exists public.ping_attendee(text, bigint, text, text);
drop function if exists public.delete_attendee(text, bigint, text);

create or replace function public._delete_expired_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.events e
  where e.datetime + interval '7 days' < now()::timestamp;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.create_event(
  p_name text,
  p_location text,
  p_datetime timestamp without time zone,
  p_description text,
  p_organizer_name text,
  p_organizer_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_location text := nullif(trim(p_location), '');
  v_description text := nullif(trim(p_description), '');
  v_organizer_name text := nullif(trim(p_organizer_name), '');
  v_organizer_pin text := nullif(trim(p_organizer_pin), '');
  v_id text;
  v_token text;
  v_attempts integer := 0;
begin
  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Nepodařilo se vytvořit jedinečný identifikátor akce.';
    end if;

    v_id := public._random_token(10);
    exit when not exists (select 1 from public.events e where e.id = v_id);
  end loop;

  loop
    v_token := public._random_token(24);
    exit when not exists (select 1 from public.events e where e.organizer_token = v_token);
  end loop;

  insert into public.events (
    id,
    name,
    location,
    datetime,
    description,
    organizer_token,
    organizer_pin_hash,
    organizer_pin_failed_attempts,
    organizer_pin_locked_until
  )
  values (
    v_id,
    v_name,
    v_location,
    p_datetime,
    v_description,
    v_token,
    extensions.crypt(v_organizer_pin, extensions.gen_salt('bf')),
    0,
    null
  );

  insert into public.attendees (event_id, name, status, excuse_reason)
  values (v_id, v_organizer_name, 'confirmed', null);

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_id,
      'name', v_name,
      'location', v_location,
      'datetime', p_datetime,
      'description', v_description
    ),
    'guestPath', '/event/' || v_id,
    'organizerPath', '/event/' || v_id || '/manage?token=' || v_token
  );
end;
$$;

create or replace function public.get_organizer_path_with_pin(
  p_event_id text,
  p_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_pin text := nullif(trim(p_pin), '');
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if not found then
    raise exception 'Akce neexistuje.';
  end if;

  if v_event.organizer_pin_hash is null then
    raise exception 'Správa přes PIN zatím pro tuto akci není dostupná.';
  end if;

  if v_event.organizer_pin_locked_until is not null and v_event.organizer_pin_locked_until > now() then
    raise exception 'PIN je dočasně zablokovaný. Zkus to později.';
  end if;

  if v_pin is null or extensions.crypt(v_pin, v_event.organizer_pin_hash) <> v_event.organizer_pin_hash then
    update public.events
    set
      organizer_pin_failed_attempts = organizer_pin_failed_attempts + 1,
      organizer_pin_locked_until = case
        when organizer_pin_failed_attempts + 1 >= 15 then now() + interval '24 hours'
        when organizer_pin_failed_attempts + 1 >= 10 then now() + interval '1 hour'
        when organizer_pin_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
        else organizer_pin_locked_until
      end
    where id = p_event_id;

    raise exception 'Neplatný správcovský PIN.';
  end if;

  update public.events
  set
    organizer_pin_failed_attempts = 0,
    organizer_pin_locked_until = null
  where id = p_event_id;

  return jsonb_build_object(
    'organizerPath', '/event/' || p_event_id || '/manage?token=' || v_event.organizer_token
  );
end;
$$;

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
  on conflict (event_id, target_attendee_id, lower(source_name)) do nothing;

  if not found then
    raise exception 'Tohle šťouchnutí už od tebe dorazilo.';
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

create or replace function public.delete_attendee(
  p_event_id text,
  p_attendee_id bigint,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Akce neexistuje.';
  end if;

  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  select *
  into v_attendee
  from public.attendees a
  where a.event_id = p_event_id and a.id = p_attendee_id;

  if not found then
    raise exception 'Účastník nebyl nalezen.';
  end if;

  delete from public.attendees a
  where a.event_id = p_event_id and a.id = p_attendee_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.create_event(text, text, timestamp without time zone, text, text, text) to anon, authenticated;
grant execute on function public.get_organizer_path_with_pin(text, text) to anon, authenticated;
grant execute on function public.ping_attendee(text, bigint, text, text) to anon, authenticated;
grant execute on function public.delete_attendee(text, bigint, text) to anon, authenticated;

commit;

-- ==================== Realtime refresh triggers ====================
-- Phase 5: Realtime updates for attendee pings and event payload changes.

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

-- ==================== Phone collection + event editing ====================
-- Phase 6: Optional phone collection + overview modal support

begin;

alter table public.events
  add column if not exists require_phone boolean not null default false;

alter table public.attendees
  add column if not exists phone text;

drop function if exists public.create_event(text, text, timestamp without time zone, text, text, text);

create or replace function public.create_event(
  p_name text,
  p_location text,
  p_datetime timestamp without time zone,
  p_description text,
  p_organizer_name text,
  p_organizer_pin text,
  p_require_phone boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_location text := nullif(trim(p_location), '');
  v_description text := nullif(trim(p_description), '');
  v_organizer_name text := nullif(trim(p_organizer_name), '');
  v_organizer_pin text := nullif(trim(p_organizer_pin), '');
  v_id text;
  v_token text;
  v_attempts integer := 0;
begin
  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Nepodařilo se vytvořit jedinečný identifikátor akce.';
    end if;

    v_id := public._random_token(10);
    exit when not exists (select 1 from public.events e where e.id = v_id);
  end loop;

  loop
    v_token := public._random_token(24);
    exit when not exists (select 1 from public.events e where e.organizer_token = v_token);
  end loop;

  insert into public.events (
    id,
    name,
    location,
    datetime,
    description,
    organizer_token,
    organizer_pin_hash,
    organizer_pin_failed_attempts,
    organizer_pin_locked_until,
    require_phone
  )
  values (
    v_id,
    v_name,
    v_location,
    p_datetime,
    v_description,
    v_token,
    extensions.crypt(v_organizer_pin, extensions.gen_salt('bf')),
    0,
    null,
    coalesce(p_require_phone, false)
  );

  insert into public.attendees (event_id, name, status, excuse_reason)
  values (v_id, v_organizer_name, 'confirmed', null);

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_id,
      'name', v_name,
      'location', v_location,
      'datetime', p_datetime,
      'description', v_description,
      'requirePhone', coalesce(p_require_phone, false)
    ),
    'guestPath', '/event/' || v_id,
    'organizerPath', '/event/' || v_id || '/manage?token=' || v_token
  );
end;
$$;

drop function if exists public.submit_rsvp(text, text, text, text);

create or replace function public.submit_rsvp(
  p_event_id text,
  p_name text,
  p_status text,
  p_excuse_reason text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_excuse_reason text := nullif(trim(coalesce(p_excuse_reason, '')), '');
  v_phone text := nullif(regexp_replace(trim(coalesce(p_phone, '')), '[^0-9+\-() ]', '', 'g'), '');
  v_event public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Na tuhle akci se už nedá odpovědět.';
  end if;

  if v_name is null then
    raise exception 'Vyplň svoje jméno.';
  end if;

  if p_status not in ('confirmed', 'excused') then
    raise exception 'Neplatný typ odpovědi.';
  end if;

  if v_event.require_phone and v_phone is null then
    raise exception 'Vyplň prosím telefonní číslo.';
  end if;

  if v_phone is not null and length(v_phone) > 20 then
    raise exception 'Telefonní číslo je příliš dlouhé.';
  end if;

  insert into public.attendees (event_id, name, status, excuse_reason, phone)
  values (
    p_event_id,
    v_name,
    p_status,
    case when p_status = 'excused' then v_excuse_reason else null end,
    v_phone
  )
  on conflict (event_id, lower(name))
  do update set
    status = excluded.status,
    excuse_reason = excluded.excuse_reason,
    phone = coalesce(excluded.phone, public.attendees.phone)
  returning * into v_attendee;

  return jsonb_build_object('attendee', to_jsonb(v_attendee));
end;
$$;

create or replace function public.update_event(
  p_event_id text,
  p_token text,
  p_name text,
  p_location text,
  p_datetime timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(trim(p_token), '');
  v_name text := nullif(trim(p_name), '');
  v_location text := nullif(trim(p_location), '');
  v_event public.events%rowtype;
begin
  if v_token is null then
    raise exception 'Správa vyžaduje platný organizátorský odkaz.';
  end if;

  if v_name is null or v_location is null or p_datetime is null then
    raise exception 'Vyplň název, místo a datum akce.';
  end if;

  update public.events e
  set
    name = v_name,
    location = v_location,
    datetime = p_datetime
  where e.id = p_event_id
    and e.organizer_token = v_token
  returning * into v_event;

  if not found then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'requirePhone', v_event.require_phone
    )
  );
end;
$$;

drop function if exists public.get_event_payload(text);

create or replace function public.get_event_payload(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendees jsonb;
  v_summary jsonb;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Tahle akce už neexistuje.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'event_id', a.event_id,
        'name', a.name,
        'status', a.status,
        'excuse_reason', a.excuse_reason,
        'phone', a.phone,
        'created_at', a.created_at,
        'ping_count', coalesce(p.ping_count, 0),
        'ping_last_source_name', p.last_source_name,
        'ping_last_message', p.last_message,
        'ping_last_created_at', p.last_created_at
      )
      order by
        case a.status
          when 'confirmed' then 1
          when 'excused' then 2
          when 'excused_accepted' then 3
          when 'excused_rejected' then 4
          else 5
        end,
        a.created_at asc,
        a.name asc
    ),
    '[]'::jsonb
  )
  into v_attendees
  from public.attendees a
  left join lateral (
    select
      (
        select count(*)::integer
        from public.attendee_pings ap_count
        where ap_count.event_id = p_event_id
          and ap_count.target_attendee_id = a.id
      ) as ping_count,
      (
        select ap_last.source_name
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_source_name,
      (
        select ap_last.message
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_message,
      (
        select ap_last.created_at
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_created_at
  ) p on true
  where a.event_id = p_event_id;

  select jsonb_build_object(
    'confirmed', count(*) filter (where a.status = 'confirmed'),
    'excused', count(*) filter (where a.status in ('excused', 'excused_accepted')),
    'rejected', count(*) filter (where a.status = 'excused_rejected')
  )
  into v_summary
  from public.attendees a
  where a.event_id = p_event_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'createdAt', v_event.created_at,
      'requirePhone', v_event.require_phone
    ),
    'attendees', v_attendees,
    'summary', v_summary
  );
end;
$$;

grant execute on function public.create_event(text, text, timestamp without time zone, text, text, text, boolean) to anon, authenticated;
grant execute on function public.submit_rsvp(text, text, text, text, text) to anon, authenticated;
grant execute on function public.update_event(text, text, text, text, timestamp without time zone) to anon, authenticated;
grant execute on function public.get_event_payload(text) to anon, authenticated;

commit;

-- ==================== Realtime tick FK hotfix ====================
-- Phase 7: Hotfix for event_realtime_ticks FK violations during event cleanup.

begin;

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

commit;

-- ==================== Update event details ====================
-- Phase 8: Organizer can edit event name, location and datetime

begin;

create or replace function public.update_event(
  p_event_id text,
  p_token text,
  p_name text,
  p_location text,
  p_datetime timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := nullif(trim(p_token), '');
  v_name text := nullif(trim(p_name), '');
  v_location text := nullif(trim(p_location), '');
  v_event public.events%rowtype;
begin
  if v_token is null then
    raise exception 'Správa vyžaduje platný organizátorský odkaz.';
  end if;

  if v_name is null or v_location is null or p_datetime is null then
    raise exception 'Vyplň název, místo a datum akce.';
  end if;

  update public.events e
  set
    name = v_name,
    location = v_location,
    datetime = p_datetime
  where e.id = p_event_id
    and e.organizer_token = v_token
  returning * into v_event;

  if not found then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'requirePhone', v_event.require_phone
    )
  );
end;
$$;

grant execute on function public.update_event(text, text, text, text, timestamp without time zone) to anon, authenticated;

commit;

-- ==================== Unique phone per event ====================
-- Phase 9: Prevent duplicate phone numbers per event across different attendee names.

begin;

create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(trim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'), '');
$$;

do $$
begin
  if exists (
    select 1
    from (
      select
        a.event_id,
        public.normalize_phone(a.phone) as normalized_phone,
        count(*) as phone_count
      from public.attendees a
      where public.normalize_phone(a.phone) is not null
      group by a.event_id, public.normalize_phone(a.phone)
      having count(*) > 1
    ) duplicates
  ) then
    raise exception 'Duplicitní telefonní čísla v rámci stejné akce už existují. Nejdřív je oprav a pak spusť migraci znovu.';
  end if;
end;
$$;

create unique index if not exists attendees_event_phone_normalized_uidx
  on public.attendees (event_id, public.normalize_phone(phone))
  where public.normalize_phone(phone) is not null;

drop function if exists public.submit_rsvp(text, text, text, text);

create or replace function public.submit_rsvp(
  p_event_id text,
  p_name text,
  p_status text,
  p_excuse_reason text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_excuse_reason text := nullif(trim(coalesce(p_excuse_reason, '')), '');
  v_phone text := public.normalize_phone(p_phone);
  v_event public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Na tuhle akci se už nedá odpovědět.';
  end if;

  if v_name is null then
    raise exception 'Vyplň svoje jméno.';
  end if;

  if p_status not in ('confirmed', 'excused') then
    raise exception 'Neplatný typ odpovědi.';
  end if;

  if v_event.require_phone and v_phone is null then
    raise exception 'Vyplň prosím telefonní číslo.';
  end if;

  if v_phone is not null and length(v_phone) > 20 then
    raise exception 'Telefonní číslo je příliš dlouhé.';
  end if;

  if v_phone is not null and exists (
    select 1
    from public.attendees a
    where a.event_id = p_event_id
      and public.normalize_phone(a.phone) = v_phone
      and lower(a.name) <> lower(v_name)
  ) then
    raise exception 'Tohle telefonní číslo už je na této akci použité.';
  end if;

  insert into public.attendees (event_id, name, status, excuse_reason, phone)
  values (
    p_event_id,
    v_name,
    p_status,
    case when p_status = 'excused' then v_excuse_reason else null end,
    v_phone
  )
  on conflict (event_id, lower(name))
  do update set
    status = excluded.status,
    excuse_reason = excluded.excuse_reason,
    phone = coalesce(excluded.phone, public.attendees.phone)
  returning * into v_attendee;

  return jsonb_build_object('attendee', to_jsonb(v_attendee));
end;
$$;

grant execute on function public.submit_rsvp(text, text, text, text, text) to anon, authenticated;

commit;

-- ==================== Push reminders ====================
-- Phase 10: Web Push subscriptions + scheduled event reminders (day-before / hour-before).
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

-- The remaining functions are only meant to be called by the Edge Function
-- using the service role key. "revoke ... from public" alone is NOT enough
-- here: Supabase's default privileges grant EXECUTE on every new function
-- directly to anon/authenticated at creation time (a per-role grant, not a
-- grant to the PUBLIC pseudo-role), so revoking from public leaves those
-- direct grants untouched. Revoke from anon/authenticated explicitly too -
-- get_push_subscriptions_for_event in particular would otherwise hand back
-- raw Web Push endpoint/keys for any guessed event id to anon callers.
revoke all on function public.get_pending_event_reminders() from public, anon, authenticated;
revoke all on function public.mark_event_reminder_sent(text, text) from public, anon, authenticated;
revoke all on function public.get_push_subscriptions_for_event(text) from public, anon, authenticated;
revoke all on function public.delete_push_subscription_by_endpoint(text) from public, anon, authenticated;

grant execute on function public.get_pending_event_reminders() to service_role;
grant execute on function public.mark_event_reminder_sent(text, text) to service_role;
grant execute on function public.get_push_subscriptions_for_event(text) to service_role;
grant execute on function public.delete_push_subscription_by_endpoint(text) to service_role;

commit;

-- ==================== Community features ====================
-- Phase 11: Check-in, chat reactions, signup lists (bring/ride), multi-stop
-- itinerary, date/location polls, and event photos.

begin;

-- ==================== Check-in ====================

alter table public.attendees
  add column if not exists checked_in_at timestamptz;

create or replace function public.check_in_attendee(
  p_event_id text,
  p_attendee_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_attendee_name), '');
  v_attendee public.attendees%rowtype;
begin
  if v_name is null then
    raise exception 'Chybí jméno pro check-in.';
  end if;

  select * into v_attendee
  from public.attendees a
  where a.event_id = p_event_id and lower(trim(a.name)) = lower(v_name);

  if not found then
    raise exception 'Nejdřív potvrď účast, pak se můžeš odbavit.';
  end if;

  update public.attendees
  set checked_in_at = now()
  where id = v_attendee.id;

  perform public.emit_event_realtime_tick(p_event_id, 'attendee');

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.check_in_attendee(text, text) to anon, authenticated;

-- Extends phase-6's get_event_payload with checked_in_at per attendee.
create or replace function public.get_event_payload(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendees jsonb;
  v_summary jsonb;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Tahle akce už neexistuje.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'event_id', a.event_id,
        'name', a.name,
        'status', a.status,
        'excuse_reason', a.excuse_reason,
        'phone', a.phone,
        'created_at', a.created_at,
        'checked_in_at', a.checked_in_at,
        'ping_count', coalesce(p.ping_count, 0),
        'ping_last_source_name', p.last_source_name,
        'ping_last_message', p.last_message,
        'ping_last_created_at', p.last_created_at
      )
      order by
        case a.status
          when 'confirmed' then 1
          when 'excused' then 2
          when 'excused_accepted' then 3
          when 'excused_rejected' then 4
          else 5
        end,
        a.created_at asc,
        a.name asc
    ),
    '[]'::jsonb
  )
  into v_attendees
  from public.attendees a
  left join lateral (
    select
      (
        select count(*)::integer
        from public.attendee_pings ap_count
        where ap_count.event_id = p_event_id
          and ap_count.target_attendee_id = a.id
      ) as ping_count,
      (
        select ap_last.source_name
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_source_name,
      (
        select ap_last.message
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_message,
      (
        select ap_last.created_at
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_created_at
  ) p on true
  where a.event_id = p_event_id;

  select jsonb_build_object(
    'confirmed', count(*) filter (where a.status = 'confirmed'),
    'excused', count(*) filter (where a.status in ('excused', 'excused_accepted')),
    'rejected', count(*) filter (where a.status = 'excused_rejected')
  )
  into v_summary
  from public.attendees a
  where a.event_id = p_event_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'createdAt', v_event.created_at,
      'requirePhone', v_event.require_phone
    ),
    'attendees', v_attendees,
    'summary', v_summary
  );
end;
$$;

grant execute on function public.get_event_payload(text) to anon, authenticated;

-- ==================== Chat reactions ====================

create table if not exists public.event_chat_message_reactions (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.event_chat_messages(id) on delete cascade,
  sender_name text not null,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🎉', '🍻')),
  created_at timestamptz not null default now(),
  unique (message_id, sender_name, emoji)
);

create index if not exists event_chat_message_reactions_message_idx
  on public.event_chat_message_reactions (message_id);

alter table public.event_chat_message_reactions enable row level security;

drop policy if exists "event_chat_message_reactions_select" on public.event_chat_message_reactions;
create policy "event_chat_message_reactions_select"
  on public.event_chat_message_reactions
  for select
  to anon, authenticated
  using (true);

drop policy if exists "event_chat_message_reactions_no_direct_write" on public.event_chat_message_reactions;
create policy "event_chat_message_reactions_no_direct_write"
  on public.event_chat_message_reactions
  for insert
  to anon, authenticated
  with check (false);

drop policy if exists "event_chat_message_reactions_no_direct_delete" on public.event_chat_message_reactions;
create policy "event_chat_message_reactions_no_direct_delete"
  on public.event_chat_message_reactions
  for delete
  to anon, authenticated
  using (false);

create or replace function public.toggle_chat_reaction(
  p_message_id bigint,
  p_sender_name text,
  p_emoji text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_sender_name), '');
  v_existing bigint;
begin
  if v_name is null then
    raise exception 'Chybí jméno pro reakci.';
  end if;

  if p_emoji not in ('👍', '❤️', '😂', '🎉', '🍻') then
    raise exception 'Tenhle emoji není podporovaný.';
  end if;

  if not exists (select 1 from public.event_chat_messages m where m.id = p_message_id) then
    raise exception 'Zpráva nebyla nalezena.';
  end if;

  select id into v_existing
  from public.event_chat_message_reactions
  where message_id = p_message_id and sender_name = v_name and emoji = p_emoji;

  if v_existing is not null then
    delete from public.event_chat_message_reactions where id = v_existing;
    return jsonb_build_object('success', true, 'action', 'removed');
  end if;

  insert into public.event_chat_message_reactions (message_id, sender_name, emoji)
  values (p_message_id, v_name, p_emoji);

  return jsonb_build_object('success', true, 'action', 'added');
end;
$$;

grant execute on function public.toggle_chat_reaction(bigint, text, text) to anon, authenticated;

-- ==================== Signup lists (bring-list + carpool) ====================

create table if not exists public.event_signup_items (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  category text not null check (category in ('bring', 'ride')),
  label text not null check (length(trim(label)) between 1 and 120),
  capacity integer not null default 1 check (capacity > 0 and capacity <= 20),
  note text,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists event_signup_items_event_idx
  on public.event_signup_items (event_id);

create table if not exists public.event_signup_claims (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.event_signup_items(id) on delete cascade,
  attendee_name text not null,
  seats integer not null default 1 check (seats > 0),
  created_at timestamptz not null default now(),
  unique (item_id, attendee_name)
);

alter table public.event_signup_items enable row level security;
alter table public.event_signup_claims enable row level security;

drop policy if exists "event_signup_items_select" on public.event_signup_items;
create policy "event_signup_items_select" on public.event_signup_items for select to anon, authenticated using (true);
drop policy if exists "event_signup_items_no_direct_write" on public.event_signup_items;
create policy "event_signup_items_no_direct_write" on public.event_signup_items for insert to anon, authenticated with check (false);
drop policy if exists "event_signup_items_no_direct_delete" on public.event_signup_items;
create policy "event_signup_items_no_direct_delete" on public.event_signup_items for delete to anon, authenticated using (false);

drop policy if exists "event_signup_claims_select" on public.event_signup_claims;
create policy "event_signup_claims_select" on public.event_signup_claims for select to anon, authenticated using (true);
drop policy if exists "event_signup_claims_no_direct_write" on public.event_signup_claims;
create policy "event_signup_claims_no_direct_write" on public.event_signup_claims for insert to anon, authenticated with check (false);
drop policy if exists "event_signup_claims_no_direct_delete" on public.event_signup_claims;
create policy "event_signup_claims_no_direct_delete" on public.event_signup_claims for delete to anon, authenticated using (false);

create or replace function public.add_signup_item(
  p_event_id text,
  p_category text,
  p_label text,
  p_capacity integer,
  p_note text,
  p_created_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_label text := nullif(trim(p_label), '');
  v_created_by text := nullif(trim(p_created_by), '');
  v_id bigint;
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if p_category not in ('bring', 'ride') then
    raise exception 'Neplatná kategorie položky.';
  end if;

  if v_label is null then
    raise exception 'Napiš, co se má přinést nebo zajistit.';
  end if;

  if v_created_by is null then
    raise exception 'Chybí jméno.';
  end if;

  insert into public.event_signup_items (event_id, category, label, capacity, note, created_by)
  values (p_event_id, p_category, v_label, greatest(coalesce(p_capacity, 1), 1), nullif(trim(coalesce(p_note, '')), ''), v_created_by)
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.claim_signup_item(
  p_item_id bigint,
  p_attendee_name text,
  p_seats integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_attendee_name), '');
  v_item public.event_signup_items%rowtype;
  v_claimed_seats integer;
begin
  if v_name is null then
    raise exception 'Chybí jméno.';
  end if;

  select * into v_item from public.event_signup_items where id = p_item_id;

  if not found then
    raise exception 'Položka nebyla nalezena.';
  end if;

  select coalesce(sum(seats), 0) into v_claimed_seats
  from public.event_signup_claims
  where item_id = p_item_id and attendee_name <> v_name;

  if v_claimed_seats + greatest(coalesce(p_seats, 1), 1) > v_item.capacity then
    raise exception 'Už je to obsazené.';
  end if;

  insert into public.event_signup_claims (item_id, attendee_name, seats)
  values (p_item_id, v_name, greatest(coalesce(p_seats, 1), 1))
  on conflict (item_id, attendee_name) do update
    set seats = excluded.seats;

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.unclaim_signup_item(
  p_item_id bigint,
  p_attendee_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_attendee_name), '');
begin
  if v_name is null then
    raise exception 'Chybí jméno.';
  end if;

  delete from public.event_signup_claims
  where item_id = p_item_id and lower(attendee_name) = lower(v_name);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.delete_signup_item(
  p_event_id text,
  p_item_id bigint,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and e.organizer_token = p_token) then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  delete from public.event_signup_items where id = p_item_id and event_id = p_event_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.add_signup_item(text, text, text, integer, text, text) to anon, authenticated;
grant execute on function public.claim_signup_item(bigint, text, integer) to anon, authenticated;
grant execute on function public.unclaim_signup_item(bigint, text) to anon, authenticated;
grant execute on function public.delete_signup_item(text, bigint, text) to anon, authenticated;

-- ==================== Multi-stop itinerary ====================

create table if not exists public.event_stops (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  position integer not null default 0,
  name text not null check (length(trim(name)) between 1 and 120),
  location text,
  starts_at_label text,
  created_at timestamptz not null default now()
);

create index if not exists event_stops_event_idx on public.event_stops (event_id, position);

alter table public.event_stops enable row level security;

drop policy if exists "event_stops_select" on public.event_stops;
create policy "event_stops_select" on public.event_stops for select to anon, authenticated using (true);
drop policy if exists "event_stops_no_direct_write" on public.event_stops;
create policy "event_stops_no_direct_write" on public.event_stops for insert to anon, authenticated with check (false);
drop policy if exists "event_stops_no_direct_delete" on public.event_stops;
create policy "event_stops_no_direct_delete" on public.event_stops for delete to anon, authenticated using (false);

create or replace function public.add_event_stop(
  p_event_id text,
  p_token text,
  p_name text,
  p_location text,
  p_starts_at_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_next_position integer;
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and e.organizer_token = p_token) then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  if v_name is null then
    raise exception 'Pojmenuj zastávku.';
  end if;

  select coalesce(max(position), 0) + 1 into v_next_position
  from public.event_stops where event_id = p_event_id;

  insert into public.event_stops (event_id, position, name, location, starts_at_label)
  values (p_event_id, v_next_position, v_name, nullif(trim(coalesce(p_location, '')), ''), nullif(trim(coalesce(p_starts_at_label, '')), ''));

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.delete_event_stop(
  p_event_id text,
  p_token text,
  p_stop_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and e.organizer_token = p_token) then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  delete from public.event_stops where id = p_stop_id and event_id = p_event_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.add_event_stop(text, text, text, text, text) to anon, authenticated;
grant execute on function public.delete_event_stop(text, text, bigint) to anon, authenticated;

-- ==================== Date/location polls (before finalizing an event) ====================

create table if not exists public.event_polls (
  id text primary key,
  creator_token text not null unique,
  creator_name text not null,
  name text not null,
  description text,
  finalized_event_id text references public.events(id),
  created_at timestamptz not null default now()
);

create table if not exists public.event_poll_options (
  id bigint generated always as identity primary key,
  poll_id text not null references public.event_polls(id) on delete cascade,
  datetime timestamp without time zone not null,
  location text not null,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_poll_votes (
  id bigint generated always as identity primary key,
  poll_id text not null references public.event_polls(id) on delete cascade,
  option_id bigint not null references public.event_poll_options(id) on delete cascade,
  voter_name text not null,
  created_at timestamptz not null default now(),
  unique (poll_id, voter_name)
);

create index if not exists event_poll_options_poll_idx on public.event_poll_options (poll_id);
create index if not exists event_poll_votes_option_idx on public.event_poll_votes (option_id);

alter table public.event_polls enable row level security;
alter table public.event_poll_options enable row level security;
alter table public.event_poll_votes enable row level security;

drop policy if exists "event_polls_select" on public.event_polls;
create policy "event_polls_select" on public.event_polls for select to anon, authenticated using (true);
drop policy if exists "event_polls_no_direct_write" on public.event_polls;
create policy "event_polls_no_direct_write" on public.event_polls for all to anon, authenticated using (false) with check (false);

drop policy if exists "event_poll_options_select" on public.event_poll_options;
create policy "event_poll_options_select" on public.event_poll_options for select to anon, authenticated using (true);
drop policy if exists "event_poll_options_no_direct_write" on public.event_poll_options;
create policy "event_poll_options_no_direct_write" on public.event_poll_options for all to anon, authenticated using (false) with check (false);

drop policy if exists "event_poll_votes_select" on public.event_poll_votes;
create policy "event_poll_votes_select" on public.event_poll_votes for select to anon, authenticated using (true);
drop policy if exists "event_poll_votes_no_direct_write" on public.event_poll_votes;
create policy "event_poll_votes_no_direct_write" on public.event_poll_votes for all to anon, authenticated using (false) with check (false);

create or replace function public.create_event_poll(
  p_creator_name text,
  p_name text,
  p_description text,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_name text := nullif(trim(p_creator_name), '');
  v_name text := nullif(trim(p_name), '');
  v_id text;
  v_token text;
  v_attempts integer := 0;
  v_option jsonb;
begin
  if v_creator_name is null or v_name is null then
    raise exception 'Vyplň svoje jméno a název ankety.';
  end if;

  if jsonb_array_length(p_options) < 2 then
    raise exception 'Přidej aspoň dvě možnosti.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Nepodařilo se vytvořit jedinečný identifikátor ankety.';
    end if;

    v_id := public._random_token(10);
    exit when not exists (select 1 from public.event_polls p where p.id = v_id);
  end loop;

  v_token := public._random_token(24);

  insert into public.event_polls (id, creator_token, creator_name, name, description)
  values (v_id, v_token, v_creator_name, v_name, nullif(trim(coalesce(p_description, '')), ''));

  for v_option in select * from jsonb_array_elements(p_options)
  loop
    insert into public.event_poll_options (poll_id, datetime, location, note)
    values (
      v_id,
      (v_option->>'datetime')::timestamp without time zone,
      trim(v_option->>'location'),
      nullif(trim(coalesce(v_option->>'note', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'pollId', v_id,
    'votePath', '/poll/' || v_id,
    'creatorPath', '/poll/' || v_id || '?token=' || v_token
  );
end;
$$;

create or replace function public.get_poll_payload(
  p_poll_id text,
  p_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll public.event_polls%rowtype;
  v_is_creator boolean := false;
begin
  select * into v_poll from public.event_polls where id = p_poll_id;

  if not found then
    raise exception 'Anketa neexistuje.';
  end if;

  if p_token is not null and p_token = v_poll.creator_token then
    v_is_creator := true;
  end if;

  return jsonb_build_object(
    'poll', jsonb_build_object(
      'id', v_poll.id,
      'name', v_poll.name,
      'description', v_poll.description,
      'creatorName', v_poll.creator_name,
      'finalizedEventId', v_poll.finalized_event_id
    ),
    'isCreator', v_is_creator,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'datetime', o.datetime,
        'location', o.location,
        'note', o.note,
        'votes', coalesce((select jsonb_agg(v.voter_name) from public.event_poll_votes v where v.option_id = o.id), '[]'::jsonb)
      ) order by o.id)
      from public.event_poll_options o
      where o.poll_id = v_poll.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.vote_event_poll(
  p_poll_id text,
  p_option_id bigint,
  p_voter_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_voter_name), '');
begin
  if v_name is null then
    raise exception 'Napiš svoje jméno pro hlasování.';
  end if;

  if not exists (select 1 from public.event_poll_options o where o.id = p_option_id and o.poll_id = p_poll_id) then
    raise exception 'Tahle možnost neexistuje.';
  end if;

  insert into public.event_poll_votes (poll_id, option_id, voter_name)
  values (p_poll_id, p_option_id, v_name)
  on conflict (poll_id, voter_name) do update
    set option_id = excluded.option_id, created_at = now();

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.finalize_event_poll(
  p_poll_id text,
  p_token text,
  p_option_id bigint,
  p_organizer_pin text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll public.event_polls%rowtype;
  v_option public.event_poll_options%rowtype;
  v_event jsonb;
begin
  select * into v_poll from public.event_polls where id = p_poll_id;

  if not found or v_poll.creator_token <> p_token then
    raise exception 'Neplatný odkaz tvůrce ankety.';
  end if;

  if v_poll.finalized_event_id is not null then
    raise exception 'Tahle anketa už byla vyhodnocená.';
  end if;

  select * into v_option from public.event_poll_options where id = p_option_id and poll_id = p_poll_id;

  if not found then
    raise exception 'Tahle možnost neexistuje.';
  end if;

  v_event := public.create_event(
    v_poll.name,
    v_option.location,
    v_option.datetime,
    coalesce(nullif(trim(p_description), ''), 'Vzniklo z ankety.'),
    v_poll.creator_name,
    p_organizer_pin
  );

  update public.event_polls
  set finalized_event_id = v_event->'event'->>'id'
  where id = p_poll_id;

  return v_event;
end;
$$;

grant execute on function public.create_event_poll(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_poll_payload(text, text) to anon, authenticated;
grant execute on function public.vote_event_poll(text, bigint, text) to anon, authenticated;
grant execute on function public.finalize_event_poll(text, text, bigint, text, text) to anon, authenticated;

-- ==================== Event photos ====================

insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', true)
on conflict (id) do nothing;

create table if not exists public.event_photos (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  storage_path text not null,
  uploaded_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists event_photos_event_idx on public.event_photos (event_id);

alter table public.event_photos enable row level security;

drop policy if exists "event_photos_select" on public.event_photos;
create policy "event_photos_select" on public.event_photos for select to anon, authenticated using (true);
drop policy if exists "event_photos_no_direct_write" on public.event_photos;
create policy "event_photos_no_direct_write" on public.event_photos for insert to anon, authenticated with check (false);
drop policy if exists "event_photos_no_direct_delete" on public.event_photos;
create policy "event_photos_no_direct_delete" on public.event_photos for delete to anon, authenticated using (false);

drop policy if exists "event_photos_storage_insert" on storage.objects;
create policy "event_photos_storage_insert"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'event-photos');

drop policy if exists "event_photos_storage_select" on storage.objects;
create policy "event_photos_storage_select"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'event-photos');

create or replace function public.record_event_photo(
  p_event_id text,
  p_storage_path text,
  p_uploaded_by text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uploaded_by text := nullif(trim(p_uploaded_by), '');
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if v_uploaded_by is null then
    raise exception 'Chybí jméno nahrávajícího.';
  end if;

  insert into public.event_photos (event_id, storage_path, uploaded_by)
  values (p_event_id, p_storage_path, v_uploaded_by);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.get_event_photos(
  p_event_id text
)
returns table (id bigint, storage_path text, uploaded_by text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, storage_path, uploaded_by, created_at
  from public.event_photos
  where event_id = p_event_id
  order by created_at desc;
$$;

create or replace function public.delete_event_photo(
  p_event_id text,
  p_token text,
  p_photo_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and e.organizer_token = p_token) then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  -- Storage cleanup happens client-side (JS Storage API) before this RPC is
  -- called - this project rejects direct DML against storage.objects, see
  -- the comment on delete_events_by_ids().
  delete from public.event_photos where id = p_photo_id and event_id = p_event_id;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.record_event_photo(text, text, text) to anon, authenticated;
grant execute on function public.get_event_photos(text) to anon, authenticated;
grant execute on function public.delete_event_photo(text, text, bigint) to anon, authenticated;

-- ==================== Realtime ====================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_chat_message_reactions') then
      execute 'alter publication supabase_realtime add table public.event_chat_message_reactions';
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_signup_claims') then
      execute 'alter publication supabase_realtime add table public.event_signup_claims';
    end if;
  end if;
end;
$$;

commit;

-- ==================== Poll vote case-insensitivity ====================
-- Phase 12: Fix case-sensitive voter matching in event polls.
--
-- Bug: vote_event_poll's uniqueness was on the raw (poll_id, voter_name) pair,
-- so "Tomáš" and "tomáš" produced two separate vote rows instead of one
-- updated vote, inconsistent with how every other name lookup in this app
-- (attendees, pings, chat) already compares names case-insensitively.

begin;

alter table public.event_poll_votes
  drop constraint if exists event_poll_votes_poll_id_voter_name_key;

create unique index if not exists event_poll_votes_poll_voter_lower_uidx
  on public.event_poll_votes (poll_id, lower(voter_name));

create or replace function public.vote_event_poll(
  p_poll_id text,
  p_option_id bigint,
  p_voter_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_voter_name), '');
begin
  if v_name is null then
    raise exception 'Napiš svoje jméno pro hlasování.';
  end if;

  if not exists (select 1 from public.event_poll_options o where o.id = p_option_id and o.poll_id = p_poll_id) then
    raise exception 'Tahle možnost neexistuje.';
  end if;

  insert into public.event_poll_votes (poll_id, option_id, voter_name)
  values (p_poll_id, p_option_id, v_name)
  on conflict (poll_id, lower(voter_name)) do update
    set option_id = excluded.option_id, voter_name = excluded.voter_name, created_at = now();

  return jsonb_build_object('success', true);
end;
$$;

commit;

-- ==================== Ping cooldown + RLS ====================
-- Phase 13: Ping cooldown + lock down attendee_pings with RLS.
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

-- ==================== Security hardening ====================
-- Phase 14: Security/correctness hardening found during a project-wide review.
--
-- 1) _random_token used Postgres's non-cryptographic random(), which is not a
--    CSPRNG. It's the basis for both event ids and the organizer_token bearer
--    credential (the sole authorization check for update_event/delete_event/
--    delete_attendee/moderate_attendee/etc - a plain string compare, no
--    hashing). Switched to pgcrypto's gen_random_bytes(), which IS a CSPRNG.
--    (Storing organizer_token itself as a hash was considered too, but this
--    app's "forgot your manage link? re-enter the PIN" flow (
--    get_organizer_path_with_pin) depends on being able to hand the ORIGINAL
--    token back out after PIN verification - a one-way hash can't be
--    recovered for that, so this migration deliberately leaves organizer_token
--    stored as plaintext. Fixing that would mean redesigning that recovery
--    flow, not just this function - a product decision, not a drop-in fix.)
--
-- 2) get_event_payload returned every attendee's phone number to any caller,
--    including the public (non-organizer) guest RSVP page - the client only
--    ever hid phones from guests cosmetically (a showPhone prop), the actual
--    network response already had them. Added an optional p_organizer_token
--    param; phone is only included when it matches the event's stored token.
--
-- 3) moderate_attendee read-then-write race: it checked
--    "status not like 'excused%'" via a SELECT, then updated by id alone with
--    no repeat of that condition - an attendee flipping back to 'confirmed'
--    via submit_rsvp between the check and the update could get silently
--    overwritten to excused_accepted/excused_rejected. The status condition is
--    now part of the UPDATE's WHERE clause itself, atomically.
--
-- 4) submit_rsvp's duplicate-phone check was a separate pre-check SELECT
--    ahead of the INSERT; the real guarantee is the unique index on
--    normalized phone, so two concurrent submissions with the same phone
--    could both pass the pre-check and the second would fail with a raw
--    "duplicate key value violates unique constraint" instead of the
--    friendly Czech message. Now caught and re-raised.
--
-- 5) organizer_pin_attempts (created with indexes in the base schema) is
--    dead code - grep confirms nothing in this schema or the app ever
--    inserts into it or reads from it, and it never got RLS either. Its
--    create statement and indexes were removed from the base schema above;
--    the drop below only remains to clean it up on a database that's been
--    running since before that removal.

begin;

-- Renaming a parameter (token_length -> p_token_length below) is not
-- something CREATE OR REPLACE FUNCTION allows for a same-signature function -
-- Postgres errors with "cannot change name of input parameter" and points at
-- exactly this DROP as the fix. Explicit, so a full top-to-bottom run always
-- works instead of only succeeding on databases where this happened to
-- already be dropped some other way.
drop function if exists public._random_token(integer);

create or replace function public._random_token(p_token_length integer)
returns text
language plpgsql
as $$
declare
  v_chars constant text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  v_chars_len constant integer := length(v_chars);
  v_result text := '';
  v_random_bytes bytea;
  i integer;
begin
  if p_token_length is null or p_token_length < 1 or p_token_length > 64 then
    raise exception 'Neplatná délka tokenu.';
  end if;

  v_random_bytes := extensions.gen_random_bytes(p_token_length);

  for i in 1..p_token_length loop
    v_result := v_result || substr(v_chars, (get_byte(v_random_bytes, i - 1) % v_chars_len) + 1, 1);
  end loop;

  return v_result;
end;
$$;

-- Internal helper, only ever called by other security definer functions - not
-- meant to be invoked directly. Revoking from just "public" wouldn't be
-- enough, since Supabase's default privileges grant anon/authenticated
-- direct per-role EXECUTE on new functions - revoke from those explicitly too.
revoke all on function public._random_token(integer) from public, anon, authenticated;

-- Changing the parameter list creates a new overload rather than replacing
-- the old one (Postgres resolves functions by signature) - drop the old
-- single-arg version explicitly so nothing can still call it and skip the
-- organizer check below.
drop function if exists public.get_event_payload(text);

create or replace function public.get_event_payload(
  p_event_id text,
  p_organizer_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_is_organizer boolean;
  v_attendees jsonb;
  v_summary jsonb;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Tahle akce už neexistuje.';
  end if;

  v_is_organizer := p_organizer_token is not null and p_organizer_token = v_event.organizer_token;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'event_id', a.event_id,
        'name', a.name,
        'status', a.status,
        'excuse_reason', a.excuse_reason,
        'phone', case when v_is_organizer then a.phone else null end,
        'created_at', a.created_at,
        'checked_in_at', a.checked_in_at,
        'ping_count', coalesce(p.ping_count, 0),
        'ping_last_source_name', p.last_source_name,
        'ping_last_message', p.last_message,
        'ping_last_created_at', p.last_created_at
      )
      order by
        case a.status
          when 'confirmed' then 1
          when 'excused' then 2
          when 'excused_accepted' then 3
          when 'excused_rejected' then 4
          else 5
        end,
        a.created_at asc,
        a.name asc
    ),
    '[]'::jsonb
  )
  into v_attendees
  from public.attendees a
  left join lateral (
    select
      (
        select count(*)::integer
        from public.attendee_pings ap_count
        where ap_count.event_id = p_event_id
          and ap_count.target_attendee_id = a.id
      ) as ping_count,
      (
        select ap_last.source_name
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_source_name,
      (
        select ap_last.message
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_message,
      (
        select ap_last.created_at
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_created_at
  ) p on true
  where a.event_id = p_event_id;

  select jsonb_build_object(
    'confirmed', count(*) filter (where a.status = 'confirmed'),
    'excused', count(*) filter (where a.status in ('excused', 'excused_accepted')),
    'rejected', count(*) filter (where a.status = 'excused_rejected')
  )
  into v_summary
  from public.attendees a
  where a.event_id = p_event_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'createdAt', v_event.created_at,
      'requirePhone', v_event.require_phone
    ),
    'attendees', v_attendees,
    'summary', v_summary
  );
end;
$$;

grant execute on function public.get_event_payload(text, text) to anon, authenticated;

create or replace function public.moderate_attendee(
  p_event_id text,
  p_attendee_id bigint,
  p_token text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Akce neexistuje.';
  end if;

  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  if p_status not in ('excused_accepted', 'excused_rejected') then
    raise exception 'Neplatná změna stavu omluvenky.';
  end if;

  if not exists (
    select 1
    from public.attendees a
    where a.event_id = p_event_id and a.id = p_attendee_id
  ) then
    raise exception 'Účastník nebyl nalezen.';
  end if;

  update public.attendees a
  set status = p_status
  where a.event_id = p_event_id
    and a.id = p_attendee_id
    and a.status like 'excused%'
  returning * into v_attendee;

  if not found then
    raise exception 'Účastník mezitím změnil stav, zkus to prosím znovu.';
  end if;

  return jsonb_build_object('attendee', to_jsonb(v_attendee));
end;
$$;

create or replace function public.submit_rsvp(
  p_event_id text,
  p_name text,
  p_status text,
  p_excuse_reason text default null,
  p_phone text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_excuse_reason text := nullif(trim(coalesce(p_excuse_reason, '')), '');
  v_phone text := public.normalize_phone(p_phone);
  v_event public.events%rowtype;
  v_attendee public.attendees%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Na tuhle akci se už nedá odpovědět.';
  end if;

  if v_name is null then
    raise exception 'Vyplň svoje jméno.';
  end if;

  if p_status not in ('confirmed', 'excused') then
    raise exception 'Neplatný typ odpovědi.';
  end if;

  if v_event.require_phone and v_phone is null then
    raise exception 'Vyplň prosím telefonní číslo.';
  end if;

  if v_phone is not null and length(v_phone) > 20 then
    raise exception 'Telefonní číslo je příliš dlouhé.';
  end if;

  if v_phone is not null and exists (
    select 1
    from public.attendees a
    where a.event_id = p_event_id
      and public.normalize_phone(a.phone) = v_phone
      and lower(a.name) <> lower(v_name)
  ) then
    raise exception 'Tohle telefonní číslo už je na této akci použité.';
  end if;

  begin
    insert into public.attendees (event_id, name, status, excuse_reason, phone)
    values (
      p_event_id,
      v_name,
      p_status,
      case when p_status = 'excused' then v_excuse_reason else null end,
      v_phone
    )
    on conflict (event_id, lower(name))
    do update set
      status = excluded.status,
      excuse_reason = excluded.excuse_reason,
      phone = coalesce(excluded.phone, public.attendees.phone)
    returning * into v_attendee;
  exception
    when unique_violation then
      raise exception 'Tohle telefonní číslo už je na této akci použité.';
  end;

  -- phone is deliberately excluded from the response - nothing in the client
  -- reads it, and submit_rsvp is callable by anyone with an attendee's exact
  -- name (there's no organizer_token gate here like get_event_payload has),
  -- so returning the full row would hand back an existing attendee's phone
  -- number to whoever guesses their name.
  return jsonb_build_object('attendee', to_jsonb(v_attendee) - 'phone');
end;
$$;

grant execute on function public.submit_rsvp(text, text, text, text, text) to anon, authenticated;

drop table if exists public.organizer_pin_attempts;

commit;

-- ==================== Storage + poll cleanup ====================
-- Phase 15: Clean up orphaned photo storage + give polls their own lifecycle.
--
-- 1) Deleting an event (organizer "Smazat akci", or automatic 7-days-after
--    cascade in _delete_expired_events()) only ever removed the event_photos
--    DB rows via FK cascade - the actual image files in the `event-photos`
--    Storage bucket were never touched, so every event that ever had photos
--    left them behind forever, with no remaining reference to even find them
--    again once the row was gone.
--
--    First attempt at fixing this had both delete paths (and
--    delete_event_photo) run `delete from storage.objects` directly in SQL -
--    this Supabase project rejects that outright ("Direct deletion from
--    storage tables is not allowed. Use the Storage API instead."), and since
--    _delete_expired_events() runs at the top of nearly every RPC, it broke
--    the entire app the moment one expired event had photos. Reverted that;
--    storage cleanup now happens client-side via the JS Storage API (manual
--    delete) or a scheduled Edge Function using the Storage Admin API
--    (automatic 7-day expiry, see get_expired_event_ids() and
--    supabase/functions/cleanup-expired-events).
--
-- 2) event_polls is NOT an events row (it only becomes one, via
--    finalized_event_id, once someone finalizes it) - so it was never covered
--    by _delete_expired_events() at all. A poll that's created and never
--    finalized stayed in the database forever, and even a finalized poll's
--    own row stuck around forever independent of what happened to the event
--    it produced.
--
--    Chosen policy (both directions tie a poll's lifetime to something
--    meaningful instead of "forever"):
--      - Unfinalized polls: deleted 14 days after creation if nobody ever
--        finalizes them. Long enough that a week of nobody deciding doesn't
--        lose it, short enough that abandoned polls don't pile up for months.
--      - Finalized polls: finalized_event_id's FK now cascades, so the poll
--        row is deleted automatically in the same moment its resulting event
--        is deleted (organizer delete, or the existing 7-days-after-the-date
--        auto-expiry) - no separate timer needed, and this also fixes a real
--        bug: the FK previously had no ON DELETE action at all, so trying to
--        delete/expire a finalized event would fail outright with a foreign
--        key violation (meaning that event, and everything under it,
--        including its photos, could never actually be cleaned up).

begin;

alter table public.event_polls
  drop constraint if exists event_polls_finalized_event_id_fkey;

alter table public.event_polls
  add constraint event_polls_finalized_event_id_fkey
  foreign key (finalized_event_id)
  references public.events(id)
  on delete cascade;

-- Storage cleanup is NOT done here (or in delete_event/delete_event_photo
-- below) - this Supabase project rejects direct DML against storage.objects
-- ("Direct deletion from storage tables is not allowed. Use the Storage API
-- instead."). Storage cleanup instead happens client-side (manual delete, via
-- the JS Storage API) or via the cleanup-expired-events Edge Function
-- (automatic 7-day expiry, using the Storage Admin API) - see
-- get_expired_event_ids() and delete_events_by_ids() further down.
--
-- Automatic expiry used to run opportunistically from every other RPC
-- (`perform public._delete_expired_events();` at the top of nearly every
-- function, including this one briefly touching storage.objects and causing
-- a full outage). Beyond that, a blanket "delete everything past its date"
-- function is also the wrong shape for the Edge Function to call: it
-- re-queries "what's expired right now" and deletes ALL of it, regardless of
-- which specific events actually had their photos successfully removed from
-- Storage first - a transient Storage API failure for one event would still
-- let its row (and the only reference to its photos) get deleted moments
-- later. _delete_expired_events() is gone; the Edge Function now removes
-- photos per event, tracks which ones succeeded, and asks
-- delete_events_by_ids() to delete only that specific set - a failed event
-- keeps its row (and its "expired" status via get_expired_event_ids()) and
-- gets retried on the next scheduled run.
drop function if exists public._delete_expired_events();

create or replace function public.delete_events_by_ids(p_event_ids text[])
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.events
    where id = any(p_event_ids)
    returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke all on function public.delete_events_by_ids(text[]) from public, anon, authenticated;
grant execute on function public.delete_events_by_ids(text[]) to service_role;

create or replace function public.delete_event(
  p_event_id text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Akce už neexistuje.';
  end if;

  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  delete from public.events e
  where e.id = p_event_id;

  return jsonb_build_object('success', true);
end;
$$;

-- Called by the cleanup-expired-events Edge Function (service role, bypasses
-- RLS). Returns ids of events past their 7-day expiry, so the Edge Function
-- can remove each one's photos via the Storage Admin API, then ask
-- delete_events_by_ids() to drop only the ones whose photos were actually
-- removed.
create or replace function public.get_expired_event_ids()
returns text[]
language sql
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id), '{}')
  from public.events e
  where e.datetime + interval '7 days' < (now() at time zone 'Europe/Prague');
$$;

revoke all on function public.get_expired_event_ids() from public, anon, authenticated;
grant execute on function public.get_expired_event_ids() to service_role;

create or replace function public._delete_expired_polls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
begin
  delete from public.event_polls p
  where p.finalized_event_id is null
    and p.created_at + interval '14 days' < now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

create or replace function public.create_event_poll(
  p_creator_name text,
  p_name text,
  p_description text,
  p_options jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_name text := nullif(trim(p_creator_name), '');
  v_name text := nullif(trim(p_name), '');
  v_id text;
  v_token text;
  v_attempts integer := 0;
  v_option jsonb;
begin
  perform public._delete_expired_polls();

  if v_creator_name is null or v_name is null then
    raise exception 'Vyplň svoje jméno a název ankety.';
  end if;

  if jsonb_array_length(p_options) < 2 then
    raise exception 'Přidej aspoň dvě možnosti.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Nepodařilo se vytvořit jedinečný identifikátor ankety.';
    end if;

    v_id := public._random_token(10);
    exit when not exists (select 1 from public.event_polls p where p.id = v_id);
  end loop;

  v_token := public._random_token(24);

  insert into public.event_polls (id, creator_token, creator_name, name, description)
  values (v_id, v_token, v_creator_name, v_name, nullif(trim(coalesce(p_description, '')), ''));

  for v_option in select * from jsonb_array_elements(p_options)
  loop
    insert into public.event_poll_options (poll_id, datetime, location, note)
    values (
      v_id,
      (v_option->>'datetime')::timestamp without time zone,
      trim(v_option->>'location'),
      nullif(trim(coalesce(v_option->>'note', '')), '')
    );
  end loop;

  return jsonb_build_object(
    'pollId', v_id,
    'votePath', '/poll/' || v_id,
    'creatorPath', '/poll/' || v_id || '?token=' || v_token
  );
end;
$$;

create or replace function public.get_poll_payload(
  p_poll_id text,
  p_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll public.event_polls%rowtype;
  v_is_creator boolean := false;
begin
  perform public._delete_expired_polls();

  select * into v_poll from public.event_polls where id = p_poll_id;

  if not found then
    raise exception 'Anketa neexistuje.';
  end if;

  if p_token is not null and p_token = v_poll.creator_token then
    v_is_creator := true;
  end if;

  return jsonb_build_object(
    'poll', jsonb_build_object(
      'id', v_poll.id,
      'name', v_poll.name,
      'description', v_poll.description,
      'creatorName', v_poll.creator_name,
      'finalizedEventId', v_poll.finalized_event_id
    ),
    'isCreator', v_is_creator,
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'datetime', o.datetime,
        'location', o.location,
        'note', o.note,
        'votes', coalesce((select jsonb_agg(v.voter_name) from public.event_poll_votes v where v.option_id = o.id), '[]'::jsonb)
      ) order by o.id)
      from public.event_poll_options o
      where o.poll_id = v_poll.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.vote_event_poll(
  p_poll_id text,
  p_option_id bigint,
  p_voter_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_voter_name), '');
begin
  perform public._delete_expired_polls();

  if v_name is null then
    raise exception 'Napiš svoje jméno pro hlasování.';
  end if;

  if not exists (select 1 from public.event_poll_options o where o.id = p_option_id and o.poll_id = p_poll_id) then
    raise exception 'Tahle možnost neexistuje.';
  end if;

  insert into public.event_poll_votes (poll_id, option_id, voter_name)
  values (p_poll_id, p_option_id, v_name)
  on conflict (poll_id, lower(voter_name)) do update
    set option_id = excluded.option_id, voter_name = excluded.voter_name, created_at = now();

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.finalize_event_poll(
  p_poll_id text,
  p_token text,
  p_option_id bigint,
  p_organizer_pin text,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll public.event_polls%rowtype;
  v_option public.event_poll_options%rowtype;
  v_event jsonb;
begin
  perform public._delete_expired_polls();

  -- Locks the poll row so two concurrent finalize calls (e.g. a double-click)
  -- can't both pass the "not yet finalized" check below before either
  -- commits - the second one blocks until the first's UPDATE commits, then
  -- sees finalized_event_id already set and raises instead of creating a
  -- second, orphaned duplicate event.
  select * into v_poll from public.event_polls where id = p_poll_id for update;

  if not found or v_poll.creator_token <> p_token then
    raise exception 'Neplatný odkaz tvůrce ankety.';
  end if;

  if v_poll.finalized_event_id is not null then
    raise exception 'Tahle anketa už byla vyhodnocená.';
  end if;

  select * into v_option from public.event_poll_options where id = p_option_id and poll_id = p_poll_id;

  if not found then
    raise exception 'Tahle možnost neexistuje.';
  end if;

  v_event := public.create_event(
    v_poll.name,
    v_option.location,
    v_option.datetime,
    coalesce(nullif(trim(p_description), ''), 'Vzniklo z ankety.'),
    v_poll.creator_name,
    p_organizer_pin
  );

  update public.event_polls
  set finalized_event_id = v_event->'event'->>'id'
  where id = p_poll_id;

  return v_event;
end;
$$;

grant execute on function public.create_event_poll(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_poll_payload(text, text) to anon, authenticated;
grant execute on function public.vote_event_poll(text, bigint, text) to anon, authenticated;
grant execute on function public.finalize_event_poll(text, text, bigint, text, text) to anon, authenticated;

commit;

-- ==================== Signup claim fixes ====================
-- Phase 16: Stop a ride offer's own creator from claiming a seat on it, and
-- let the driver remove a passenger they don't want to take after all.
--
-- 1) claim_signup_item never checked whether the claimant is the same
--    person who created the item. For a 'ride' item (someone offering to
--    drive), that meant the driver could claim one of their own offered
--    seats, silently eating into the capacity meant for actual passengers.
--    Guarded here the same way ping_attendee already guards against
--    self-pings.
--
-- 2) unclaim_signup_item lets an attendee remove their own claim, but there
--    was no way for a driver to remove someone ELSE's claim from their own
--    ride (e.g. they no longer want to take that person). New
--    remove_signup_claim RPC does exactly that, gated on the requester
--    actually being the item's creator.
--
-- 3) claim_signup_item's capacity check (SELECT the current sum, THEN
--    INSERT) was a classic check-then-act race - two concurrent claims for
--    the last seat(s) could both pass the check before either committed,
--    overbooking the item. Now locks the item row (SELECT ... FOR UPDATE)
--    before checking, serializing concurrent claims on the same item, the
--    same fix already applied to ping_attendee's cooldown and
--    moderate_attendee's status check elsewhere in this file.
--
-- 4) event_signup_claims compared attendee_name case-sensitively, unlike
--    every other identity table in this schema (attendees, attendee_pings,
--    event_poll_votes all match case-insensitively) - "Petr" and "petr"
--    created two separate, un-mergeable claims, and unclaim/remove could
--    only ever delete the exact casing supplied. Added a case-insensitive
--    unique index (same fix as phase-12's event_poll_votes_poll_voter_lower_uidx)
--    and made claim/unclaim/remove all compare case-insensitively.
--
-- Left out of scope: 'bring' items, where the creator claiming a slot is
-- meaningful (e.g. the organizer lists "Beer, 3 needed" and also brings some
-- themselves) - both changes here only apply to 'ride' items.

begin;

alter table public.event_signup_claims
  drop constraint if exists event_signup_claims_item_id_attendee_name_key;

create unique index if not exists event_signup_claims_item_lower_name_uidx
  on public.event_signup_claims (item_id, lower(attendee_name));

create or replace function public.claim_signup_item(
  p_item_id bigint,
  p_attendee_name text,
  p_seats integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_attendee_name), '');
  v_item public.event_signup_items%rowtype;
  v_claimed_seats integer;
begin
  if v_name is null then
    raise exception 'Chybí jméno.';
  end if;

  select * into v_item from public.event_signup_items where id = p_item_id for update;

  if not found then
    raise exception 'Položka nebyla nalezena.';
  end if;

  if v_item.category = 'ride' and lower(trim(v_item.created_by)) = lower(v_name) then
    raise exception 'Jako řidič už místo v autě máš, nemůžeš se přihlásit na vlastní nabídku odvozu.';
  end if;

  select coalesce(sum(seats), 0) into v_claimed_seats
  from public.event_signup_claims
  where item_id = p_item_id and lower(attendee_name) <> lower(v_name);

  if v_claimed_seats + greatest(coalesce(p_seats, 1), 1) > v_item.capacity then
    raise exception 'Už je to obsazené.';
  end if;

  insert into public.event_signup_claims (item_id, attendee_name, seats)
  values (p_item_id, v_name, greatest(coalesce(p_seats, 1), 1))
  on conflict (item_id, lower(attendee_name)) do update
    set seats = excluded.seats;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.claim_signup_item(bigint, text, integer) to anon, authenticated;

create or replace function public.remove_signup_claim(
  p_item_id bigint,
  p_claim_attendee_name text,
  p_requester_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester text := nullif(trim(p_requester_name), '');
  v_target text := nullif(trim(p_claim_attendee_name), '');
  v_item public.event_signup_items%rowtype;
begin
  if v_requester is null then
    raise exception 'Chybí jméno.';
  end if;

  if v_target is null then
    raise exception 'Chybí jméno účastníka k odebrání.';
  end if;

  select * into v_item from public.event_signup_items where id = p_item_id;

  if not found then
    raise exception 'Položka nebyla nalezena.';
  end if;

  if v_item.category <> 'ride' or lower(trim(v_item.created_by)) <> lower(v_requester) then
    raise exception 'Jen ten, kdo nabídku odvozu založil, může někoho odebrat.';
  end if;

  delete from public.event_signup_claims
  where item_id = p_item_id and lower(attendee_name) = lower(v_target);

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.remove_signup_claim(bigint, text, text) to anon, authenticated;

commit;

-- ==================== Realtime read hardening ====================
-- Phase 17: Direct SELECT policies on event_polls/options/votes, event_photos,
-- event_chat_messages/reactions, event_signup_items/claims and event_stops
-- were `using (true)` (or `event_exists(event_id)`, which is trivially true
-- for any real row) - meaning the anon key (public in the client bundle) can
-- read every event's chat, signups, stops, photos and poll data at once via
-- a plain REST call with no event_id filter, not just the one event a caller
-- actually has the link for.
--
-- event_polls/options/votes and event_photos already have zero direct-table
-- read dependents client-side (get_poll_payload/get_event_photos RPCs cover
-- them), so those four are simply locked to `using (false)` below - no
-- client change needed.
--
-- event_chat_messages/reactions, event_signup_items/claims and event_stops
-- are different: the client reads them directly AND subscribes to their
-- postgres_changes for live updates. Locking those to `using (false)` too
-- would silently break both. So this phase also:
--   1) adds dedicated SECURITY DEFINER RPCs that do the same event_id-scoped
--      read server-side (get_event_chat_messages, get_chat_reactions,
--      get_event_signup_items, get_event_stops), replacing the direct
--      `.from(table).select()` calls in api.js;
--   2) converts event_chat_messages inserts (the one remaining direct
--      client write) to a send_event_chat_message RPC, since the client's
--      `.insert().select()` needs to read back the row it just inserted,
--      which `using (false)` would otherwise block;
--   3) replaces the direct postgres_changes subscriptions on these five
--      tables with the same "listen on event_realtime_ticks, then refetch"
--      pattern phase 5 already established for attendees/events/pings -
--      event_realtime_ticks carries no sensitive payload, so it's the only
--      one of these actually safe to subscribe to directly. As a side
--      effect, this also fixes event_signup_items/event_stops never having
--      been added to the supabase_realtime publication (their live refresh
--      was silently dead before this phase) - they no longer need to be,
--      since clients now only subscribe to ticks.
--
-- unclaim_signup_item is also hardened here: it took a single
-- p_attendee_name used both as "whose claim to remove" and, implicitly, as
-- proof of identity - unlike remove_signup_claim (phase 16), nothing
-- required the caller to assert who THEY are versus who they're unclaiming.
-- Added a p_requester_name parameter that must match, mirroring
-- remove_signup_claim's pattern. Worth being honest about what this does
-- and doesn't buy: this app has no authentication anywhere (every identity
-- is a self-asserted name, by design - see submit_rsvp, ping_attendee,
-- claim_signup_item), so this doesn't cryptographically stop a caller
-- willing to assert a false name for both parameters. It closes the gap of
-- one field silently doing double duty and brings it in line with the
-- sibling function - it is not, and can't be, a real identity check without
-- a larger auth redesign.

begin;

-- --- event_polls / event_poll_options / event_poll_votes / event_photos:
-- no direct client reads left once poll/photo data goes through RPCs only.

drop policy if exists "event_polls_select" on public.event_polls;
create policy "event_polls_select" on public.event_polls for select to anon, authenticated using (false);

drop policy if exists "event_poll_options_select" on public.event_poll_options;
create policy "event_poll_options_select" on public.event_poll_options for select to anon, authenticated using (false);

drop policy if exists "event_poll_votes_select" on public.event_poll_votes;
create policy "event_poll_votes_select" on public.event_poll_votes for select to anon, authenticated using (false);

drop policy if exists "event_photos_select" on public.event_photos;
create policy "event_photos_select" on public.event_photos for select to anon, authenticated using (false);

-- --- event_chat_messages / event_chat_message_reactions / event_signup_items
-- / event_signup_claims / event_stops: locked down too, matched by the RPCs
-- and realtime-tick triggers below that replace direct table access.

drop policy if exists "event_chat_select_allowed" on public.event_chat_messages;
create policy "event_chat_select_allowed"
  on public.event_chat_messages
  for select
  to anon, authenticated
  using (false);

drop policy if exists "event_chat_message_reactions_select" on public.event_chat_message_reactions;
create policy "event_chat_message_reactions_select"
  on public.event_chat_message_reactions
  for select
  to anon, authenticated
  using (false);

drop policy if exists "event_signup_items_select" on public.event_signup_items;
create policy "event_signup_items_select" on public.event_signup_items for select to anon, authenticated using (false);

drop policy if exists "event_signup_claims_select" on public.event_signup_claims;
create policy "event_signup_claims_select" on public.event_signup_claims for select to anon, authenticated using (false);

drop policy if exists "event_stops_select" on public.event_stops;
create policy "event_stops_select" on public.event_stops for select to anon, authenticated using (false);

-- --- Replacement read RPCs (SECURITY DEFINER; scope by p_event_id
-- server-side, so a caller can no longer get more than the one event they
-- asked about).

create or replace function public.get_event_chat_messages(
  p_event_id text,
  p_limit integer default 120
)
returns table (id bigint, event_id text, sender_name text, message text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select m.id, m.event_id, m.sender_name, m.message, m.created_at
  from public.event_chat_messages m
  where m.event_id = p_event_id
  order by m.created_at desc
  limit greatest(coalesce(p_limit, 120), 1);
$$;

create or replace function public.send_event_chat_message(
  p_event_id text,
  p_sender_name text,
  p_message text
)
returns table (id bigint, event_id text, sender_name text, message text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text := nullif(trim(p_sender_name), '');
  v_message text := nullif(trim(p_message), '');
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if v_sender_name is null then
    raise exception 'Pro odeslání zprávy vyplň svoje jméno.';
  end if;

  if v_message is null then
    raise exception 'Napiš zprávu do chatu.';
  end if;

  return query
  insert into public.event_chat_messages as m (event_id, sender_name, message)
  values (p_event_id, v_sender_name, v_message)
  returning m.id, m.event_id, m.sender_name, m.message, m.created_at;
end;
$$;

create or replace function public.get_chat_reactions(
  p_event_id text,
  p_message_ids bigint[]
)
returns table (id bigint, message_id bigint, sender_name text, emoji text)
language sql
security definer
set search_path = public
as $$
  select r.id, r.message_id, r.sender_name, r.emoji
  from public.event_chat_message_reactions r
  join public.event_chat_messages m on m.id = r.message_id
  where m.event_id = p_event_id
    and r.message_id = any(p_message_ids);
$$;

create or replace function public.get_event_signup_items(p_event_id text)
returns table (
  id bigint,
  event_id text,
  category text,
  label text,
  capacity integer,
  note text,
  created_by text,
  created_at timestamptz,
  event_signup_claims jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    i.id, i.event_id, i.category, i.label, i.capacity, i.note, i.created_by, i.created_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', c.id, 'attendee_name', c.attendee_name, 'seats', c.seats) order by c.created_at asc)
        from public.event_signup_claims c
        where c.item_id = i.id
      ),
      '[]'::jsonb
    ) as event_signup_claims
  from public.event_signup_items i
  where i.event_id = p_event_id
  order by i.created_at asc;
$$;

create or replace function public.get_event_stops(p_event_id text)
returns table (id bigint, event_id text, "position" integer, name text, location text, starts_at_label text)
language sql
security definer
set search_path = public
as $$
  select s.id, s.event_id, s.position, s.name, s.location, s.starts_at_label
  from public.event_stops s
  where s.event_id = p_event_id
  order by s.position asc;
$$;

grant execute on function public.get_event_chat_messages(text, integer) to anon, authenticated;
grant execute on function public.send_event_chat_message(text, text, text) to anon, authenticated;
grant execute on function public.get_chat_reactions(text, bigint[]) to anon, authenticated;
grant execute on function public.get_event_signup_items(text) to anon, authenticated;
grant execute on function public.get_event_stops(text) to anon, authenticated;

-- --- event_realtime_ticks: new reasons for the tables above, so clients can
-- subscribe to ticks instead of the tables directly.

alter table public.event_realtime_ticks drop constraint if exists event_realtime_ticks_reason_check;
alter table public.event_realtime_ticks add constraint event_realtime_ticks_reason_check
  check (reason in ('event', 'attendee', 'ping', 'chat_message', 'chat_reaction', 'signup_item', 'signup_claim', 'stop'));

create or replace function public.emit_event_realtime_tick_from_chat_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_event_realtime_tick(new.event_id, 'chat_message');
  return new;
end;
$$;

create or replace function public.emit_event_realtime_tick_from_chat_reactions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text;
begin
  select m.event_id into v_event_id
  from public.event_chat_messages m
  where m.id = coalesce(new.message_id, old.message_id);

  perform public.emit_event_realtime_tick(v_event_id, 'chat_reaction');
  return coalesce(new, old);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_signup_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_event_realtime_tick(coalesce(new.event_id, old.event_id), 'signup_item');
  return coalesce(new, old);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_signup_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text;
begin
  select i.event_id into v_event_id
  from public.event_signup_items i
  where i.id = coalesce(new.item_id, old.item_id);

  perform public.emit_event_realtime_tick(v_event_id, 'signup_claim');
  return coalesce(new, old);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_stops()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_event_realtime_tick(coalesce(new.event_id, old.event_id), 'stop');
  return coalesce(new, old);
end;
$$;

drop trigger if exists event_chat_messages_emit_event_realtime_tick_tg on public.event_chat_messages;
create trigger event_chat_messages_emit_event_realtime_tick_tg
after insert on public.event_chat_messages
for each row
execute function public.emit_event_realtime_tick_from_chat_messages();

drop trigger if exists event_chat_reactions_emit_event_realtime_tick_tg on public.event_chat_message_reactions;
create trigger event_chat_reactions_emit_event_realtime_tick_tg
after insert or delete on public.event_chat_message_reactions
for each row
execute function public.emit_event_realtime_tick_from_chat_reactions();

drop trigger if exists event_signup_items_emit_event_realtime_tick_tg on public.event_signup_items;
create trigger event_signup_items_emit_event_realtime_tick_tg
after insert or delete on public.event_signup_items
for each row
execute function public.emit_event_realtime_tick_from_signup_items();

drop trigger if exists event_signup_claims_emit_event_realtime_tick_tg on public.event_signup_claims;
create trigger event_signup_claims_emit_event_realtime_tick_tg
after insert or delete on public.event_signup_claims
for each row
execute function public.emit_event_realtime_tick_from_signup_claims();

drop trigger if exists event_stops_emit_event_realtime_tick_tg on public.event_stops;
create trigger event_stops_emit_event_realtime_tick_tg
after insert or delete on public.event_stops
for each row
execute function public.emit_event_realtime_tick_from_stops();

-- --- unclaim_signup_item: require the caller to assert who they are, not
-- just who they're unclaiming (see comment at the top of this phase).
-- Changing the parameter list creates a new overload rather than replacing
-- the old one - drop the old two-arg version explicitly so nothing can
-- still call it and skip the requester check.

drop function if exists public.unclaim_signup_item(bigint, text);

create or replace function public.unclaim_signup_item(
  p_item_id bigint,
  p_attendee_name text,
  p_requester_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text := nullif(trim(p_attendee_name), '');
  v_requester text := nullif(trim(p_requester_name), '');
begin
  if v_target is null then
    raise exception 'Chybí jméno.';
  end if;

  if v_requester is null or lower(v_requester) <> lower(v_target) then
    raise exception 'Odhlásit můžeš jen svoje vlastní přihlášení.';
  end if;

  delete from public.event_signup_claims
  where item_id = p_item_id and lower(attendee_name) = lower(v_target);

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.unclaim_signup_item(bigint, text, text) to anon, authenticated;

commit;

-- ==================== Organizer identity ====================
-- Phase 18: ManageEventPage derived "who is the organizer" client-side as
-- `attendees[0]?.name` (the earliest confirmed attendee row) - there was
-- never a real "this attendee is the organizer" marker anywhere. If the
-- organizer's own attendee row is later deleted (nothing stops them
-- deleting their own row from the roster, by mistake or otherwise),
-- attendees[0] silently becomes a different, unrelated attendee, and every
-- action that stamps "as the organizer" (chat, pings, signup claims,
-- photos) starts recording that other person's name instead - with no
-- error or warning.
--
-- Added an explicit organizer_name column on events, set once at creation
-- time (create_event, and transitively finalize_event_poll which calls it)
-- and returned by get_event_payload, so the client no longer has to guess
-- it from attendee ordering. Existing events are backfilled with the same
-- "earliest confirmed attendee" heuristic as a one-time best-effort
-- migration - it's exactly as accurate as the old client-side guess for
-- data that already exists, but every event created from here on has a
-- stable, authoritative value that survives roster edits.

begin;

alter table public.events add column if not exists organizer_name text;

update public.events e
set organizer_name = (
  select a.name
  from public.attendees a
  where a.event_id = e.id
  order by a.created_at asc, a.id asc
  limit 1
)
where e.organizer_name is null;

create or replace function public.create_event(
  p_name text,
  p_location text,
  p_datetime timestamp without time zone,
  p_description text,
  p_organizer_name text,
  p_organizer_pin text,
  p_require_phone boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_location text := nullif(trim(p_location), '');
  v_description text := nullif(trim(p_description), '');
  v_organizer_name text := nullif(trim(p_organizer_name), '');
  v_organizer_pin text := nullif(trim(p_organizer_pin), '');
  v_id text;
  v_token text;
  v_attempts integer := 0;
begin
  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Nepodařilo se vytvořit jedinečný identifikátor akce.';
    end if;

    v_id := public._random_token(10);
    exit when not exists (select 1 from public.events e where e.id = v_id);
  end loop;

  loop
    v_token := public._random_token(24);
    exit when not exists (select 1 from public.events e where e.organizer_token = v_token);
  end loop;

  insert into public.events (
    id,
    name,
    location,
    datetime,
    description,
    organizer_token,
    organizer_name,
    organizer_pin_hash,
    organizer_pin_failed_attempts,
    organizer_pin_locked_until,
    require_phone
  )
  values (
    v_id,
    v_name,
    v_location,
    p_datetime,
    v_description,
    v_token,
    v_organizer_name,
    extensions.crypt(v_organizer_pin, extensions.gen_salt('bf')),
    0,
    null,
    coalesce(p_require_phone, false)
  );

  insert into public.attendees (event_id, name, status, excuse_reason)
  values (v_id, v_organizer_name, 'confirmed', null);

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_id,
      'name', v_name,
      'location', v_location,
      'datetime', p_datetime,
      'description', v_description,
      'requirePhone', coalesce(p_require_phone, false)
    ),
    'guestPath', '/event/' || v_id,
    'organizerPath', '/event/' || v_id || '/manage?token=' || v_token
  );
end;
$$;

create or replace function public.get_event_payload(
  p_event_id text,
  p_organizer_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_is_organizer boolean;
  v_attendees jsonb;
  v_summary jsonb;
begin
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Tahle akce už neexistuje.';
  end if;

  v_is_organizer := p_organizer_token is not null and p_organizer_token = v_event.organizer_token;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.id,
        'event_id', a.event_id,
        'name', a.name,
        'status', a.status,
        'excuse_reason', a.excuse_reason,
        'phone', case when v_is_organizer then a.phone else null end,
        'created_at', a.created_at,
        'checked_in_at', a.checked_in_at,
        'ping_count', coalesce(p.ping_count, 0),
        'ping_last_source_name', p.last_source_name,
        'ping_last_message', p.last_message,
        'ping_last_created_at', p.last_created_at
      )
      order by
        case a.status
          when 'confirmed' then 1
          when 'excused' then 2
          when 'excused_accepted' then 3
          when 'excused_rejected' then 4
          else 5
        end,
        a.created_at asc,
        a.name asc
    ),
    '[]'::jsonb
  )
  into v_attendees
  from public.attendees a
  left join lateral (
    select
      (
        select count(*)::integer
        from public.attendee_pings ap_count
        where ap_count.event_id = p_event_id
          and ap_count.target_attendee_id = a.id
      ) as ping_count,
      (
        select ap_last.source_name
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_source_name,
      (
        select ap_last.message
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_message,
      (
        select ap_last.created_at
        from public.attendee_pings ap_last
        where ap_last.event_id = p_event_id
          and ap_last.target_attendee_id = a.id
        order by ap_last.created_at desc
        limit 1
      ) as last_created_at
  ) p on true
  where a.event_id = p_event_id;

  select jsonb_build_object(
    'confirmed', count(*) filter (where a.status = 'confirmed'),
    'excused', count(*) filter (where a.status in ('excused', 'excused_accepted')),
    'rejected', count(*) filter (where a.status = 'excused_rejected')
  )
  into v_summary
  from public.attendees a
  where a.event_id = p_event_id;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'createdAt', v_event.created_at,
      'requirePhone', v_event.require_phone,
      'organizerName', v_event.organizer_name
    ),
    'attendees', v_attendees,
    'summary', v_summary
  );
end;
$$;

grant execute on function public.create_event(text, text, timestamp without time zone, text, text, text, boolean) to anon, authenticated;
grant execute on function public.get_event_payload(text, text) to anon, authenticated;

commit;

-- ==================== Photo upload validation ====================
-- Phase 19: the event-photos storage bucket had no file_size_limit or
-- allowed_mime_types, so the only thing stopping an arbitrarily large or
-- non-image upload was a client-side `file.type.startsWith('image/')` check
-- in PhotoGallery.jsx/api.js - trivially bypassed by calling the Storage API
-- directly with the anon key, which is public in the client bundle.
-- Constrains the bucket itself so this can't be bypassed from outside the
-- app; the client-side check stays too, purely for instant UX feedback.

begin;

update storage.buckets
set file_size_limit = 10485760, -- 10 MB, matches the client-side check in api.js
    allowed_mime_types = array['image/*']
where id = 'event-photos';

commit;

-- ==================== Feedback (bugs + ideas) ====================
-- Phase 20: Site-wide floating feedback button (bug report OR improvement
-- idea) + an admin page to read them back.
--
-- feedback_admin is a singleton table (id boolean primary key default true,
-- checked to always equal true) holding a single bcrypt hash - the same
-- pattern events.organizer_pin_hash already uses. There's no RPC to seed
-- it: run the insert below yourself, with your own PIN, directly in the SQL
-- Editor - that way the actual secret never goes into this file or git
-- history. To set or change the admin PIN:
--
--   insert into public.feedback_admin (id, pin_hash)
--   values (true, extensions.crypt('choose-your-own-pin', extensions.gen_salt('bf')))
--   on conflict (id) do update set pin_hash = excluded.pin_hash;
--
-- Both tables are locked to `using (false)` for every direct operation -
-- submit_feedback_report/get_feedback_reports (SECURITY DEFINER) are the
-- only way in or out, same as every other table in this file.

begin;

create table if not exists public.feedback_reports (
  id bigint generated always as identity primary key,
  type text not null check (type in ('bug', 'idea')),
  name text not null check (length(trim(name)) between 1 and 100),
  message text not null check (length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists feedback_reports_created_at_idx
  on public.feedback_reports (created_at desc);

create table if not exists public.feedback_admin (
  id boolean primary key default true,
  pin_hash text not null,
  constraint feedback_admin_single_row check (id)
);

alter table public.feedback_reports enable row level security;
alter table public.feedback_admin enable row level security;

drop policy if exists "feedback_reports_no_direct_access" on public.feedback_reports;
create policy "feedback_reports_no_direct_access"
  on public.feedback_reports
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "feedback_admin_no_direct_access" on public.feedback_admin;
create policy "feedback_admin_no_direct_access"
  on public.feedback_admin
  for all
  to anon, authenticated
  using (false)
  with check (false);

create or replace function public.submit_feedback_report(
  p_type text,
  p_name text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_message text := nullif(trim(p_message), '');
begin
  if p_type not in ('bug', 'idea') then
    raise exception 'Neplatný typ hlášení.';
  end if;

  if v_name is null then
    raise exception 'Napiš svoje jméno.';
  end if;

  if length(v_name) > 100 then
    raise exception 'Jméno je moc dlouhé.';
  end if;

  if v_message is null then
    raise exception 'Napiš prosím pár slov.';
  end if;

  if length(v_message) > 2000 then
    raise exception 'Text je moc dlouhý (limit 2000 znaků).';
  end if;

  insert into public.feedback_reports (type, name, message)
  values (p_type, v_name, v_message);

  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.get_feedback_reports(
  p_pin text
)
returns table (id bigint, type text, name text, message text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin public.feedback_admin%rowtype;
begin
  select * into v_admin from public.feedback_admin where id = true;

  if not found then
    raise exception 'Správa hlášení ještě není nastavená.';
  end if;

  if p_pin is null or extensions.crypt(p_pin, v_admin.pin_hash) <> v_admin.pin_hash then
    raise exception 'Neplatný PIN.';
  end if;

  return query
    select r.id, r.type, r.name, r.message, r.created_at
    from public.feedback_reports r
    order by r.created_at desc;
end;
$$;

grant execute on function public.submit_feedback_report(text, text, text) to anon, authenticated;
grant execute on function public.get_feedback_reports(text) to anon, authenticated;

commit;
