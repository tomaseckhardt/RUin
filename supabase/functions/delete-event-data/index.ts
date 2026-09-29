// Deploy with: supabase functions deploy delete-event-data --no-verify-jwt
// The public anon key reaches this handler, but every operation requires a
// bearer token: the organizer token stored for the requested event, or - for
// deleting one photo - the delete token the uploader's browser got for that
// photo. The authorize_event_photo_delete RPC decides who may delete a photo.

import { createClient } from 'npm:@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

const supabase =
  supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }) : null

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

async function removeStoragePaths(paths: string[]) {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await supabase.storage.from('event-photos').remove(paths.slice(offset, offset + 100))

    if (error) {
      throw new Error(`Fotky se nepodařilo smazat z úložiště: ${error.message}`)
    }
  }
}

async function listAllPhotoPaths(eventId: string) {
  const folders: string[] = [eventId]
  const paths: string[] = []

  while (folders.length > 0) {
    const folder = folders.shift()
    if (!folder) {
      continue
    }

    let offset = 0

    while (true) {
      const { data: page, error } = await supabase.storage.from('event-photos').list(folder, { limit: 100, offset })

      if (error) {
        throw new Error('Fotky akce se nepodařilo načíst.')
      }

      for (const item of page || []) {
        const path = `${folder}/${item.name}`
        if (item.id === null) {
          folders.push(path)
        } else {
          paths.push(path)
        }
      }

      if (!page || page.length < 100) {
        break
      }

      offset += 100
    }
  }

  return paths
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Nepodporovaná metoda.' }, 405)
  }

  if (!supabase) {
    return jsonResponse({ error: 'Server není správně nakonfigurovaný.' }, 500)
  }

  let body: { action?: string; eventId?: string; token?: string; photoId?: string | number; photoToken?: string }

  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Neplatný požadavek.' }, 400)
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  const token = typeof body.token === 'string' ? body.token : ''
  const photoToken = typeof body.photoToken === 'string' ? body.photoToken : ''
  // Deleting the event needs the organizer token; one photo can also go with
  // its uploader's delete token.
  const hasCredentials = token !== '' || (body.action === 'delete_photo' && photoToken !== '')

  if (!eventId || !hasCredentials || !['delete_event', 'delete_photo'].includes(body.action || '')) {
    return jsonResponse({ error: 'Neplatný požadavek.' }, 400)
  }

  const { data: event, error: eventError } = await supabase.from('events').select('organizer_token').eq('id', eventId).maybeSingle()

  if (eventError) {
    return jsonResponse({ error: 'Akci se nepodařilo ověřit.' }, 500)
  }

  if (!event) {
    return jsonResponse({ error: 'Akce už neexistuje.' }, 404)
  }

  if (body.action === 'delete_photo') {
    const photoId = String(body.photoId ?? '')

    if (!/^\d+$/.test(photoId)) {
      return jsonResponse({ error: 'Fotka nebyla nalezena.' }, 400)
    }

    const credentials = { p_event_id: eventId, p_photo_id: photoId, p_token: token || null, p_photo_token: photoToken || null }

    // Checked before the file goes, so a refused request can't remove it;
    // delete_event_photo checks the same credentials again.
    const { data: storagePath, error: authorizeError } = await supabase.rpc('authorize_event_photo_delete', credentials)

    if (authorizeError) {
      // P0001: a `raise exception` in the RPC, i.e. the request was refused.
      return jsonResponse({ error: authorizeError.message }, authorizeError.code === 'P0001' ? 403 : 500)
    }

    try {
      await removeStoragePaths([storagePath])
    } catch (error) {
      return jsonResponse({ error: errorMessage(error) }, 500)
    }

    const { error: deleteError } = await supabase.rpc('delete_event_photo', credentials)

    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500)
    }

    return jsonResponse({ success: true })
  }

  if (event.organizer_token !== token) {
    return jsonResponse({ error: 'Neplatný organizátorský odkaz.' }, 401)
  }

  try {
    await removeStoragePaths(await listAllPhotoPaths(eventId))
  } catch (error) {
    return jsonResponse({ error: errorMessage(error) }, 500)
  }

  const { error: deleteError } = await supabase.rpc('delete_event', {
    p_event_id: eventId,
    p_token: token,
  })

  if (deleteError) {
    return jsonResponse({ error: deleteError.message }, 500)
  }

  return jsonResponse({ success: true })
})
