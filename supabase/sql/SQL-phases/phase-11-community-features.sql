-- Phase 11: Check-in, chat reactions, signup lists (bring/ride), multi-stop
-- itinerary, date/location polls, and event photos.
-- Run this after phase-10 on existing databases.

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
language sql
security definer
set search_path = public
as $$
  delete from public.event_signup_claims
  where item_id = p_item_id and attendee_name = trim(p_attendee_name);
  select jsonb_build_object('success', true);
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
  attempts integer := 0;
  v_option jsonb;
begin
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
declare
  v_path text;
begin
  if not exists (select 1 from public.events e where e.id = p_event_id and e.organizer_token = p_token) then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  select storage_path into v_path from public.event_photos where id = p_photo_id and event_id = p_event_id;

  if v_path is not null then
    delete from storage.objects where bucket_id = 'event-photos' and name = v_path;
  end if;

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
