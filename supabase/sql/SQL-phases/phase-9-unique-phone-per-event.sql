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