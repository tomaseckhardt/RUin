-- Phase 12: Fix case-sensitive voter matching in event polls.
-- Run this after phase-11 on existing databases.
--
-- Bug: vote_event_poll's uniqueness was on the raw (poll_id, voter_name) pair,
-- so "Tomáš" and "tomáš" produced two separate vote rows instead of one
-- updated vote, inconsistent with how every other name lookup in this app
-- (attendees, pings, chat) already compares names case-insensitively.

begin;

alter table public.event_poll_votes
  drop constraint if exists event_poll_votes_poll_id_voter_name_key;

create unique index if not exists event_poll_votes_poll_voter_lower_uidx
  on public.event_poll_votes (poll_id, lower(voter_name));

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
  on conflict (poll_id, lower(voter_name)) do update
    set option_id = excluded.option_id, voter_name = excluded.voter_name, created_at = now();

  return jsonb_build_object('success', true);
end;
$$;

commit;
