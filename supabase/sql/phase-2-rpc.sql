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
  v_max_attempts constant integer := 5;
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
