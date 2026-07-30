// Scheduled Edge Function: deletes events 7+ days past their date, removing
// their photos from Storage first via the Storage Admin API.
//
// A raw SQL `delete from storage.objects` (tried first, inside a function
// called from nearly every other RPC) is rejected by this project ("Direct
// deletion from storage tables is not allowed. Use the Storage API instead.")
// and broke the whole app - see the comment on delete_events_by_ids() in
// supabase/sql/all-phases.sql. This Edge Function does the storage cleanup
// instead, tracks which events it actually succeeded for, and only asks the
// database to delete that specific set - an event whose photo removal fails
// keeps its row and gets retried on the next scheduled run, instead of
// having its only photo reference deleted alongside it.
//
// Deploy with: supabase functions deploy cleanup-expired-events --no-verify-jwt
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically by the runtime.
// Trigger this function on a schedule (daily is plenty - expiry isn't time-critical)
// via the Supabase dashboard's Cron Jobs feature, or pg_cron+pg_net - see
// get_expired_event_ids() in supabase/sql/all-phases.sql.
//
// --no-verify-jwt means the Supabase gateway itself performs no auth check on
// this endpoint - the handler below requires the caller to send
// `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` itself, so whichever
// scheduler triggers this must be configured to send that header. See
// "Automatický úklid expirovaných akcí" in README.md.

import { createClient } from 'npm:@supabase/supabase-js@2'

const STORAGE_LIST_PAGE_SIZE = 100

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing required secrets (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY).')
}

const supabase = supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null

// Storage's list() defaults to a 100-item page - paginate so an event with
// more than 100 photos doesn't leave the rest permanently orphaned.
async function listAllPhotoNames(eventId) {
  const names = []
  let offset = 0

  while (true) {
    const { data: page, error: listError } = await supabase.storage
      .from('event-photos')
      .list(eventId, { limit: STORAGE_LIST_PAGE_SIZE, offset })

    if (listError) {
      throw new Error(`Failed to list photos for event ${eventId}: ${listError.message}`)
    }

    if (!page || page.length === 0) {
      break
    }

    names.push(...page.map((file) => file.name))

    if (page.length < STORAGE_LIST_PAGE_SIZE) {
      break
    }

    offset += STORAGE_LIST_PAGE_SIZE
  }

  return names
}

// Returns true if eventId's photos are confirmed gone (or there were none),
// false if removal failed and the event should be retried on the next run.
async function removeEventPhotos(eventId) {
  let names

  try {
    names = await listAllPhotoNames(eventId)
  } catch (listError) {
    console.error(listError.message)
    return { removedCount: 0, succeeded: false }
  }

  if (names.length === 0) {
    return { removedCount: 0, succeeded: true }
  }

  const paths = names.map((name) => `${eventId}/${name}`)
  const { error: removeError } = await supabase.storage.from('event-photos').remove(paths)

  if (removeError) {
    console.error(`Failed to remove photos for event ${eventId}:`, removeError.message)
    return { removedCount: 0, succeeded: false }
  }

  return { removedCount: paths.length, succeeded: true }
}

Deno.serve(async (req) => {
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: 'Server misconfigured: missing secrets.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (req.headers.get('authorization') !== `Bearer ${serviceRoleKey}`) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: expiredIds, error: expiredIdsError } = await supabase.rpc('get_expired_event_ids')

  if (expiredIdsError) {
    return new Response(
      JSON.stringify({ error: expiredIdsError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let removedPhotoCount = 0
  const readyToDeleteIds = []

  for (const eventId of expiredIds ?? []) {
    const { removedCount, succeeded } = await removeEventPhotos(eventId)
    removedPhotoCount += removedCount

    if (succeeded) {
      readyToDeleteIds.push(eventId)
    }
  }

  let deletedEventCount = 0

  if (readyToDeleteIds.length > 0) {
    const { data, error: deleteError } = await supabase.rpc('delete_events_by_ids', {
      p_event_ids: readyToDeleteIds,
    })

    if (deleteError) {
      return new Response(
        JSON.stringify({ error: deleteError.message, removedPhotoCount }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    deletedEventCount = data ?? 0
  }

  return new Response(
    JSON.stringify({
      expiredEventCount: expiredIds?.length ?? 0,
      removedPhotoCount,
      deletedEventCount,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
