-- Phase 1: Base schema in Supabase (Postgres)
-- Mirrors current SQLite model from server/src/db.js

begin;

create table if not exists public.events (
  id text primary key,
  name text not null,
  location text not null,
  datetime timestamp without time zone not null,
  description text not null,
  organizer_token text not null unique,
  organizer_pin_hash text not null,
  organizer_pin_failed_attempts integer not null default 0,
  organizer_pin_locked_until timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.attendees (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  status text not null check (
    status in ('confirmed', 'excused', 'excused_accepted', 'excused_rejected')
  ),
  excuse_reason text,
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

create or replace function public.normalize_event_chat_message()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sender_name := trim(new.sender_name);
  new.message := trim(new.message);
  return new;
end;
$$;

drop trigger if exists event_chat_messages_normalize_tg on public.event_chat_messages;
create trigger event_chat_messages_normalize_tg
before insert or update on public.event_chat_messages
for each row
execute function public.normalize_event_chat_message();

create table if not exists public.organizer_pin_attempts (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  source_name text not null,
  outcome text not null check (outcome in ('failed_invalid_pin', 'failed_locked')),
  attempted_at timestamptz not null default now()
);

-- Enforce one RSVP per attendee name in the same event, case-insensitive.
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

create index if not exists organizer_pin_attempts_event_idx
  on public.organizer_pin_attempts (event_id);

create index if not exists organizer_pin_attempts_event_attempted_idx
  on public.organizer_pin_attempts (event_id, attempted_at desc);

create index if not exists events_created_at_idx
  on public.events (created_at desc);

create index if not exists events_datetime_idx
  on public.events (datetime);

grant select, insert on table public.event_chat_messages to anon, authenticated;
grant usage, select on sequence public.event_chat_messages_id_seq to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'event_chat_messages'
     ) then
    execute 'alter publication supabase_realtime add table public.event_chat_messages';
  end if;
end;
$$;

commit;
