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
