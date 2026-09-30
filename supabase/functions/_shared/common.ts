// Helpers shared by the Edge Functions (Supabase bundles _shared with each).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

const STORAGE_REMOVE_BATCH_SIZE = 100

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

// The scheduled functions are deployed with --no-verify-jwt, so the gateway
// checks nothing: they accept only the scheduler, which sends
// `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (see README.md).
// Returns the response for a refused call, or null to go ahead.
export async function refuseUnlessScheduler(req: Request, serviceRoleKey: string) {
  const authorized = await timingSafeEqualStrings(req.headers.get('authorization') ?? '', `Bearer ${serviceRoleKey}`)
  return authorized ? null : Response.json({ error: 'Unauthorized.' }, { status: 401 })
}

// Compares secrets without leaking through timing how much of them matched:
// hashing first gives both sides the same length, then every byte is checked.
export async function timingSafeEqualStrings(a: string, b: string) {
  const encoder = new TextEncoder()
  const [hashA, hashB] = await Promise.all([a, b].map(async (value) => new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))))
  let difference = 0

  for (let i = 0; i < hashA.length; i += 1) {
    difference |= hashA[i] ^ hashB[i]
  }

  return difference === 0
}

export async function removeStoragePaths(supabase: SupabaseClient, paths: string[]) {
  for (let offset = 0; offset < paths.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
    const { error } = await supabase.storage.from('event-photos').remove(paths.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE))

    if (error) {
      throw new Error(`Fotky se nepodařilo smazat z úložiště: ${error.message}`)
    }
  }
}

// Removes every file under the event's folder, however deeply nested, and
// returns how many there were. Throws if listing or removing fails.
export async function removeEventPhotos(supabase: SupabaseClient, eventId: string) {
  const { data: paths, error } = await supabase.rpc('list_event_photo_paths', { p_event_id: eventId })

  if (error) {
    throw new Error(`Fotky akce se nepodařilo načíst: ${error.message}`)
  }

  await removeStoragePaths(supabase, paths ?? [])
  return paths?.length ?? 0
}
