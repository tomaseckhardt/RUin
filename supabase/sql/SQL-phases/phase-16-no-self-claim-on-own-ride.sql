-- Phase 16: Stop a ride offer's own creator from claiming a seat on it, and
-- let the driver remove a passenger they don't want to take after all.
-- Run this after phase-15 on existing databases.
--
-- 1) claim_signup_item never checked whether the claimant is the same
--    person who created the item. For a 'ride' item (someone offering to
--    drive), that meant the driver could claim one of their own offered
--    seats, silently eating into the capacity meant for actual passengers.
--    Guarded here the same way ping_attendee already guards against
--    self-pings.
--
-- 2) unclaim_signup_item lets an attendee remove their own claim, but there
--    was no way for a driver to remove someone ELSE's claim from their own
--    ride (e.g. they no longer want to take that person). New
--    remove_signup_claim RPC does exactly that, gated on the requester
--    actually being the item's creator.
--
-- Left out of scope: 'bring' items, where the creator claiming a slot is
-- meaningful (e.g. the organizer lists "Beer, 3 needed" and also brings some
-- themselves) - both changes here only apply to 'ride' items.

begin;

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

  if v_item.category = 'ride' and lower(trim(v_item.created_by)) = lower(v_name) then
    raise exception 'Jako řidič už místo v autě máš, nemůžeš se přihlásit na vlastní nabídku odvozu.';
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

grant execute on function public.claim_signup_item(bigint, text, integer) to anon, authenticated;

create or replace function public.remove_signup_claim(
  p_item_id bigint,
  p_claim_attendee_name text,
  p_requester_name text
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
begin
  if v_requester is null then
    raise exception 'Chybí jméno.';
  end if;

  if v_target is null then
    raise exception 'Chybí jméno účastníka k odebrání.';
  end if;

  select * into v_item from public.event_signup_items where id = p_item_id;

  if not found then
    raise exception 'Položka nebyla nalezena.';
  end if;

  if v_item.category <> 'ride' or lower(trim(v_item.created_by)) <> lower(v_requester) then
    raise exception 'Jen ten, kdo nabídku odvozu založil, může někoho odebrat.';
  end if;

  delete from public.event_signup_claims
  where item_id = p_item_id and attendee_name = v_target;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.remove_signup_claim(bigint, text, text) to anon, authenticated;

commit;
