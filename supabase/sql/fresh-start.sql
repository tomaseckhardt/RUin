-- RUin Supabase full setup (combined migrations)
-- Generated from phase-1..phase-9



-- ============================================================================
-- Source: supabase/sql/phase-1-schema.sql
-- ============================================================================

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

create table if not exists public.organizer_pin_attempts (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  source_name text not null,
  outcome text not null check (outcome in ('failed_invalid_pin', 'failed_locked')),
  attempted_at timestamptz not null default now()
);

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

create index if not exists organizer_pin_attempts_event_idx
  on public.organizer_pin_attempts (event_id);

create index if not exists organizer_pin_attempts_event_attempted_idx
  on public.organizer_pin_attempts (event_id, attempted_at desc);

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



-- ============================================================================
-- Source: supabase/sql/phase-2-rpc.sql
-- ============================================================================

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
  perform public._delete_expired_events();

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
  attempts integer := 0;
begin
  perform public._delete_expired_events();

  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    attempts := attempts + 1;
    if attempts > 20 then
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
  perform public._delete_expired_events();

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
  perform public._delete_expired_events();

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
  perform public._delete_expired_events();

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
  perform public._delete_expired_events();

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
  perform public._delete_expired_events();

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



-- ============================================================================
-- Source: supabase/sql/phase-3-rls.sql
-- ============================================================================

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



-- ============================================================================
-- Source: supabase/sql/phase-4-datetime-local-fix.sql
-- ============================================================================

-- Phase 4: Preserve event time as local wall-clock value (no timezone shifts)
-- Run this on existing projects that already used timestamptz in events.datetime.

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
  attempts integer := 0;
begin
  perform public._delete_expired_events();

  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    attempts := attempts + 1;
    if attempts > 20 then
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
  perform public._delete_expired_events();

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
  perform public._delete_expired_events();

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



-- ============================================================================
-- Source: supabase/sql/phase-5-push-notifications.sql
-- ============================================================================

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



-- ============================================================================
-- Source: supabase/sql/phase-6-phone-and-overview.sql
-- ============================================================================

-- Phase 6: Optional phone collection + overview modal support
-- Run this on existing databases after phase-5.

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
  attempts integer := 0;
begin
  perform public._delete_expired_events();

  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    attempts := attempts + 1;
    if attempts > 20 then
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
  perform public._delete_expired_events();

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
  perform public._delete_expired_events();

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
  perform public._delete_expired_events();

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



-- ============================================================================
-- Source: supabase/sql/phase-7-realtime-tick-fk-hotfix.sql
-- ============================================================================

-- Phase 7: Hotfix for event_realtime_ticks FK violations during event cleanup.
-- Run this on existing databases after phase-6.

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



-- ============================================================================
-- Source: supabase/sql/phase-8-update-event-details.sql
-- ============================================================================

-- Phase 8: Organizer can edit event name, location and datetime
-- Run this on existing databases after phase-7.

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
  perform public._delete_expired_events();

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



-- ============================================================================
-- Source: supabase/sql/phase-9-unique-phone-per-event.sql
-- ============================================================================

-- Phase 9: Prevent duplicate phone numbers per event across different attendee names.
-- Run this on existing databases after phase-8.

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
  perform public._delete_expired_events();

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
