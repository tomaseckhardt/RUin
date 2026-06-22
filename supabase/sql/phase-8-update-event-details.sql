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
