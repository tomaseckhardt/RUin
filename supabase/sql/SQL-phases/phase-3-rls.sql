-- Phase 3: RLS hardening
-- Goal: block direct table access from anon/authenticated and allow app flow through RPC only.

begin;

alter table public.events enable row level security;
alter table public.attendees enable row level security;
alter table public.event_chat_messages enable row level security;

create or replace function public.event_exists(p_event_id text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
  );
$$;

grant execute on function public.event_exists(text) to anon, authenticated;

create or replace function public.can_post_event_chat(
  p_event_id text,
  p_sender_name text,
  p_message text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text := nullif(trim(p_sender_name), '');
  v_message text := nullif(trim(p_message), '');
  v_last_message_at timestamptz;
begin
  if not public.event_exists(p_event_id) then
    return false;
  end if;

  if v_sender_name is null or length(v_sender_name) > 80 then
    return false;
  end if;

  if v_message is null or length(v_message) > 500 then
    return false;
  end if;

  if not exists (
    select 1
    from public.attendees a
    where a.event_id = p_event_id
      and lower(trim(a.name)) = lower(v_sender_name)
      and a.status in ('confirmed', 'excused', 'excused_accepted', 'excused_rejected')
  ) then
    return false;
  end if;

  select max(m.created_at)
  into v_last_message_at
  from public.event_chat_messages m
  where m.event_id = p_event_id
    and lower(trim(m.sender_name)) = lower(v_sender_name);

  if v_last_message_at is not null and v_last_message_at > now() - interval '3 seconds' then
    return false;
  end if;

  return true;
end;
$$;

grant execute on function public.can_post_event_chat(text, text, text) to anon, authenticated;

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

-- Optional cleanup if you iterate on policies repeatedly.
drop policy if exists "events_select_none" on public.events;
drop policy if exists "events_insert_none" on public.events;
drop policy if exists "events_update_none" on public.events;
drop policy if exists "events_delete_none" on public.events;

drop policy if exists "attendees_select_none" on public.attendees;
drop policy if exists "attendees_insert_none" on public.attendees;
drop policy if exists "attendees_update_none" on public.attendees;
drop policy if exists "attendees_delete_none" on public.attendees;

drop policy if exists "event_chat_select_allowed" on public.event_chat_messages;
drop policy if exists "event_chat_insert_allowed" on public.event_chat_messages;
drop policy if exists "event_chat_update_none" on public.event_chat_messages;
drop policy if exists "event_chat_delete_none" on public.event_chat_messages;

-- Explicit deny policies keep intent clear in dashboard.
create policy "events_select_none"
  on public.events
  for select
  to anon, authenticated
  using (false);

create policy "events_insert_none"
  on public.events
  for insert
  to anon, authenticated
  with check (false);

create policy "events_update_none"
  on public.events
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "events_delete_none"
  on public.events
  for delete
  to anon, authenticated
  using (false);

create policy "attendees_select_none"
  on public.attendees
  for select
  to anon, authenticated
  using (false);

create policy "attendees_insert_none"
  on public.attendees
  for insert
  to anon, authenticated
  with check (false);

create policy "attendees_update_none"
  on public.attendees
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "attendees_delete_none"
  on public.attendees
  for delete
  to anon, authenticated
  using (false);

create policy "event_chat_select_allowed"
  on public.event_chat_messages
  for select
  to anon, authenticated
  using (public.event_exists(event_chat_messages.event_id));

create policy "event_chat_insert_allowed"
  on public.event_chat_messages
  for insert
  to anon, authenticated
  with check (
    public.can_post_event_chat(event_chat_messages.event_id, event_chat_messages.sender_name, event_chat_messages.message)
  );

create policy "event_chat_update_none"
  on public.event_chat_messages
  for update
  to anon, authenticated
  using (false)
  with check (false);

create policy "event_chat_delete_none"
  on public.event_chat_messages
  for delete
  to anon, authenticated
  using (false);

commit;
