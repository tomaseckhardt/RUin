// Deploy with: supabase functions deploy delete-event-data --no-verify-jwt
// The public anon key reaches this handler, but every operation requires the
// matching organizer bearer token stored for the requested event.

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

async function removeStoragePaths(paths: string[]) {
  for (let offset = 0; offset < paths.length; offset += 100) {
    const { error } = await supabase.storage.from('event-photos').remove(paths.slice(offset, offset + 100))

    if (error) {
      throw new Error(`Fotky se nepodařilo smazat z úložiště: ${error.message}`)
    }
  }
}

async function listAllPhotoPaths(eventId: string) {
  const folders = [eventId]
  const paths: string[] = []

  while (folders.length > 0) {
    const folder = folders.shift()
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Nepodporovaná metoda.' }, 405)
  }

  if (!supabase) {
    return jsonResponse({ error: 'Server není správně nakonfigurovaný.' }, 500)
  }

  let body: { action?: string; eventId?: string; token?: string; photoId?: string | number }

  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Neplatný požadavek.' }, 400)
  }

  const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
  const token = typeof body.token === 'string' ? body.token : ''

  if (!eventId || !token || !['delete_event', 'delete_photo'].includes(body.action || '')) {
    return jsonResponse({ error: 'Neplatný požadavek.' }, 400)
  }

  const { data: event, error: eventError } = await supabase.from('events').select('organizer_token').eq('id', eventId).maybeSingle()

  if (eventError) {
    return jsonResponse({ error: 'Akci se nepodařilo ověřit.' }, 500)
  }

  if (!event) {
    return jsonResponse({ error: 'Akce už neexistuje.' }, 404)
  }

  if (event.organizer_token !== token) {
    return jsonResponse({ error: 'Neplatný organizátorský odkaz.' }, 401)
  }

  if (body.action === 'delete_photo') {
    const photoId = String(body.photoId ?? '')

    if (!/^\d+$/.test(photoId)) {
      return jsonResponse({ error: 'Fotka nebyla nalezena.' }, 400)
    }

    const { data: photo, error: photoError } = await supabase
      .from('event_photos')
      .select('id, storage_path')
      .eq('event_id', eventId)
      .eq('id', photoId)
      .maybeSingle()

    if (photoError) {
      return jsonResponse({ error: 'Fotku se nepodařilo načíst.' }, 500)
    }

    if (!photo) {
      return jsonResponse({ error: 'Fotka nebyla nalezena.' }, 404)
    }

    try {
      await removeStoragePaths([photo.storage_path])
    } catch (error) {
      return jsonResponse({ error: error.message }, 500)
    }

    const { error: deleteError } = await supabase.rpc('delete_event_photo', {
      p_event_id: eventId,
      p_token: token,
      p_photo_id: photoId,
    })

    if (deleteError) {
      return jsonResponse({ error: deleteError.message }, 500)
    }

    return jsonResponse({ success: true })
  }

  try {
    await removeStoragePaths(await listAllPhotoPaths(eventId))
  } catch (error) {
    return jsonResponse({ error: error.message }, 500)
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
