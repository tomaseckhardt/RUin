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

drop function if exists public.create_event(text, text, timestamptz, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text, text);
drop function if exists public.create_event(text, text, timestamp without time zone, text, text, text);

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
  v_max_attempts constant integer := 5;
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
        when organizer_pin_failed_attempts + 1 >= v_max_attempts then now() + interval '15 minutes'
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

grant execute on function public.create_event(text, text, timestamp without time zone, text, text, text) to anon, authenticated;
grant execute on function public.get_organizer_path_with_pin(text, text) to anon, authenticated;

commit;
