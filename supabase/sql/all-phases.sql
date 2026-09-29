-- ============================================================
-- RUin: all-phases.sql
--
-- The whole database schema in its current state - the single source of
-- truth. Run it in full in the Supabase SQL Editor, on a fresh project or on
-- the existing one. It is one transaction, so it either applies completely
-- or changes nothing, and every statement is safe to re-run (create ... if
-- not exists, create or replace, drop ... if exists before re-creating).
--
-- Changing the schema means editing the object where it is defined:
--   - Functions: edit in place. New parameters or a new return type need a
--     `drop function if exists` of the old signature right before it, or the
--     old overload stays behind.
--   - Tables: `create table if not exists` does nothing to an existing table.
--     Change the create statement (for fresh projects) and add the matching
--     `alter table ... if not exists` or drop-and-add of a constraint right
--     after it (for the existing database).
--   - Something no longer needed: remove it and add its drop to "Retired
--     objects" at the end.
-- Git keeps the history of every change.
--
-- Rules the whole file follows (see SECURITY_MODEL.md):
--   - No direct table access for the client. RLS is on for every table and
--     only the reads under "Row level security policies" are allowed; all
--     the rest goes through SECURITY DEFINER functions, which check the
--     organizer, owner or photo token themselves.
--   - Supabase grants EXECUTE on every new function to anon and
--     authenticated, so the functions meant only for the Edge Functions
--     (service_role) revoke it explicitly.
--   - Storage files can't be deleted from SQL in this project ("Direct
--     deletion from storage tables is not allowed"); the delete-event-data
--     and cleanup-expired-events Edge Functions remove them through the
--     Storage API.
--   - events.datetime is wall-clock time in Europe/Prague.
-- ============================================================

begin;

-- ==================== Extensions ====================

create extension if not exists pgcrypto;

-- ==================== Tables ====================
-- normalize_phone comes first: table checks and indexes below use it.

