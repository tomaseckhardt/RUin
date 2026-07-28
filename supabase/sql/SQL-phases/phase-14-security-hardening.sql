-- Phase 14: Security/correctness hardening found during a project-wide review.
-- Run this after phase-13 on existing databases.
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
-- 5) organizer_pin_attempts was created (with indexes) but is dead code -
--    grep confirms nothing in this schema or the app ever inserts into it or
--    reads from it, and it never got RLS either. Dropped rather than left as
--    an unused, unprotected table that looks like it does something.

begin;

create or replace function public._random_token(token_length integer)
returns text
language plpgsql
as $$
declare
  chars constant text := '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  chars_len constant integer := length(chars);
  result text := '';
  random_bytes bytea;
  i integer;
begin
  if token_length is null or token_length < 1 then
    raise exception 'Neplatná délka tokenu.';
  end if;

  random_bytes := extensions.gen_random_bytes(token_length);

  for i in 1..token_length loop
    result := result || substr(chars, (get_byte(random_bytes, i - 1) % chars_len) + 1, 1);
  end loop;

  return result;
end;
$$;

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
  perform public._delete_expired_events();

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

  return jsonb_build_object('attendee', to_jsonb(v_attendee));
end;
$$;

grant execute on function public.submit_rsvp(text, text, text, text, text) to anon, authenticated;

drop table if exists public.organizer_pin_attempts;

commit;
