-- ============================================================
-- RUin: supabase-stub.sql
--
-- CI only: turns a plain Postgres into just enough of a Supabase database
-- for supabase/sql/all-phases.sql and supabase/tests/security.sql to run.
-- Never run it on a real Supabase project, which already has all of this.
--
-- It mirrors what those two files rely on:
--   - the anon, authenticated and service_role roles, with Supabase's
--     default privileges (every new table and function in public is granted
--     to them, so a missing revoke fails security.sql here as it would there)
--   - pgcrypto in the extensions schema
--   - a minimal storage schema: storage.buckets, storage.objects and
--     Supabase's own storage.foldername / storage.filename
--   - the supabase_realtime publication
-- ============================================================

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

-- Copied from Supabase's storage schema.
create function storage.foldername(name text)
returns text[]
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end;
$$;

create function storage.filename(name text)
returns text
language plpgsql
as $$
declare
  _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end;
$$;

create publication supabase_realtime;
