-- Phase 4: Preserve event time as local wall-clock value (no timezone shifts)
-- Run this on existing projects that already used timestamptz in events.datetime.

begin;

alter table public.events
  alter column datetime type timestamp without time zone
  using datetime::timestamp;

drop function if exists public.create_event(text, text, timestamptz, text);

create or replace function public.create_event(
  p_name text,
  p_location text,
  p_datetime timestamp without time zone,
  p_description text
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
  v_id text;
  v_token text;
  attempts integer := 0;
begin
  if v_name is null or v_location is null or p_datetime is null or v_description is null then
    raise exception 'Vyplň název, místo, datum a stručný popis akce.';
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

  insert into public.events (id, name, location, datetime, description, organizer_token)
  values (v_id, v_name, v_location, p_datetime, v_description, v_token);

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

grant execute on function public.create_event(text, text, timestamp without time zone, text) to anon, authenticated;

commit;
