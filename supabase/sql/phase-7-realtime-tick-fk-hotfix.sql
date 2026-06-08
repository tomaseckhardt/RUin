-- Phase 7: Hotfix for event_realtime_ticks FK violations during event cleanup.
-- Run this on existing databases after phase-6.

begin;

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

commit;
