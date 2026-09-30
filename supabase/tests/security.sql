-- ============================================================
-- RUin: security.sql
--
-- Checks the database's security rules against the live schema. Paste it
-- into the Supabase SQL Editor after running supabase/sql/all-phases.sql
-- and run it.
--
-- It changes nothing: everything runs inside one transaction that ends with
-- ROLLBACK, including the throwaway event, guest, poll and owner account it
-- creates (Realtime never sees rolled-back rows either).
--
-- Every check raises `OK ...` as a notice when it passes (visible in psql,
-- or in the editor's notices where it shows them). The first check that
-- fails stops the script with `FAIL ...` and the reason, and the
-- transaction is rolled back. If the last result reads "All security
-- checks passed.", every check passed.
-- ============================================================

begin;

-- Passes when p_ok is true (a NULL counts as a failure).
create function pg_temp.expect(p_label text, p_ok boolean)
returns void
language plpgsql
as $$
begin
  if coalesce(p_ok, false) then
    raise notice 'OK %', p_label;
  else
    raise exception 'FAIL %', p_label;
  end if;
end;
$$;

-- Passes when running p_sql raises exactly p_expected.
create function pg_temp.expect_error(p_label text, p_sql text, p_expected text)
returns void
language plpgsql
as $$
begin
  begin
    execute p_sql;
  exception
    when others then
      if sqlerrm = p_expected then
        raise notice 'OK %', p_label;
        return;
      end if;

      raise exception 'FAIL %: expected "%", got "%"', p_label, p_expected, sqlerrm;
  end;

  raise exception 'FAIL %: expected "%", but the call went through', p_label, p_expected;
end;
$$;

do $$
declare
  v_event_datetime timestamp without time zone := date_trunc('minute', now() at time zone 'Europe/Prague') + interval '2 days';
  v_event_id text;
  v_token text;
  v_attendee_id bigint;
  v_poll_id text;
  v_option_id bigint;
  v_owner_id text;
  v_result jsonb;
  v_bad_token text;
  v_label text;
  v_function text;
  v_role text;
begin
  -- ==================== Throwaway data ====================

  -- The organizer "Tester" becomes the event's first confirmed guest.
  v_result := public.create_event(
    'Security test', 'Nowhere', v_event_datetime, 'Throwaway event of supabase/tests/security.sql', 'Tester', '1234'
  );
  v_event_id := v_result->'event'->>'id';
  select e.organizer_token into v_token from public.events e where e.id = v_event_id;

  v_result := public.submit_rsvp(v_event_id, 'Excused guest', 'excused', 'Busy', null);
  v_attendee_id := (v_result->'attendee'->>'id')::bigint;

  v_result := public.create_event_poll(
    'Tester',
    'Security poll',
    null,
    jsonb_build_array(
      jsonb_build_object('datetime', to_char(v_event_datetime, 'YYYY-MM-DD"T"HH24:MI'), 'location', 'A'),
      jsonb_build_object('datetime', to_char(v_event_datetime + interval '1 day', 'YYYY-MM-DD"T"HH24:MI'), 'location', 'B')
    )
  );
  v_poll_id := v_result->>'pollId';
  select o.id into v_option_id from public.event_poll_options o where o.poll_id = v_poll_id order by o.id limit 1;

  -- A phone number no real account uses.
  v_result := public.access_owner_account('Security test', '+000 0000 0001', '123456');
  v_owner_id := v_result->>'ownerId';

  -- ==================== Missing and wrong tokens ====================
  -- `token <> p_token` is NULL, not true, for a NULL token, so every check
  -- has to be `is distinct from`. Each call below must be refused.

  foreach v_bad_token in array array[null, 'wrong-token']::text[] loop
    v_label := coalesce('token ' || quote_literal(v_bad_token), 'NULL token');

    perform pg_temp.expect_error(
      format('delete_attendee refuses a %s', v_label),
      format('select public.delete_attendee(%L, %s, %L)', v_event_id, v_attendee_id, v_bad_token),
      'Neplatný organizátorský odkaz.'
    );
    perform pg_temp.expect_error(
      format('moderate_attendee refuses a %s', v_label),
      format('select public.moderate_attendee(%L, %s, %L, %L)', v_event_id, v_attendee_id, v_bad_token, 'excused_accepted'),
      'Neplatný organizátorský odkaz.'
    );
    perform pg_temp.expect_error(
      format('invite_attendees refuses a %s', v_label),
      format('select public.invite_attendees(%L, %L, %L::jsonb)', v_event_id, v_bad_token, '[{"name": "Intruder"}]'),
      'Neplatný organizátorský odkaz.'
    );
    perform pg_temp.expect_error(
      format('delete_event refuses a %s', v_label),
      format('select public.delete_event(%L, %L)', v_event_id, v_bad_token),
      'Neplatný organizátorský odkaz.'
    );
    perform pg_temp.expect_error(
      format('finalize_event_poll refuses a %s', v_label),
      format('select public.finalize_event_poll(%L, %L, %s, %L, null)', v_poll_id, v_bad_token, v_option_id, '1234'),
      'Neplatný odkaz tvůrce ankety.'
    );
    perform pg_temp.expect_error(
      format('get_owner_payload refuses a %s', v_label),
      format('select public.get_owner_payload(%L, %L)', v_owner_id, v_bad_token),
      'Neplatný přístupový token.'
    );
    perform pg_temp.expect_error(
      format('create_contact_group refuses a %s', v_label),
      format('select public.create_contact_group(%L, %L, %L)', v_owner_id, v_bad_token, 'Intruders'),
      'Neplatný přístupový token.'
    );
  end loop;

  -- A wrong organizer token is refused, not served as a guest view.
  perform pg_temp.expect_error(
    'get_event_payload refuses a wrong organizer token',
    format('select public.get_event_payload(%L, %L)', v_event_id, 'wrong-token'),
    'Neplatný organizátorský odkaz.'
  );

  perform pg_temp.expect(
    'the refused calls changed nothing',
    (select a.status = 'excused' from public.attendees a where a.id = v_attendee_id)
      and not exists (select 1 from public.attendees a where a.event_id = v_event_id and a.name = 'Intruder')
      and exists (select 1 from public.events e where e.id = v_event_id)
      and (select p.finalized_event_id is null from public.event_polls p where p.id = v_poll_id)
  );

  -- ==================== PIN and code lockout ====================
  -- A wrong PIN is returned as {error}, not raised, so the failed-attempt
  -- count isn't rolled back with the error. Five wrong PINs lock the PIN.

  for i in 1..5 loop
    v_result := public.get_organizer_path_with_pin(v_event_id, '0000');
    perform pg_temp.expect(format('wrong PIN #%s is refused with {error}', i), v_result->>'error' = 'Neplatný správcovský PIN.');
  end loop;

  perform pg_temp.expect(
    'the five wrong PINs are counted and lock the PIN',
    (select e.organizer_pin_failed_attempts = 5 and e.organizer_pin_locked_until > now() from public.events e where e.id = v_event_id)
  );

  v_result := public.get_organizer_path_with_pin(v_event_id, '1234');
  perform pg_temp.expect(
    'a locked PIN refuses even the right PIN',
    v_result->>'error' = 'PIN je dočasně zablokovaný. Zkus to později.' and not v_result ? 'organizerPath'
  );

  v_result := public.access_owner_account('Security test', '+000 0000 0001', '000000');
  perform pg_temp.expect(
    'a wrong owner code is refused with {error} and counted',
    v_result->>'error' = 'Neplatný kód.'
      and (select o.code_failed_attempts = 1 from public.owners o where o.id = v_owner_id)
  );

  -- ==================== Functions the browser can't call ====================
  -- Supabase grants EXECUTE on every new function to anon and authenticated;
  -- these revoke it (service_role and the database itself only).
  -- delete_event and get_feedback_reports stay callable by the browser on
  -- purpose, so they aren't listed.

  perform pg_temp.expect(
    'anon can execute a public RPC (the check below works)',
    has_function_privilege('anon', 'public.submit_rsvp(text, text, text, text, text)', 'EXECUTE')
  );

  foreach v_function in array array[
    'public.emit_event_realtime_tick(text, text)',
    'public._delete_expired_polls()',
    'public.delete_event_photo(text, text, bigint, text)',
    'public.list_event_photo_paths(text)',
    'public.authorize_event_photo_delete(text, bigint, text, text)',
    'public.get_pending_event_reminders()',
    'public.claim_event_reminder_deliveries(text, text)',
    'public.mark_event_reminder_delivery(text, text, text, boolean)',
    'public.delete_push_subscription_by_endpoint(text)',
    'public.delete_events_by_ids(text[])',
    'public.get_expired_event_ids()',
    'public._random_token(integer)'
  ] loop
    foreach v_role in array array['anon', 'authenticated'] loop
      perform pg_temp.expect(format('%s cannot execute %s', v_role, v_function), not has_function_privilege(v_role, v_function, 'EXECUTE'));
    end loop;
  end loop;

  -- ==================== Chat ====================
  -- Only someone who answered the invitation may write, at most one message
  -- per 3 seconds (now() is the same all through this transaction, so the
  -- second message counts as sent at the same moment).

  perform pg_temp.expect_error(
    'someone who never answered cannot chat',
    format('select * from public.send_event_chat_message(%L, %L, %L)', v_event_id, 'Stranger', 'Hi'),
    'Do chatu může psát jen ten, kdo na akci odpověděl.'
  );

  perform public.invite_attendees(v_event_id, v_token, '[{"name": "Invitee"}]'::jsonb);
  perform pg_temp.expect_error(
    'an invited guest who hasn''t answered yet cannot chat',
    format('select * from public.send_event_chat_message(%L, %L, %L)', v_event_id, 'Invitee', 'Hi'),
    'Do chatu může psát jen ten, kdo na akci odpověděl.'
  );

  perform public.send_event_chat_message(v_event_id, 'Tester', 'First message');
  perform pg_temp.expect('a confirmed guest can chat', exists (select 1 from public.event_chat_messages m where m.event_id = v_event_id));
  perform pg_temp.expect_error(
    'a second message within 3 seconds is refused',
    format('select * from public.send_event_chat_message(%L, %L, %L)', v_event_id, 'tester', 'Second message'),
    'Zprávy posíláš moc rychle, chvilku počkej.'
  );
  perform pg_temp.expect_error(
    'a message over 500 characters is refused',
    format('select * from public.send_event_chat_message(%L, %L, %L)', v_event_id, 'Excused guest', repeat('x', 501)),
    'Text je moc dlouhý (limit 500 znaků).'
  );

  -- ==================== Realtime, storage and retired objects ====================

  perform pg_temp.expect(
    'realtime ticks name their event only by its hash',
    not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'event_realtime_ticks' and c.column_name = 'event_id'
    )
      and exists (
        select 1 from public.event_realtime_ticks t
        where t.event_key = encode(extensions.digest(v_event_id, 'sha256'), 'hex')
      )
  );

  perform pg_temp.expect(
    'nobody can list the event-photos bucket',
    not exists (
      select 1 from pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects' and p.cmd in ('SELECT', 'ALL')
        and (p.qual like '%event-photos%' or p.policyname like 'event_photos%')
    )
  );

  perform pg_temp.expect(
    'the event-photos bucket takes only JPEG, PNG, WebP and GIF',
    (select b.allowed_mime_types::text[] <@ array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
      from storage.buckets b where b.id = 'event-photos')
  );

  perform pg_temp.expect(
    'complete_event_reminder and event_reminders_sent are gone',
    to_regprocedure('public.complete_event_reminder(text, text)') is null and to_regclass('public.event_reminders_sent') is null
  );
end;
$$;

rollback;

-- Runs after the rollback, so it's reached only when every check passed.
select 'All security checks passed.' as result;
