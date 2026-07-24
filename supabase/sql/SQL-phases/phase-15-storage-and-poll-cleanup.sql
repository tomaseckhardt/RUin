-- Phase 15: Clean up orphaned photo storage + give polls their own lifecycle.
-- Run this after phase-14 on existing databases.
--
-- 1) Deleting an event (organizer "Smazat akci", or automatic 7-days-after
--    cascade in _delete_expired_events()) only ever removed the event_photos
--    DB rows via FK cascade - the actual image files in the `event-photos`
--    Storage bucket were never touched, so every event that ever had photos
--    left them behind forever, with no remaining reference to even find them
--    again once the row was gone. Both delete paths now also delete the
--    matching storage.objects rows for that event's photo path prefix
--    (`<event_id>/...`), same as delete_event_photo already does for a single
--    photo.
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

create or replace function public._delete_expired_events()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer := 0;
  v_expired_id text;
begin
  for v_expired_id in
    select e.id from public.events e where e.datetime + interval '7 days' < now()::timestamp
  loop
    delete from storage.objects
    where bucket_id = 'event-photos' and name like v_expired_id || '/%';
  end loop;

  delete from public.events e
  where e.datetime + interval '7 days' < now()::timestamp;

  get diagnostics v_deleted = row_count;
  return v_deleted;
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

  delete from storage.objects
  where bucket_id = 'event-photos' and name like p_event_id || '/%';

  delete from public.events e
  where e.id = p_event_id;

  return jsonb_build_object('success', true);
end;
$$;

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
  attempts integer := 0;
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
    attempts := attempts + 1;
    if attempts > 20 then
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

commit;
