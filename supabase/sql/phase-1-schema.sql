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
  created_at timestamptz not null default now()
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

create index if not exists events_created_at_idx
  on public.events (created_at desc);

commit;