create or replace function public.normalize_phone(p_phone text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(trim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'), '');
$$;

create table if not exists public.events (
  id text primary key,
  name text not null,
  location text not null,
  datetime timestamp without time zone not null,
  description text not null,
  organizer_token text not null unique,
  organizer_name text,
  organizer_pin_hash text,
  organizer_pin_failed_attempts integer not null default 0,
  organizer_pin_locked_until timestamptz,
  require_phone boolean not null default false,
  enable_bring_list boolean not null default true,
  enable_carpool boolean not null default true,
  enable_stops boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.attendees (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  status text not null check (
    status in ('confirmed', 'excused', 'excused_accepted', 'excused_rejected', 'invited')
  ),
  excuse_reason text,
  phone text,
  checked_in_at timestamptz,
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

create table if not exists public.event_chat_message_reactions (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.event_chat_messages(id) on delete cascade,
  sender_name text not null,
  emoji text not null check (emoji in ('👍', '❤️', '😂', '🎉', '🍻')),
  created_at timestamptz not null default now(),
  unique (message_id, sender_name, emoji)
);

create table if not exists public.event_realtime_ticks (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  reason text not null check (reason in (
    'event', 'attendee', 'ping', 'chat_message', 'chat_reaction', 'signup_item', 'signup_claim', 'stop',
    'photo', 'photo_like', 'photo_comment'
  )),
  created_at timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.event_reminders_sent (
  event_id text not null references public.events(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('day_before', 'hour_before')),
  sent_at timestamptz not null default now(),
  primary key (event_id, reminder_type)
);

create table if not exists public.event_reminder_deliveries (
  event_id text not null references public.events(id) on delete cascade,
  reminder_type text not null check (reminder_type in ('day_before', 'hour_before')),
  endpoint text not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent')),
  lease_until timestamptz,
  attempt_count integer not null default 0,
  sent_at timestamptz,
  primary key (event_id, reminder_type, endpoint)
);

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

create table if not exists public.event_signup_claims (
  id bigint generated always as identity primary key,
  item_id bigint not null references public.event_signup_items(id) on delete cascade,
  attendee_name text not null,
  seats integer not null default 1 check (seats > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.event_stops (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  position integer not null default 0,
  name text not null check (length(trim(name)) between 1 and 120),
  location text,
  starts_at_label text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_polls (
  id text primary key,
  creator_token text not null unique,
  creator_name text not null,
  name text not null,
  description text,
  finalized_event_id text references public.events(id) on delete cascade,
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
  created_at timestamptz not null default now()
);

create table if not exists public.event_photos (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  storage_path text not null,
  uploaded_by text not null,
  delete_token_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.event_photo_likes (
  id bigint generated always as identity primary key,
  photo_id bigint not null references public.event_photos(id) on delete cascade,
  event_id text not null references public.events(id) on delete cascade,
  liker_name text not null check (length(liker_name) between 1 and 80),
  created_at timestamptz not null default now()
);

create table if not exists public.event_photo_comments (
  id bigint generated always as identity primary key,
  photo_id bigint not null references public.event_photos(id) on delete cascade,
  event_id text not null references public.events(id) on delete cascade,
  author_name text not null check (length(author_name) between 1 and 80),
  message text not null check (length(message) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.feedback_reports (
  id bigint generated always as identity primary key,
  type text not null check (type in ('bug', 'idea')),
  name text not null check (length(trim(name)) between 1 and 100),
  message text not null check (length(trim(message)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.owners (
  id text primary key,
  token text not null unique,
  name text not null,
  phone text not null,
  code_hash text not null,
  code_failed_attempts integer not null default 0,
  code_locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_groups (
  id bigint generated always as identity primary key,
  owner_id text not null references public.owners(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_group_members (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.contact_groups(id) on delete cascade,
  name text not null,
  phone text not null check (public.normalize_phone(phone) is not null),
  created_at timestamptz not null default now()
);

create table if not exists public.event_templates (
  id bigint generated always as identity primary key,
  owner_id text not null references public.owners(id) on delete cascade,
  name text not null,
  event_name text not null,
  location text not null,
  description text not null,
  require_phone boolean not null default false,
  default_group_id bigint references public.contact_groups(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;
alter table public.attendees enable row level security;
alter table public.attendee_pings enable row level security;
alter table public.event_chat_messages enable row level security;
alter table public.event_chat_message_reactions enable row level security;
alter table public.event_realtime_ticks enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.event_reminders_sent enable row level security;
alter table public.event_reminder_deliveries enable row level security;
alter table public.event_signup_items enable row level security;
alter table public.event_signup_claims enable row level security;
alter table public.event_stops enable row level security;
alter table public.event_polls enable row level security;
alter table public.event_poll_options enable row level security;
alter table public.event_poll_votes enable row level security;
alter table public.event_photos enable row level security;
alter table public.event_photo_likes enable row level security;
alter table public.event_photo_comments enable row level security;
alter table public.feedback_reports enable row level security;
alter table public.owners enable row level security;
alter table public.contact_groups enable row level security;
alter table public.contact_group_members enable row level security;
alter table public.event_templates enable row level security;

-- ==================== Indexes ====================

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
create index if not exists events_created_at_idx
  on public.events (created_at desc);
create index if not exists events_datetime_idx
  on public.events (datetime);
create index if not exists event_realtime_ticks_event_created_idx
  on public.event_realtime_ticks (event_id, created_at desc);
create unique index if not exists attendees_event_phone_normalized_uidx
  on public.attendees (event_id, public.normalize_phone(phone))
  where public.normalize_phone(phone) is not null;
create index if not exists push_subscriptions_event_idx
  on public.push_subscriptions (event_id);
create index if not exists event_chat_message_reactions_message_idx
  on public.event_chat_message_reactions (message_id);
create index if not exists event_signup_items_event_idx
  on public.event_signup_items (event_id);
create index if not exists event_stops_event_idx on public.event_stops (event_id, position);
create index if not exists event_poll_options_poll_idx on public.event_poll_options (poll_id);
create index if not exists event_poll_votes_option_idx on public.event_poll_votes (option_id);
create index if not exists event_photos_event_idx on public.event_photos (event_id);
create unique index if not exists event_poll_votes_poll_voter_lower_uidx
  on public.event_poll_votes (poll_id, lower(voter_name));
create unique index if not exists event_signup_claims_item_lower_name_uidx
  on public.event_signup_claims (item_id, lower(attendee_name));
create index if not exists feedback_reports_created_at_idx
  on public.feedback_reports (created_at desc);
create unique index if not exists owners_phone_normalized_uidx
  on public.owners (public.normalize_phone(phone));
create index if not exists owners_created_at_idx on public.owners (created_at desc);
create unique index if not exists contact_groups_owner_name_lower_uidx
  on public.contact_groups (owner_id, lower(name));
create index if not exists contact_groups_owner_id_idx on public.contact_groups (owner_id);
create unique index if not exists contact_group_members_group_phone_normalized_uidx
  on public.contact_group_members (group_id, public.normalize_phone(phone));
create index if not exists contact_group_members_group_id_idx on public.contact_group_members (group_id);
create unique index if not exists event_templates_owner_name_lower_uidx
  on public.event_templates (owner_id, lower(name));
create index if not exists event_templates_owner_id_idx on public.event_templates (owner_id);
create index if not exists event_templates_default_group_id_idx on public.event_templates (default_group_id);
create unique index if not exists event_photo_likes_photo_name_idx
  on public.event_photo_likes (photo_id, lower(liker_name));
create index if not exists event_photo_likes_event_idx
  on public.event_photo_likes (event_id);
create index if not exists event_photo_comments_photo_created_idx
  on public.event_photo_comments (photo_id, created_at);
create index if not exists event_photo_comments_event_idx
  on public.event_photo_comments (event_id);
create unique index if not exists push_subscriptions_event_endpoint_uidx
  on public.push_subscriptions (event_id, endpoint);
create index if not exists push_subscriptions_endpoint_idx
  on public.push_subscriptions (endpoint);

-- ==================== Events, guests and RSVPs ====================

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
grant execute on function public.get_organizer_path_with_pin(text, text) to anon, authenticated;

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
grant execute on function public.delete_attendee(text, bigint, text) to anon, authenticated;

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
  where a.event_id = p_event_id
    and lower(trim(a.name)) = lower(v_name)
    and a.status = 'confirmed';

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
  on conflict (event_id, target_attendee_id, lower(source_name))
  do update set
    message = excluded.message,
    created_at = now()
  where public.attendee_pings.created_at <= now() - interval '10 minutes';

  if not found then
    raise exception 'Tuhle osobu můžeš šťouchnout znovu až za 10 minut od posledního šťouchnutí.';
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
grant execute on function public.ping_attendee(text, bigint, text, text) to anon, authenticated;

create or replace function public._random_token(p_token_length integer)
returns text
language sql
as $$
  select left(translate(encode(extensions.gen_random_bytes(p_token_length), 'base64'), '+/', '-_'), p_token_length);
$$;
revoke all on function public._random_token(integer) from public, anon, authenticated;

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
grant execute on function public.moderate_attendee(text, bigint, text, text) to anon, authenticated;

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
grant execute on function public.delete_event(text, text) to anon, authenticated;

create or replace function public.invite_attendees(
  p_event_id text,
  p_token text,
  p_invitees jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_item jsonb;
  v_name text;
  v_phone text;
  v_existing_id bigint;
  v_existing_status text;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
begin
  select * into v_event from public.events e where e.id = p_event_id;
  if not found then
    raise exception 'Akce neexistuje.';
  end if;

  if v_event.organizer_token <> p_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  if p_invitees is null or jsonb_typeof(p_invitees) <> 'array' or jsonb_array_length(p_invitees) = 0 then
    raise exception 'Vyplň alespoň jednu osobu k pozvání.';
  end if;

  if jsonb_array_length(p_invitees) > 200 then
    raise exception 'Najednou lze pozvat maximálně 200 lidí.';
  end if;

  for v_item in select jsonb_array_elements(p_invitees)
  loop
    v_name := nullif(trim(v_item->>'name'), '');
    v_phone := public.normalize_phone(v_item->>'phone');

    if v_name is null then
      continue;
    end if;

    v_existing_id := null;
    v_existing_status := null;

    select a.id, a.status
    into v_existing_id, v_existing_status
    from public.attendees a
    where a.event_id = p_event_id
      and (
        (v_phone is not null and public.normalize_phone(a.phone) = v_phone)
        or lower(a.name) = lower(v_name)
      )
    order by (case when v_phone is not null and public.normalize_phone(a.phone) = v_phone then 0 else 1 end)
    limit 1;

    begin
      if v_existing_id is not null then
        if v_existing_status = 'invited' then
          update public.attendees
          set name = v_name, phone = coalesce(v_phone, phone)
          where id = v_existing_id;
          v_updated := v_updated + 1;
        else
          v_skipped := v_skipped + 1;
        end if;
      else
        insert into public.attendees (event_id, name, status, phone)
        values (p_event_id, v_name, 'invited', v_phone);
        v_inserted := v_inserted + 1;
      end if;
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object('invited', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
end;
$$;
grant execute on function public.invite_attendees(text, text, jsonb) to anon, authenticated;

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
  v_invited_match_id bigint := null;
begin
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

  -- Claim a pre-invited placeholder row by phone, regardless of what name
  -- the person types (organizer wrote "Jarda", they type "Jaroslav").
  -- Restricted to status='invited' on purpose: it can never repoint an
  -- already-answered attendee's row to a different name via a phone
  -- collision - that stays a hard error below, exactly as before.
  if v_phone is not null then
    select a.id into v_invited_match_id
    from public.attendees a
    where a.event_id = p_event_id
      and a.status = 'invited'
      and public.normalize_phone(a.phone) = v_phone
    limit 1;
  end if;

  if v_invited_match_id is not null then
    begin
      update public.attendees
      set
        name = v_name,
        status = p_status,
        excuse_reason = case when p_status = 'excused' then v_excuse_reason else null end,
        phone = v_phone
      where id = v_invited_match_id
      returning * into v_attendee;
    exception
      when unique_violation then
        raise exception 'Tohle jméno je na této akci už obsazené jiným účastníkem.';
    end;

    return jsonb_build_object('attendee', to_jsonb(v_attendee) - 'phone');
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

  -- phone is deliberately excluded from the response - see the original
  -- comment on this function from Phase 6: submit_rsvp is callable by
  -- anyone with an attendee's exact name, so returning the full row would
  -- hand back an existing attendee's phone number to whoever guesses it.
  return jsonb_build_object('attendee', to_jsonb(v_attendee) - 'phone');
end;
$$;
grant execute on function public.submit_rsvp(text, text, text, text, text) to anon, authenticated;

create or replace function public.create_event(
  p_name text,
  p_location text,
  p_datetime timestamp without time zone,
  p_description text,
  p_organizer_name text,
  p_organizer_pin text,
  p_require_phone boolean default false,
  p_enable_bring_list boolean default true,
  p_enable_carpool boolean default true,
  p_enable_stops boolean default true
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
  v_attempts integer := 0;
begin
  if v_name is null or v_location is null or p_datetime is null or v_description is null or v_organizer_name is null then
    raise exception 'Vyplň svoje jméno, název, místo, datum a stručný popis akce.';
  end if;

  if v_organizer_pin is null or v_organizer_pin !~ '^[0-9]{4}$' then
    raise exception 'Správcovský PIN musí mít přesně 4 číslice.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
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
    organizer_name,
    organizer_pin_hash,
    organizer_pin_failed_attempts,
    organizer_pin_locked_until,
    require_phone,
    enable_bring_list,
    enable_carpool,
    enable_stops
  )
  values (
    v_id,
    v_name,
    v_location,
    p_datetime,
    v_description,
    v_token,
    v_organizer_name,
    extensions.crypt(v_organizer_pin, extensions.gen_salt('bf')),
    0,
    null,
    coalesce(p_require_phone, false),
    coalesce(p_enable_bring_list, true),
    coalesce(p_enable_carpool, true),
    coalesce(p_enable_stops, true)
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
      'requirePhone', coalesce(p_require_phone, false),
      'enableBringList', coalesce(p_enable_bring_list, true),
      'enableCarpool', coalesce(p_enable_carpool, true),
      'enableStops', coalesce(p_enable_stops, true)
    ),
    'guestPath', '/event/' || v_id,
    'organizerPath', '/event/' || v_id || '/manage?token=' || v_token
  );
end;
$$;
grant execute on function public.create_event(text, text, timestamp without time zone, text, text, text, boolean, boolean, boolean, boolean) to anon, authenticated;

create or replace function public.update_event(
  p_event_id text,
  p_token text,
  p_name text,
  p_location text,
  p_datetime timestamp without time zone,
  p_description text,
  p_require_phone boolean,
  p_enable_bring_list boolean default true,
  p_enable_carpool boolean default true,
  p_enable_stops boolean default true
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
  v_description text := nullif(trim(p_description), '');
  v_previous_datetime timestamp without time zone;
  v_event public.events%rowtype;
begin
  if v_token is null then
    raise exception 'Správa vyžaduje platný organizátorský odkaz.';
  end if;

  if v_name is null or v_location is null or p_datetime is null or v_description is null then
    raise exception 'Vyplň název, místo, datum a stručný popis akce.';
  end if;

  select e.datetime into v_previous_datetime
  from public.events e
  where e.id = p_event_id and e.organizer_token = v_token
  for update;

  if not found then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  update public.events e
  set
    name = v_name,
    location = v_location,
    datetime = p_datetime,
    description = v_description,
    require_phone = p_require_phone,
    enable_bring_list = coalesce(p_enable_bring_list, true),
    enable_carpool = coalesce(p_enable_carpool, true),
    enable_stops = coalesce(p_enable_stops, true)
  where e.id = p_event_id
    and e.organizer_token = v_token
  returning * into v_event;

  if not found then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  if v_previous_datetime is distinct from p_datetime then
    delete from public.event_reminders_sent where event_id = p_event_id;
    delete from public.event_reminder_deliveries where event_id = p_event_id;
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object(
      'id', v_event.id,
      'name', v_event.name,
      'location', v_event.location,
      'datetime', v_event.datetime,
      'description', v_event.description,
      'requirePhone', v_event.require_phone,
      'enableBringList', v_event.enable_bring_list,
      'enableCarpool', v_event.enable_carpool,
      'enableStops', v_event.enable_stops
    )
  );
end;
$$;
grant execute on function public.update_event(text, text, text, text, timestamp without time zone, text, boolean, boolean, boolean, boolean) to anon, authenticated;

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
  select *
  into v_event
  from public.events e
  where e.id = p_event_id;

  if not found then
    raise exception 'Tahle akce už neexistuje.';
  end if;

  -- A wrong token is refused, not served as a guest: otherwise the
  -- management page would open with it and only its actions would fail.
  if p_organizer_token is not null and p_organizer_token is distinct from v_event.organizer_token then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  v_is_organizer := p_organizer_token is not null;

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
          when 'invited' then 0
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
    'rejected', count(*) filter (where a.status = 'excused_rejected'),
    'invited', count(*) filter (where a.status = 'invited')
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
      'requirePhone', v_event.require_phone,
      'organizerName', v_event.organizer_name,
      'enableBringList', v_event.enable_bring_list,
      'enableCarpool', v_event.enable_carpool,
      'enableStops', v_event.enable_stops
    ),
    'attendees', v_attendees,
    'summary', v_summary
  );
end;
$$;
grant execute on function public.get_event_payload(text, text) to anon, authenticated;

-- ==================== Chat ====================

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

create or replace function public.get_event_chat_messages(
  p_event_id text,
  p_limit integer default 120
)
returns table (id bigint, event_id text, sender_name text, message text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select m.id, m.event_id, m.sender_name, m.message, m.created_at
  from public.event_chat_messages m
  where m.event_id = p_event_id
  order by m.created_at desc
  limit greatest(coalesce(p_limit, 120), 1);
$$;
grant execute on function public.get_event_chat_messages(text, integer) to anon, authenticated;

create or replace function public.send_event_chat_message(
  p_event_id text,
  p_sender_name text,
  p_message text
)
returns table (id bigint, event_id text, sender_name text, message text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text := nullif(trim(p_sender_name), '');
  v_message text := nullif(trim(p_message), '');
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if v_sender_name is null then
    raise exception 'Pro odeslání zprávy vyplň svoje jméno.';
  end if;

  if v_message is null then
    raise exception 'Napiš zprávu do chatu.';
  end if;

  return query
  insert into public.event_chat_messages as m (event_id, sender_name, message)
  values (p_event_id, v_sender_name, v_message)
  returning m.id, m.event_id, m.sender_name, m.message, m.created_at;
end;
$$;
grant execute on function public.send_event_chat_message(text, text, text) to anon, authenticated;

create or replace function public.get_chat_reactions(
  p_event_id text,
  p_message_ids bigint[]
)
returns table (id bigint, message_id bigint, sender_name text, emoji text)
language sql
security definer
set search_path = public
as $$
  select r.id, r.message_id, r.sender_name, r.emoji
  from public.event_chat_message_reactions r
  join public.event_chat_messages m on m.id = r.message_id
  where m.event_id = p_event_id
    and r.message_id = any(p_message_ids);
$$;
grant execute on function public.get_chat_reactions(text, bigint[]) to anon, authenticated;

-- ==================== Bring list and carpool ====================

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
grant execute on function public.add_signup_item(text, text, text, integer, text, text) to anon, authenticated;

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
grant execute on function public.delete_signup_item(text, bigint, text) to anon, authenticated;

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

  select * into v_item from public.event_signup_items where id = p_item_id for update;

  if not found then
    raise exception 'Položka nebyla nalezena.';
  end if;

  if v_item.category = 'ride' and lower(trim(v_item.created_by)) = lower(v_name) then
    raise exception 'Jako řidič už místo v autě máš, nemůžeš se přihlásit na vlastní nabídku odvozu.';
  end if;

  select coalesce(sum(seats), 0) into v_claimed_seats
  from public.event_signup_claims
  where item_id = p_item_id and lower(attendee_name) <> lower(v_name);

  if v_claimed_seats + greatest(coalesce(p_seats, 1), 1) > v_item.capacity then
    raise exception 'Už je to obsazené.';
  end if;

  insert into public.event_signup_claims (item_id, attendee_name, seats)
  values (p_item_id, v_name, greatest(coalesce(p_seats, 1), 1))
  on conflict (item_id, lower(attendee_name)) do update
    set seats = excluded.seats;

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.claim_signup_item(bigint, text, integer) to anon, authenticated;

create or replace function public.get_event_signup_items(p_event_id text)
returns table (
  id bigint,
  event_id text,
  category text,
  label text,
  capacity integer,
  note text,
  created_by text,
  created_at timestamptz,
  event_signup_claims jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    i.id, i.event_id, i.category, i.label, i.capacity, i.note, i.created_by, i.created_at,
    coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', c.id, 'attendee_name', c.attendee_name, 'seats', c.seats) order by c.created_at asc)
        from public.event_signup_claims c
        where c.item_id = i.id
      ),
      '[]'::jsonb
    ) as event_signup_claims
  from public.event_signup_items i
  where i.event_id = p_event_id
  order by i.created_at asc;
$$;
grant execute on function public.get_event_signup_items(text) to anon, authenticated;

create or replace function public.unclaim_signup_item(
  p_item_id bigint,
  p_attendee_name text,
  p_requester_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target text := nullif(trim(p_attendee_name), '');
  v_requester text := nullif(trim(p_requester_name), '');
begin
  if v_target is null then
    raise exception 'Chybí jméno.';
  end if;

  if v_requester is null or lower(v_requester) <> lower(v_target) then
    raise exception 'Odhlásit můžeš jen svoje vlastní přihlášení.';
  end if;

  delete from public.event_signup_claims
  where item_id = p_item_id and lower(attendee_name) = lower(v_target);

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.unclaim_signup_item(bigint, text, text) to anon, authenticated;

create or replace function public.remove_signup_claim(
  p_item_id bigint,
  p_claim_attendee_name text,
  p_requester_name text,
  p_organizer_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requester text := nullif(trim(p_requester_name), '');
  v_target text := nullif(trim(p_claim_attendee_name), '');
  v_item public.event_signup_items%rowtype;
  v_event public.events%rowtype;
  v_is_organizer boolean := false;
begin
  if v_target is null then
    raise exception 'Chybí jméno účastníka k odebrání.';
  end if;

  select * into v_item from public.event_signup_items where id = p_item_id;

  if not found then
    raise exception 'Položka nebyla nalezena.';
  end if;

  if p_organizer_token is not null then
    select * into v_event from public.events where id = v_item.event_id;
    v_is_organizer := found and v_event.organizer_token = p_organizer_token;
  end if;

  if not v_is_organizer then
    if v_requester is null then
      raise exception 'Chybí jméno.';
    end if;

    if v_item.category <> 'ride' or lower(trim(v_item.created_by)) <> lower(v_requester) then
      raise exception 'Jen ten, kdo nabídku odvozu založil, může někoho odebrat.';
    end if;
  end if;

  delete from public.event_signup_claims
  where item_id = p_item_id and lower(attendee_name) = lower(v_target);

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.remove_signup_claim(bigint, text, text, text) to anon, authenticated;

-- ==================== Stops ====================

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
grant execute on function public.add_event_stop(text, text, text, text, text) to anon, authenticated;

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
grant execute on function public.delete_event_stop(text, text, bigint) to anon, authenticated;

create or replace function public.get_event_stops(p_event_id text)
returns table (id bigint, event_id text, "position" integer, name text, location text, starts_at_label text)
language sql
security definer
set search_path = public
as $$
  select s.id, s.event_id, s.position, s.name, s.location, s.starts_at_label
  from public.event_stops s
  where s.event_id = p_event_id
  order by s.position asc;
$$;
grant execute on function public.get_event_stops(text) to anon, authenticated;

-- ==================== Polls ====================

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
  v_attempts integer := 0;
  v_option jsonb;
  v_option_datetime timestamp without time zone;
begin
  perform public._delete_expired_polls();

  if v_creator_name is null or v_name is null then
    raise exception 'Vyplň svoje jméno a název ankety.';
  end if;

  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    raise exception 'Přidej aspoň dvě možnosti.';
  end if;

  if jsonb_array_length(p_options) < 2 or jsonb_array_length(p_options) > 5 then
    raise exception 'Anketa může mít 2 až 5 možností.';
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
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
    if jsonb_typeof(v_option) <> 'object'
      or nullif(trim(v_option->>'datetime'), '') is null
      or nullif(trim(v_option->>'location'), '') is null then
      raise exception 'Každá možnost musí mít platné datum a místo.';
    end if;

    v_option_datetime := (v_option->>'datetime')::timestamp without time zone;
    if v_option_datetime <= (now() at time zone 'Europe/Prague') then
      raise exception 'Termín možnosti musí být v budoucnosti.';
    end if;

    insert into public.event_poll_options (poll_id, datetime, location, note)
    values (
      v_id,
      v_option_datetime,
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
grant execute on function public.create_event_poll(text, text, text, jsonb) to anon, authenticated;

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
grant execute on function public.get_poll_payload(text, text) to anon, authenticated;

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
  v_poll public.event_polls%rowtype;
  v_option_datetime timestamp without time zone;
begin
  perform public._delete_expired_polls();

  select * into v_poll from public.event_polls where id = p_poll_id for update;

  if not found then
    raise exception 'Anketa neexistuje.';
  end if;

  if v_poll.finalized_event_id is not null then
    raise exception 'Tahle anketa už byla vyhodnocená.';
  end if;

  if v_name is null then
    raise exception 'Napiš svoje jméno pro hlasování.';
  end if;

  select o.datetime into v_option_datetime
  from public.event_poll_options o
  where o.id = p_option_id and o.poll_id = p_poll_id;

  if not found then
    raise exception 'Tahle možnost neexistuje.';
  end if;

  if v_option_datetime <= (now() at time zone 'Europe/Prague') then
    raise exception 'Termín možnosti musí být v budoucnosti.';
  end if;

  insert into public.event_poll_votes (poll_id, option_id, voter_name)
  values (p_poll_id, p_option_id, v_name)
  on conflict (poll_id, lower(voter_name)) do update
    set option_id = excluded.option_id, voter_name = excluded.voter_name, created_at = now();

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.vote_event_poll(text, bigint, text) to anon, authenticated;

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

  -- Locks the poll row so two concurrent finalize calls (e.g. a double-click)
  -- can't both pass the "not yet finalized" check below before either
  -- commits - the second one blocks until the first's UPDATE commits, then
  -- sees finalized_event_id already set and raises instead of creating a
  -- second, orphaned duplicate event.
  select * into v_poll from public.event_polls where id = p_poll_id for update;

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

  if v_option.datetime <= (now() at time zone 'Europe/Prague') then
    raise exception 'Termín možnosti musí být v budoucnosti.';
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
grant execute on function public.finalize_event_poll(text, text, bigint, text, text) to anon, authenticated;

-- ==================== Photos, likes and comments ====================

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
grant execute on function public.get_event_photos(text) to anon, authenticated;

create or replace function public.can_upload_event_photo(p_storage_path text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_folders text[] := storage.foldername(p_storage_path);
  v_event_id text;
  v_photo_count integer;
begin
  if coalesce(array_length(v_folders, 1), 0) <> 1 then
    return false;
  end if;

  v_event_id := v_folders[1];
  perform pg_advisory_xact_lock(hashtextextended(v_event_id, 0));

  perform 1 from public.events e where e.id = v_event_id for key share;
  if not found then
    return false;
  end if;

  select count(*)::integer
  into v_photo_count
  from storage.objects o
  where o.bucket_id = 'event-photos'
    and (storage.foldername(o.name))[1] = v_event_id;

  return v_photo_count < 50;
end;
$$;
revoke all on function public.can_upload_event_photo(text) from public;
grant execute on function public.can_upload_event_photo(text) to anon, authenticated;

create or replace function public.record_event_photo(
  p_event_id text,
  p_storage_path text,
  p_uploaded_by text,
  p_delete_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uploaded_by text := nullif(trim(p_uploaded_by), '');
  v_delete_token_hash text := encode(extensions.digest(nullif(p_delete_token, ''), 'sha256'), 'hex');
  v_file_stem text := split_part(storage.filename(p_storage_path), '.', 1);
  v_folders text[] := storage.foldername(p_storage_path);
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if v_uploaded_by is null then
    raise exception 'Chybí jméno nahrávajícího.';
  end if;

  if coalesce(array_length(v_folders, 1), 0) <> 1 or v_folders[1] <> p_event_id then
    raise exception 'Fotka nepatří k této akci.';
  end if;

  -- A file named after a token hash needs that token; a token needs a file
  -- named after its hash. Older clients send neither (random file names).
  if (v_delete_token_hash is not null or v_file_stem ~ '^[0-9a-f]{64}$') and v_delete_token_hash is distinct from v_file_stem then
    raise exception 'Fotku může přidat jen ten, kdo ji nahrál.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_storage_path, 0));

  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'event-photos' and o.name = p_storage_path
  ) then
    raise exception 'Nahraná fotka nebyla nalezena.';
  end if;

  if exists (select 1 from public.event_photos p where p.storage_path = p_storage_path) then
    raise exception 'Fotka už byla přidána.';
  end if;

  insert into public.event_photos (event_id, storage_path, uploaded_by, delete_token_hash)
  values (p_event_id, p_storage_path, v_uploaded_by, v_delete_token_hash);

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.record_event_photo(text, text, text, text) to anon, authenticated;

create or replace function public.authorize_event_photo_delete(
  p_event_id text,
  p_photo_id bigint,
  p_token text default null,
  p_photo_token text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_organizer boolean := exists (select 1 from public.events e where e.id = p_event_id and e.organizer_token = p_token);
  v_photo_token text := nullif(p_photo_token, '');
  v_storage_path text;
  v_delete_token_hash text;
begin
  if not v_is_organizer and v_photo_token is null then
    raise exception 'Neplatný organizátorský odkaz.';
  end if;

  select p.storage_path, p.delete_token_hash
  into v_storage_path, v_delete_token_hash
  from public.event_photos p
  where p.id = p_photo_id and p.event_id = p_event_id;

  if v_storage_path is null then
    raise exception 'Fotka nebyla nalezena.';
  end if;

  if not v_is_organizer and v_delete_token_hash is distinct from encode(extensions.digest(v_photo_token, 'sha256'), 'hex') then
    raise exception 'Tuhle fotku může smazat jen ten, kdo ji nahrál, nebo organizátor.';
  end if;

  return v_storage_path;
end;
$$;
revoke all on function public.authorize_event_photo_delete(text, bigint, text, text) from public, anon, authenticated;
grant execute on function public.authorize_event_photo_delete(text, bigint, text, text) to service_role;

create or replace function public.delete_event_photo(
  p_event_id text,
  p_token text,
  p_photo_id bigint,
  p_photo_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.authorize_event_photo_delete(p_event_id, p_photo_id, p_token, p_photo_token);

  -- Storage cleanup happens in the delete-event-data Edge Function before
  -- this RPC is called - this project rejects direct DML against
  -- storage.objects, see the comment on delete_events_by_ids().
  delete from public.event_photos where id = p_photo_id and event_id = p_event_id;

  return jsonb_build_object('success', true);
end;
$$;
revoke all on function public.delete_event_photo(text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.delete_event_photo(text, text, bigint, text) to service_role;

create or replace function public.get_event_photo_likes(p_event_id text)
returns table (photo_id bigint, liker_name text)
language sql
security definer
set search_path = public
as $$
  select l.photo_id, l.liker_name
  from public.event_photo_likes l
  where l.event_id = p_event_id
  order by l.created_at asc, l.id asc;
$$;
grant execute on function public.get_event_photo_likes(text) to anon, authenticated;

create or replace function public.get_event_photo_comments(p_event_id text)
returns table (id bigint, photo_id bigint, author_name text, message text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select c.id, c.photo_id, c.author_name, c.message, c.created_at
  from public.event_photo_comments c
  where c.event_id = p_event_id
  order by c.created_at asc, c.id asc;
$$;
grant execute on function public.get_event_photo_comments(text) to anon, authenticated;

create or replace function public.toggle_event_photo_like(
  p_event_id text,
  p_photo_id bigint,
  p_liker_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_liker_name text := nullif(trim(p_liker_name), '');
begin
  if v_liker_name is null then
    raise exception 'Pro lajk vyplň svoje jméno.';
  end if;

  if length(v_liker_name) > 80 then
    raise exception 'Jméno je moc dlouhé.';
  end if;

  if not exists (select 1 from public.event_photos p where p.id = p_photo_id and p.event_id = p_event_id) then
    raise exception 'Fotka nebyla nalezena.';
  end if;

  delete from public.event_photo_likes l
  where l.photo_id = p_photo_id and lower(l.liker_name) = lower(v_liker_name);

  if found then
    return jsonb_build_object('success', true, 'liked', false);
  end if;

  -- A concurrent like under the same name already did the job.
  insert into public.event_photo_likes (photo_id, event_id, liker_name)
  values (p_photo_id, p_event_id, v_liker_name)
  on conflict do nothing;

  return jsonb_build_object('success', true, 'liked', true);
end;
$$;
grant execute on function public.toggle_event_photo_like(text, bigint, text) to anon, authenticated;

create or replace function public.add_event_photo_comment(
  p_event_id text,
  p_photo_id bigint,
  p_author_name text,
  p_message text
)
returns table (id bigint, photo_id bigint, author_name text, message text, created_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_author_name text := nullif(trim(p_author_name), '');
  v_message text := nullif(trim(p_message), '');
  v_last_comment_at timestamptz;
begin
  if v_author_name is null then
    raise exception 'Pro komentář vyplň svoje jméno.';
  end if;

  if length(v_author_name) > 80 then
    raise exception 'Jméno je moc dlouhé.';
  end if;

  if v_message is null then
    raise exception 'Napiš komentář.';
  end if;

  if length(v_message) > 500 then
    raise exception 'Komentář může mít nejvýš 500 znaků.';
  end if;

  -- Locks the photo against other comments on it (so the per-photo cap
  -- below holds) and against its deletion, but not against likes.
  perform 1 from public.event_photos p where p.id = p_photo_id and p.event_id = p_event_id for no key update;

  if not found then
    raise exception 'Fotka nebyla nalezena.';
  end if;

  -- The same 3-second throttle per name as the chat.
  select max(c.created_at)
  into v_last_comment_at
  from public.event_photo_comments c
  where c.event_id = p_event_id and lower(c.author_name) = lower(v_author_name);

  if v_last_comment_at > now() - interval '3 seconds' then
    raise exception 'Komentáře posíláš moc rychle, chvilku počkej.';
  end if;

  if (select count(*) from public.event_photo_comments c where c.photo_id = p_photo_id) >= 200 then
    raise exception 'Tahle fotka už má maximum komentářů.';
  end if;

  return query
  insert into public.event_photo_comments as c (photo_id, event_id, author_name, message)
  values (p_photo_id, p_event_id, v_author_name, v_message)
  returning c.id, c.photo_id, c.author_name, c.message, c.created_at;
end;
$$;
grant execute on function public.add_event_photo_comment(text, bigint, text, text) to anon, authenticated;

create or replace function public.delete_event_photo_comment(
  p_event_id text,
  p_token text,
  p_comment_id bigint
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

  delete from public.event_photo_comments c
  where c.id = p_comment_id and c.event_id = p_event_id;

  if not found then
    raise exception 'Komentář nebyl nalezen.';
  end if;

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.delete_event_photo_comment(text, text, bigint) to anon, authenticated;

-- The storage paths of an event's photos, for the Edge Functions that remove
-- them through the Storage API (deleting from storage.objects directly is
-- refused, see delete_events_by_ids). starts_with, not like: event ids can
-- contain '_'.
create or replace function public.list_event_photo_paths(p_event_id text)
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'event-photos' and starts_with(o.name, p_event_id || '/')
  order by o.name;
$$;
revoke all on function public.list_event_photo_paths(text) from public, anon, authenticated;
grant execute on function public.list_event_photo_paths(text) to service_role;

-- ==================== Push reminders ====================

create or replace function public.register_push_subscription(
  p_event_id text,
  p_endpoint text,
  p_p256dh text,
  p_auth text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_endpoint text := nullif(trim(p_endpoint), '');
  v_p256dh text := nullif(trim(p_p256dh), '');
  v_auth text := nullif(trim(p_auth), '');
begin
  if not exists (select 1 from public.events e where e.id = p_event_id) then
    raise exception 'Akce neexistuje.';
  end if;

  if v_endpoint is null or v_p256dh is null or v_auth is null then
    raise exception 'Neplatné přihlášení k odběru notifikací.';
  end if;

  insert into public.push_subscriptions (event_id, endpoint, p256dh, auth)
  values (p_event_id, v_endpoint, v_p256dh, v_auth)
  on conflict (event_id, endpoint) do nothing;

  -- The keys belong to the browser's subscription, which all its events share.
  update public.push_subscriptions s
  set p256dh = v_p256dh, auth = v_auth
  where s.endpoint = v_endpoint
    and (s.p256dh <> v_p256dh or s.auth <> v_auth);

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.register_push_subscription(text, text, text, text) to anon, authenticated;

create or replace function public.unregister_push_subscription(
  p_endpoint text,
  p_event_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.push_subscriptions s
  where s.endpoint = trim(p_endpoint)
    and (p_event_id is null or s.event_id = p_event_id);

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.unregister_push_subscription(text, text) to anon, authenticated;

create or replace function public.is_push_subscribed(
  p_event_id text,
  p_endpoint text
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.push_subscriptions s
    where s.event_id = p_event_id and s.endpoint = trim(p_endpoint)
  );
$$;
grant execute on function public.is_push_subscribed(text, text) to anon, authenticated;

create or replace function public.get_pending_event_reminders()
returns table (
  event_id text,
  reminder_type text,
  name text,
  location text,
  datetime timestamp without time zone,
  starts_in_seconds integer,
  starts_today boolean,
  starts_at_label text
)
language sql
security definer
set search_path = public
as $$
  with now_local as (
    select (now() at time zone 'Europe/Prague') as ts
  )
  select
    e.id, 'day_before', e.name, e.location, e.datetime,
    extract(epoch from (e.datetime - now_local.ts))::integer,
    e.datetime::date = now_local.ts::date,
    to_char(e.datetime, 'FMHH24:MI')
  from public.events e, now_local
  where e.datetime <= now_local.ts + interval '24 hours'
    and e.datetime > now_local.ts + interval '2 hours'
    and not exists (
      select 1 from public.event_reminders_sent r
      where r.event_id = e.id and r.reminder_type = 'day_before'
    )
  union all
  select
    e.id, 'hour_before', e.name, e.location, e.datetime,
    extract(epoch from (e.datetime - now_local.ts))::integer,
    e.datetime::date = now_local.ts::date,
    to_char(e.datetime, 'FMHH24:MI')
  from public.events e, now_local
  where e.datetime <= now_local.ts + interval '1 hour'
    and e.datetime > now_local.ts
    and not exists (
      select 1 from public.event_reminders_sent r
      where r.event_id = e.id and r.reminder_type = 'hour_before'
    );
$$;
revoke all on function public.get_pending_event_reminders() from public, anon, authenticated;
grant execute on function public.get_pending_event_reminders() to service_role;

create or replace function public.claim_event_reminder_deliveries(
  p_event_id text,
  p_reminder_type text
)
returns table (endpoint text, p256dh text, auth text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_reminder_type not in ('day_before', 'hour_before') then
    raise exception 'Neplatný typ připomínky.';
  end if;

  insert into public.event_reminder_deliveries (event_id, reminder_type, endpoint)
  select s.event_id, p_reminder_type, s.endpoint
  from public.push_subscriptions s
  where s.event_id = p_event_id
  on conflict (event_id, reminder_type, endpoint) do nothing;

  return query
  with claimable as (
    select d.event_id, d.reminder_type, d.endpoint
    from public.event_reminder_deliveries d
    join public.push_subscriptions s
      on s.event_id = d.event_id and s.endpoint = d.endpoint
    where d.event_id = p_event_id
      and d.reminder_type = p_reminder_type
      and (d.status = 'pending' or (d.status = 'sending' and d.lease_until <= now()))
    order by d.endpoint
    limit 100
    for update of d skip locked
  ), claimed as (
    update public.event_reminder_deliveries d
    set status = 'sending',
        lease_until = now() + interval '5 minutes',
        attempt_count = d.attempt_count + 1
    from claimable c
    where d.event_id = c.event_id
      and d.reminder_type = c.reminder_type
      and d.endpoint = c.endpoint
    returning d.event_id, d.reminder_type, d.endpoint
  )
  select s.endpoint, s.p256dh, s.auth
  from claimed c
  join public.push_subscriptions s
    on s.event_id = c.event_id and s.endpoint = c.endpoint;
end;
$$;
revoke all on function public.claim_event_reminder_deliveries(text, text) from public, anon, authenticated;
grant execute on function public.claim_event_reminder_deliveries(text, text) to service_role;

create or replace function public.mark_event_reminder_delivery(
  p_event_id text,
  p_reminder_type text,
  p_endpoint text,
  p_sent boolean
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.event_reminder_deliveries
  set status = case when p_sent then 'sent' else 'sending' end,
      lease_until = case when p_sent then null else now() + interval '10 minutes' end,
      sent_at = case when p_sent then now() else null end
  where event_id = p_event_id
    and reminder_type = p_reminder_type
    and endpoint = p_endpoint
    and status = 'sending';
$$;
revoke all on function public.mark_event_reminder_delivery(text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.mark_event_reminder_delivery(text, text, text, boolean) to service_role;

create or replace function public.complete_event_reminder(
  p_event_id text,
  p_reminder_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1
    from public.push_subscriptions s
    left join public.event_reminder_deliveries d
      on d.event_id = s.event_id
     and d.reminder_type = p_reminder_type
     and d.endpoint = s.endpoint
    where s.event_id = p_event_id
      and d.status is distinct from 'sent'
  ) then
    return false;
  end if;

  insert into public.event_reminders_sent (event_id, reminder_type)
  values (p_event_id, p_reminder_type)
  on conflict (event_id, reminder_type) do nothing;

  return true;
end;
$$;
revoke all on function public.complete_event_reminder(text, text) from public, anon, authenticated;
grant execute on function public.complete_event_reminder(text, text) to service_role;

create or replace function public.delete_push_subscription_by_endpoint(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.event_reminder_deliveries where endpoint = p_endpoint;
  delete from public.push_subscriptions where endpoint = p_endpoint;
end;
$$;
revoke all on function public.delete_push_subscription_by_endpoint(text) from public, anon, authenticated;
grant execute on function public.delete_push_subscription_by_endpoint(text) to service_role;

-- ==================== Expired events ====================

create or replace function public.delete_events_by_ids(p_event_ids text[])
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.events
    where id = any(p_event_ids)
    returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke all on function public.delete_events_by_ids(text[]) from public, anon, authenticated;
grant execute on function public.delete_events_by_ids(text[]) to service_role;

create or replace function public.get_expired_event_ids()
returns text[]
language sql
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id), '{}')
  from public.events e
  where e.datetime + interval '7 days' < (now() at time zone 'Europe/Prague');
$$;
revoke all on function public.get_expired_event_ids() from public, anon, authenticated;
grant execute on function public.get_expired_event_ids() to service_role;

-- ==================== Realtime ticks ====================

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

create or replace function public.emit_event_realtime_tick_from_chat_reactions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text;
begin
  select m.event_id into v_event_id
  from public.event_chat_messages m
  where m.id = coalesce(new.message_id, old.message_id);

  perform public.emit_event_realtime_tick(v_event_id, 'chat_reaction');
  return coalesce(new, old);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_signup_claims()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id text;
begin
  select i.event_id into v_event_id
  from public.event_signup_items i
  where i.id = coalesce(new.item_id, old.item_id);

  perform public.emit_event_realtime_tick(v_event_id, 'signup_claim');
  return coalesce(new, old);
end;
$$;

create or replace function public.emit_event_realtime_tick_from_event_row()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.emit_event_realtime_tick(coalesce(new.event_id, old.event_id), tg_argv[0]);
  return coalesce(new, old);
end;
$$;

-- ==================== Feedback ====================

create or replace function public.submit_feedback_report(
  p_type text,
  p_name text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_message text := nullif(trim(p_message), '');
begin
  if p_type not in ('bug', 'idea') then
    raise exception 'Neplatný typ hlášení.';
  end if;

  if v_name is null then
    raise exception 'Napiš svoje jméno.';
  end if;

  if length(v_name) > 100 then
    raise exception 'Jméno je moc dlouhé.';
  end if;

  if v_message is null then
    raise exception 'Napiš prosím pár slov.';
  end if;

  if length(v_message) > 2000 then
    raise exception 'Text je moc dlouhý (limit 2000 znaků).';
  end if;

  insert into public.feedback_reports (type, name, message)
  values (p_type, v_name, v_message);

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.submit_feedback_report(text, text, text) to anon, authenticated;

create or replace function public.get_feedback_reports()
returns table (id bigint, type text, name text, message text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select r.id, r.type, r.name, r.message, r.created_at
  from public.feedback_reports r
  order by r.created_at desc;
$$;
grant execute on function public.get_feedback_reports() to anon, authenticated;

-- ==================== Owner accounts, contact groups and templates ====================

create or replace function public.access_owner_account(
  p_name text,
  p_phone text,
  p_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(p_name), '');
  v_phone text := public.normalize_phone(p_phone);
  v_code text := nullif(trim(p_code), '');
  v_owner public.owners%rowtype;
  v_id text;
  v_token text;
  v_attempts integer := 0;
begin
  if v_name is null then
    raise exception 'Vyplň své jméno.';
  end if;

  if v_phone is null then
    raise exception 'Vyplň telefonní číslo.';
  end if;

  if v_code is null or v_code !~ '^[0-9]{6}$' then
    raise exception 'Kód musí mít přesně 6 číslic.';
  end if;

  select *
  into v_owner
  from public.owners o
  where public.normalize_phone(o.phone) = v_phone
  for update;

  if found then
    if v_owner.code_locked_until is not null and v_owner.code_locked_until > now() then
      raise exception 'Kód je dočasně zablokovaný. Zkus to později.';
    end if;

    if extensions.crypt(v_code, v_owner.code_hash) <> v_owner.code_hash then
      update public.owners
      set
        code_failed_attempts = code_failed_attempts + 1,
        code_locked_until = case
          when code_failed_attempts + 1 >= 15 then now() + interval '24 hours'
          when code_failed_attempts + 1 >= 10 then now() + interval '1 hour'
          when code_failed_attempts + 1 >= 5 then now() + interval '15 minutes'
          else code_locked_until
        end
      where id = v_owner.id;

      raise exception 'Neplatný kód.';
    end if;

    update public.owners
    set
      name = v_name,
      code_failed_attempts = 0,
      code_locked_until = null
    where id = v_owner.id
    returning * into v_owner;

    return jsonb_build_object('ownerId', v_owner.id, 'token', v_owner.token);
  end if;

  loop
    v_attempts := v_attempts + 1;
    if v_attempts > 20 then
      raise exception 'Nepodařilo se vytvořit jedinečný identifikátor.';
    end if;

    v_id := public._random_token(10);
    exit when not exists (select 1 from public.owners o where o.id = v_id);
  end loop;

  loop
    v_token := public._random_token(24);
    exit when not exists (select 1 from public.owners o where o.token = v_token);
  end loop;

  begin
    insert into public.owners (id, token, name, phone, code_hash, code_failed_attempts, code_locked_until)
    values (v_id, v_token, v_name, v_phone, extensions.crypt(v_code, extensions.gen_salt('bf')), 0, null);
  exception
    when unique_violation then
      raise exception 'Zkus to znovu, prosím.';
  end;

  return jsonb_build_object('ownerId', v_id, 'token', v_token);
end;
$$;
grant execute on function public.access_owner_account(text, text, text) to anon, authenticated;

create or replace function public.get_owner_payload(
  p_owner_id text,
  p_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
  v_groups jsonb;
  v_templates jsonb;
begin
  select *
  into v_owner
  from public.owners o
  where o.id = p_owner_id;

  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', g.id,
        'name', g.name,
        'createdAt', g.created_at,
        'members', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object('id', m.id, 'name', m.name, 'phone', m.phone, 'createdAt', m.created_at)
              order by lower(m.name) asc
            ),
            '[]'::jsonb
          )
          from public.contact_group_members m
          where m.group_id = g.id
        )
      )
      order by lower(g.name) asc
    ),
    '[]'::jsonb
  )
  into v_groups
  from public.contact_groups g
  where g.owner_id = p_owner_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'name', t.name,
        'eventName', t.event_name,
        'location', t.location,
        'description', t.description,
        'requirePhone', t.require_phone,
        'defaultGroupId', t.default_group_id,
        'createdAt', t.created_at
      )
      order by lower(t.name) asc
    ),
    '[]'::jsonb
  )
  into v_templates
  from public.event_templates t
  where t.owner_id = p_owner_id;

  return jsonb_build_object('groups', v_groups, 'templates', v_templates);
end;
$$;
grant execute on function public.get_owner_payload(text, text) to anon, authenticated;

create or replace function public.create_contact_group(
  p_owner_id text,
  p_token text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_group public.contact_groups%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  if v_name is null then
    raise exception 'Vyplň název skupiny.';
  end if;

  if (select count(*) from public.contact_groups g where g.owner_id = p_owner_id) >= 25 then
    raise exception 'Maximálně 25 skupin na účet.';
  end if;

  begin
    insert into public.contact_groups (owner_id, name)
    values (p_owner_id, v_name)
    returning * into v_group;
  exception
    when unique_violation then
      raise exception 'Skupina s tímto názvem už existuje.';
  end;

  return jsonb_build_object(
    'group', jsonb_build_object('id', v_group.id, 'name', v_group.name, 'createdAt', v_group.created_at, 'members', '[]'::jsonb)
  );
end;
$$;
grant execute on function public.create_contact_group(text, text, text) to anon, authenticated;

create or replace function public.rename_contact_group(
  p_owner_id text,
  p_token text,
  p_group_id bigint,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_group public.contact_groups%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  if v_name is null then
    raise exception 'Vyplň název skupiny.';
  end if;

  begin
    update public.contact_groups
    set name = v_name
    where id = p_group_id and owner_id = p_owner_id
    returning * into v_group;
  exception
    when unique_violation then
      raise exception 'Skupina s tímto názvem už existuje.';
  end;

  if not found then
    raise exception 'Skupina nebyla nalezena.';
  end if;

  return jsonb_build_object('group', jsonb_build_object('id', v_group.id, 'name', v_group.name));
end;
$$;
grant execute on function public.rename_contact_group(text, text, bigint, text) to anon, authenticated;

create or replace function public.delete_contact_group(
  p_owner_id text,
  p_token text,
  p_group_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  delete from public.contact_groups where id = p_group_id and owner_id = p_owner_id;

  if not found then
    raise exception 'Skupina nebyla nalezena.';
  end if;

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.delete_contact_group(text, text, bigint) to anon, authenticated;

create or replace function public.add_contact_group_member(
  p_owner_id text,
  p_token text,
  p_group_id bigint,
  p_name text,
  p_phone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_phone text := public.normalize_phone(p_phone);
  v_member public.contact_group_members%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  if not exists (select 1 from public.contact_groups g where g.id = p_group_id and g.owner_id = p_owner_id) then
    raise exception 'Skupina nebyla nalezena.';
  end if;

  if v_name is null then
    raise exception 'Vyplň jméno.';
  end if;

  if v_phone is null then
    raise exception 'Vyplň telefonní číslo.';
  end if;

  if length(v_phone) > 20 then
    raise exception 'Telefonní číslo je příliš dlouhé.';
  end if;

  if (select count(*) from public.contact_group_members m where m.group_id = p_group_id) >= 200 then
    raise exception 'Maximálně 200 lidí ve skupině.';
  end if;

  begin
    insert into public.contact_group_members (group_id, name, phone)
    values (p_group_id, v_name, v_phone)
    returning * into v_member;
  exception
    when unique_violation then
      raise exception 'Tohle telefonní číslo je ve skupině už použité.';
  end;

  return jsonb_build_object('member', jsonb_build_object('id', v_member.id, 'name', v_member.name, 'phone', v_member.phone));
end;
$$;
grant execute on function public.add_contact_group_member(text, text, bigint, text, text) to anon, authenticated;

create or replace function public.remove_contact_group_member(
  p_owner_id text,
  p_token text,
  p_group_id bigint,
  p_member_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  if not exists (select 1 from public.contact_groups g where g.id = p_group_id and g.owner_id = p_owner_id) then
    raise exception 'Skupina nebyla nalezena.';
  end if;

  delete from public.contact_group_members where id = p_member_id and group_id = p_group_id;

  if not found then
    raise exception 'Osoba nebyla nalezena.';
  end if;

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.remove_contact_group_member(text, text, bigint, bigint) to anon, authenticated;

create or replace function public.create_event_template(
  p_owner_id text,
  p_token text,
  p_name text,
  p_event_name text,
  p_location text,
  p_description text,
  p_require_phone boolean,
  p_default_group_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_event_name text := nullif(trim(p_event_name), '');
  v_location text := nullif(trim(p_location), '');
  v_description text := nullif(trim(p_description), '');
  v_template public.event_templates%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  if v_name is null or v_event_name is null or v_location is null or v_description is null then
    raise exception 'Vyplň název šablony, název akce, místo a popis.';
  end if;

  if p_default_group_id is not null
     and not exists (select 1 from public.contact_groups g where g.id = p_default_group_id and g.owner_id = p_owner_id) then
    raise exception 'Neplatná skupina.';
  end if;

  if (select count(*) from public.event_templates t where t.owner_id = p_owner_id) >= 25 then
    raise exception 'Maximálně 25 šablon na účet.';
  end if;

  begin
    insert into public.event_templates (owner_id, name, event_name, location, description, require_phone, default_group_id)
    values (p_owner_id, v_name, v_event_name, v_location, v_description, coalesce(p_require_phone, false), p_default_group_id)
    returning * into v_template;
  exception
    when unique_violation then
      raise exception 'Šablona s tímto názvem už existuje.';
  end;

  return jsonb_build_object('template', to_jsonb(v_template));
end;
$$;
grant execute on function public.create_event_template(text, text, text, text, text, text, boolean, bigint) to anon, authenticated;

create or replace function public.update_event_template(
  p_owner_id text,
  p_token text,
  p_template_id bigint,
  p_name text,
  p_event_name text,
  p_location text,
  p_description text,
  p_require_phone boolean,
  p_default_group_id bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
  v_name text := nullif(trim(p_name), '');
  v_event_name text := nullif(trim(p_event_name), '');
  v_location text := nullif(trim(p_location), '');
  v_description text := nullif(trim(p_description), '');
  v_template public.event_templates%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  if v_name is null or v_event_name is null or v_location is null or v_description is null then
    raise exception 'Vyplň název šablony, název akce, místo a popis.';
  end if;

  if p_default_group_id is not null
     and not exists (select 1 from public.contact_groups g where g.id = p_default_group_id and g.owner_id = p_owner_id) then
    raise exception 'Neplatná skupina.';
  end if;

  begin
    update public.event_templates
    set
      name = v_name,
      event_name = v_event_name,
      location = v_location,
      description = v_description,
      require_phone = coalesce(p_require_phone, false),
      default_group_id = p_default_group_id
    where id = p_template_id and owner_id = p_owner_id
    returning * into v_template;
  exception
    when unique_violation then
      raise exception 'Šablona s tímto názvem už existuje.';
  end;

  if not found then
    raise exception 'Šablona nebyla nalezena.';
  end if;

  return jsonb_build_object('template', to_jsonb(v_template));
end;
$$;
grant execute on function public.update_event_template(text, text, bigint, text, text, text, text, boolean, bigint) to anon, authenticated;

create or replace function public.delete_event_template(
  p_owner_id text,
  p_token text,
  p_template_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner public.owners%rowtype;
begin
  select * into v_owner from public.owners o where o.id = p_owner_id;
  if not found or v_owner.token <> p_token then
    raise exception 'Neplatný přístupový token.';
  end if;

  delete from public.event_templates where id = p_template_id and owner_id = p_owner_id;

  if not found then
    raise exception 'Šablona nebyla nalezena.';
  end if;

  return jsonb_build_object('success', true);
end;
$$;
grant execute on function public.delete_event_template(text, text, bigint) to anon, authenticated;

-- ==================== Row level security policies ====================
-- RLS is on for every table (see Tables) and nothing is allowed without a
-- policy, so only the reads the client really does directly are listed.

drop policy if exists "event_realtime_ticks_select_allowed" on public.event_realtime_ticks;
create policy "event_realtime_ticks_select_allowed"
  on public.event_realtime_ticks
  for select
  to anon, authenticated
  using (true);

drop policy if exists "event_photos_storage_select" on storage.objects;
create policy "event_photos_storage_select"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'event-photos');

drop policy if exists "event_photos_storage_insert" on storage.objects;
create policy "event_photos_storage_insert"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'event-photos' and public.can_upload_event_photo(name));

-- ==================== Triggers ====================

drop trigger if exists attendees_emit_event_realtime_tick_tg on public.attendees;
create trigger attendees_emit_event_realtime_tick_tg
after insert or update or delete on public.attendees
for each row
execute function public.emit_event_realtime_tick_from_event_row('attendee');

drop trigger if exists events_emit_event_realtime_tick_tg on public.events;
create trigger events_emit_event_realtime_tick_tg
after update or delete on public.events
for each row
execute function public.emit_event_realtime_tick_from_events();

drop trigger if exists attendee_pings_emit_event_realtime_tick_tg on public.attendee_pings;
create trigger attendee_pings_emit_event_realtime_tick_tg
after insert on public.attendee_pings
for each row
execute function public.emit_event_realtime_tick_from_event_row('ping');

drop trigger if exists event_chat_messages_emit_event_realtime_tick_tg on public.event_chat_messages;
create trigger event_chat_messages_emit_event_realtime_tick_tg
after insert on public.event_chat_messages
for each row
execute function public.emit_event_realtime_tick_from_event_row('chat_message');

drop trigger if exists event_chat_reactions_emit_event_realtime_tick_tg on public.event_chat_message_reactions;
create trigger event_chat_reactions_emit_event_realtime_tick_tg
after insert or delete on public.event_chat_message_reactions
for each row
execute function public.emit_event_realtime_tick_from_chat_reactions();

drop trigger if exists event_signup_items_emit_event_realtime_tick_tg on public.event_signup_items;
create trigger event_signup_items_emit_event_realtime_tick_tg
after insert or delete on public.event_signup_items
for each row
execute function public.emit_event_realtime_tick_from_event_row('signup_item');

drop trigger if exists event_signup_claims_emit_event_realtime_tick_tg on public.event_signup_claims;
create trigger event_signup_claims_emit_event_realtime_tick_tg
after insert or delete on public.event_signup_claims
for each row
execute function public.emit_event_realtime_tick_from_signup_claims();

drop trigger if exists event_stops_emit_event_realtime_tick_tg on public.event_stops;
create trigger event_stops_emit_event_realtime_tick_tg
after insert or delete on public.event_stops
for each row
execute function public.emit_event_realtime_tick_from_event_row('stop');

drop trigger if exists event_photos_emit_event_realtime_tick_tg on public.event_photos;
create trigger event_photos_emit_event_realtime_tick_tg
after insert or delete on public.event_photos
for each row
execute function public.emit_event_realtime_tick_from_event_row('photo');

drop trigger if exists event_photo_likes_emit_event_realtime_tick_tg on public.event_photo_likes;
create trigger event_photo_likes_emit_event_realtime_tick_tg
after insert or delete on public.event_photo_likes
for each row
execute function public.emit_event_realtime_tick_from_event_row('photo_like');

drop trigger if exists event_photo_comments_emit_event_realtime_tick_tg on public.event_photo_comments;
create trigger event_photo_comments_emit_event_realtime_tick_tg
after insert or delete on public.event_photo_comments
for each row
execute function public.emit_event_realtime_tick_from_event_row('photo_comment');

-- ==================== Realtime ====================
-- Clients subscribe to event_realtime_ticks only and refetch through the
-- RPCs above; the data tables themselves are not readable directly.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_realtime_ticks') then
    alter publication supabase_realtime add table public.event_realtime_ticks;
  end if;
end;
$$;

-- ==================== Storage ====================

insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', true)
on conflict (id) do nothing;
update storage.buckets
set file_size_limit = 10485760, 
    allowed_mime_types = array['image/*']
where id = 'event-photos';

-- ==================== Retired objects ====================
-- What earlier versions of this file created and nothing uses any more.
-- Safe to delete this section once it has run on production.

drop trigger if exists event_chat_messages_normalize_tg on public.event_chat_messages;
drop policy if exists "event_chat_insert_allowed" on public.event_chat_messages;
drop policy if exists "events_select_none" on public.events;
drop policy if exists "events_insert_none" on public.events;
drop policy if exists "events_update_none" on public.events;
drop policy if exists "events_delete_none" on public.events;
drop policy if exists "attendees_select_none" on public.attendees;
drop policy if exists "attendees_insert_none" on public.attendees;
drop policy if exists "attendees_update_none" on public.attendees;
drop policy if exists "attendees_delete_none" on public.attendees;
drop policy if exists "event_chat_update_none" on public.event_chat_messages;
drop policy if exists "event_chat_delete_none" on public.event_chat_messages;
drop policy if exists "event_realtime_ticks_insert_none" on public.event_realtime_ticks;
drop policy if exists "event_realtime_ticks_update_none" on public.event_realtime_ticks;
drop policy if exists "event_realtime_ticks_delete_none" on public.event_realtime_ticks;
drop policy if exists "event_reminder_deliveries_no_direct_access" on public.event_reminder_deliveries;
drop policy if exists "push_subscriptions_no_direct_access" on public.push_subscriptions;
drop policy if exists "event_reminders_sent_no_direct_access" on public.event_reminders_sent;
drop policy if exists "event_chat_message_reactions_no_direct_write" on public.event_chat_message_reactions;
drop policy if exists "event_chat_message_reactions_no_direct_delete" on public.event_chat_message_reactions;
drop policy if exists "event_signup_items_no_direct_write" on public.event_signup_items;
drop policy if exists "event_signup_items_no_direct_delete" on public.event_signup_items;
drop policy if exists "event_signup_claims_no_direct_write" on public.event_signup_claims;
drop policy if exists "event_signup_claims_no_direct_delete" on public.event_signup_claims;
drop policy if exists "event_stops_no_direct_write" on public.event_stops;
drop policy if exists "event_stops_no_direct_delete" on public.event_stops;
drop policy if exists "event_polls_no_direct_write" on public.event_polls;
drop policy if exists "event_poll_options_no_direct_write" on public.event_poll_options;
drop policy if exists "event_poll_votes_no_direct_write" on public.event_poll_votes;
drop policy if exists "event_photos_no_direct_write" on public.event_photos;
drop policy if exists "event_photos_no_direct_delete" on public.event_photos;
drop policy if exists "attendee_pings_select_none" on public.attendee_pings;
drop policy if exists "attendee_pings_insert_none" on public.attendee_pings;
drop policy if exists "attendee_pings_update_none" on public.attendee_pings;
drop policy if exists "attendee_pings_delete_none" on public.attendee_pings;
drop policy if exists "event_polls_select" on public.event_polls;
drop policy if exists "event_poll_options_select" on public.event_poll_options;
drop policy if exists "event_poll_votes_select" on public.event_poll_votes;
drop policy if exists "event_photos_select" on public.event_photos;
drop policy if exists "event_chat_select_allowed" on public.event_chat_messages;
drop policy if exists "event_chat_message_reactions_select" on public.event_chat_message_reactions;
drop policy if exists "event_signup_items_select" on public.event_signup_items;
drop policy if exists "event_signup_claims_select" on public.event_signup_claims;
drop policy if exists "event_stops_select" on public.event_stops;
drop policy if exists "feedback_reports_no_direct_access" on public.feedback_reports;
drop policy if exists "owners_select_none" on public.owners;
drop policy if exists "owners_insert_none" on public.owners;
drop policy if exists "owners_update_none" on public.owners;
drop policy if exists "owners_delete_none" on public.owners;
drop policy if exists "contact_groups_select_none" on public.contact_groups;
drop policy if exists "contact_groups_insert_none" on public.contact_groups;
drop policy if exists "contact_groups_update_none" on public.contact_groups;
drop policy if exists "contact_groups_delete_none" on public.contact_groups;
drop policy if exists "contact_group_members_select_none" on public.contact_group_members;
drop policy if exists "contact_group_members_insert_none" on public.contact_group_members;
drop policy if exists "contact_group_members_update_none" on public.contact_group_members;
drop policy if exists "contact_group_members_delete_none" on public.contact_group_members;
drop policy if exists "event_templates_select_none" on public.event_templates;
drop policy if exists "event_templates_insert_none" on public.event_templates;
drop policy if exists "event_templates_update_none" on public.event_templates;
drop policy if exists "event_templates_delete_none" on public.event_templates;
drop policy if exists "event_photo_likes_no_direct_access" on public.event_photo_likes;
drop policy if exists "event_photo_comments_no_direct_access" on public.event_photo_comments;
drop function if exists public.can_post_event_chat(text, text, text);
drop function if exists public.normalize_event_chat_message();
drop function if exists public.event_exists(text);
drop function if exists public.emit_event_realtime_tick_from_attendees();
drop function if exists public.emit_event_realtime_tick_from_pings();
drop function if exists public.emit_event_realtime_tick_from_chat_messages();
drop function if exists public.emit_event_realtime_tick_from_signup_items();
drop function if exists public.emit_event_realtime_tick_from_stops();
drop function if exists public.mark_event_reminder_sent(text, text);
drop function if exists public.get_push_subscriptions_for_event(text);

do $$
declare
  v_table text;
begin
  for v_table in select tablename from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename <> all (array['event_realtime_ticks'])
  loop
    execute format('alter publication supabase_realtime drop table public.%I', v_table);
  end loop;
end;
$$;

commit;
