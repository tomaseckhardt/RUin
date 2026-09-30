// Scheduled Edge Function: deletes events 7+ days past their date, removing
// their photos from Storage first via the Storage Admin API.
//
// A raw SQL `delete from storage.objects` (tried first, inside a function
// called from nearly every other RPC) is rejected by this project ("Direct
// deletion from storage tables is not allowed. Use the Storage API instead.")
// and broke the whole app - see the comment on delete_events_by_ids() in
// supabase/sql/all-phases.sql. This Edge Function does the storage cleanup
// instead, and deletes each event's row right after its photos are gone - an
// event whose photo removal fails keeps its row and gets retried on the next
// scheduled run, instead of having its only photo reference deleted
// alongside it. At most MAX_EVENTS_PER_RUN events per run, so a backlog
// can't outlast the function's time limit; the rest wait for the next run.
//
// Deploy with: supabase functions deploy cleanup-expired-events --no-verify-jwt
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically by the runtime.
// Trigger this function on a schedule (daily is plenty - expiry isn't time-critical)
// via the Supabase dashboard's Cron Jobs feature, or pg_cron+pg_net - see
// get_expired_event_ids() in supabase/sql/all-phases.sql, and
// "Automatický úklid expirovaných akcí" in README.md for the auth header.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { errorMessage, refuseUnlessScheduler, removeEventPhotos } from '../_shared/common.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing required secrets (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).')
}

const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null
const MAX_EVENTS_PER_RUN = 50

Deno.serve(async (req: Request) => {
  if (!supabase || !serviceRoleKey) {
    return Response.json({ error: 'Server misconfigured: missing secrets.' }, { status: 500 })
  }

  const refusal = await refuseUnlessScheduler(req, serviceRoleKey)

  if (refusal) {
    return refusal
  }

  const { data: expiredIds, error: expiredIdsError } = await supabase.rpc('get_expired_event_ids')

  if (expiredIdsError) {
    return Response.json({ error: expiredIdsError.message }, { status: 500 })
  }

  let removedPhotoCount = 0
  let deletedEventCount = 0

  for (const eventId of (expiredIds ?? []).slice(0, MAX_EVENTS_PER_RUN)) {
    try {
      removedPhotoCount += await removeEventPhotos(supabase, eventId)
    } catch (error) {
      // The event keeps its row and is retried on the next run.
      console.error(`Event ${eventId}:`, errorMessage(error))
      continue
    }

    const { data, error: deleteError } = await supabase.rpc('delete_events_by_ids', { p_event_ids: [eventId] })

    if (deleteError) {
      console.error(`Event ${eventId}:`, deleteError.message)
      continue
    }

    deletedEventCount += data ?? 0
  }

  return Response.json({ expiredEventCount: expiredIds?.length ?? 0, removedPhotoCount, deletedEventCount })
})
