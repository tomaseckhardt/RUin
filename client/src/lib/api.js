import { supabase } from './supabase.js'
import { toast } from 'sonner'

const OFFLINE_ERROR_MESSAGE = 'Jsi offline - zkontroluj připojení a zkus to znovu.'
const RETRY_QUEUE_STORAGE_KEY = 'ruin-retry-queue'

// RPCs that are upsert/delete-by-identity operations under the hood - replaying
// them again (because the first attempt failed while offline) is idempotent or
// harmless, so they're safe to queue and blindly retry once we're back online.
// Anything not in this set (chat messages, pings, adding a signup item, ...)
// would create a visible duplicate if replayed twice, so those just surface
// the offline error above instead of being queued.
const RETRYABLE_RPCS = new Set([
  'submit_rsvp',
  'check_in_attendee',
  'claim_signup_item',
  'unclaim_signup_item',
])

function isOfflineError(error) {
  if (!error) {
    return false
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }

  // supabase-js/postgrest-js swallows a fetch-level network failure (DNS
  // failure, dropped connection, timeout, ...) into a plain `{ error }`
  // object with no Postgres/PostgREST error code, tagging the message with
  // the name of the underlying fetch exception - e.g. "TypeError: Failed to
  // fetch", "TypeError: NetworkError when attempting to fetch resource.",
  // "TypeError: Load failed" (Safari). A real RPC/business-logic error (e.g.
  // a Czech validation message from `raise exception`) always carries a
  // Postgres error code and never looks like that.
  const message = typeof error.message === 'string' ? error.message : ''
  return !error.code && /^(TypeError|FetchError|AbortError)\b/.test(message)
}

function readRetryQueue() {
  try {
    const raw = window.localStorage.getItem(RETRY_QUEUE_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeRetryQueue(queue) {
  try {
    window.localStorage.setItem(RETRY_QUEUE_STORAGE_KEY, JSON.stringify(queue))
  } catch {
    // localStorage unavailable or full - not worth failing the request over.
  }
}

function queueRetryableCall(name, args) {
  if (!RETRYABLE_RPCS.has(name)) {
    return
  }

  const queue = readRetryQueue()
  queue.push({ name, args })
  writeRetryQueue(queue)
}

let isReplayingRetryQueue = false

// Replays queued write calls, oldest first, once the app is back online.
// Anything that succeeds is dropped from the queue. Anything that fails
// again for a real (non-network) reason is also dropped - we don't retry
// forever - and its failure is surfaced via a toast. If we're still offline,
// the remaining items (this one included) are left queued for next time.
async function replayRetryQueue() {
  if (isReplayingRetryQueue) {
    return
  }

  const queue = readRetryQueue()

  if (!queue.length) {
    return
  }

  isReplayingRetryQueue = true

  try {
    let successCount = 0

    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index]
      const { error } = await supabase.rpc(item.name, item.args)

      if (!error) {
        successCount += 1
        continue
      }

      if (isOfflineError(error)) {
        // Still offline (or offline again) - keep this item and everything
        // after it for the next reconnect instead of dropping them.
        writeRetryQueue(queue.slice(index))
        return
      }

      toast.error(`Odloženou akci se nepodařilo dokončit: ${error.message || 'neznámá chyba'}`)
    }

    writeRetryQueue([])

    if (successCount > 0) {
      toast.success(
        successCount === 1
          ? 'Jedna odložená akce se úspěšně odeslala.'
          : `${successCount} odložených akcí se úspěšně odeslalo.`,
      )
    }
  } finally {
    isReplayingRetryQueue = false
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    replayRetryQueue()
  })

  // Also try once on load: a previous session may have queued something
  // while offline and then been closed before an "online" event ever fired.
  if (navigator.onLine) {
    replayRetryQueue()
  }
}

async function callRpc(name, args, fallbackMessage) {
  const { data, error } = await supabase.rpc(name, args)

  if (error) {
    if (isOfflineError(error)) {
      queueRetryableCall(name, args)
      throw new Error(OFFLINE_ERROR_MESSAGE)
    }

    throw new Error(error.message || fallbackMessage || 'Požadavek se nepovedl.')
  }

  return data
}

export function createEvent(data) {
  return callRpc(
    'create_event',
    {
      p_name: data.name,
      p_location: data.location,
      p_datetime: data.datetime,
      p_description: data.description,
      p_organizer_name: data.organizerName,
      p_organizer_pin: data.organizerPin,
      p_require_phone: data.requirePhone ?? false,
    },
    'Akci se nepodařilo vytvořit.',
  )
}

export function unlockManageWithPin(eventId, pin) {
  return callRpc(
    'get_organizer_path_with_pin',
    {
      p_event_id: eventId,
      p_pin: pin,
    },
    'Správu akce se nepodařilo odemknout.',
  )
}

export function getEvent(id, organizerToken = null) {
  return callRpc(
    'get_event_payload',
    { p_event_id: id, p_organizer_token: organizerToken },
    'Akci se nepodařilo načíst.',
  )
}

export function submitRsvp(id, data) {
  return callRpc(
    'submit_rsvp',
    {
      p_event_id: id,
      p_name: data.name,
      p_status: data.status,
      p_excuse_reason: data.excuseReason ?? null,
      p_phone: data.phone ?? null,
    },
    'RSVP se nepodařilo uložit.',
  )
}

export function moderateAttendee(eventId, attendeeId, data) {
  return callRpc(
    'moderate_attendee',
    {
      p_event_id: eventId,
      p_attendee_id: Number(attendeeId),
      p_token: data.token,
      p_status: data.status,
    },
    'Omluvenku se nepodařilo upravit.',
  )
}

export function pingAttendee(eventId, attendeeId, sourceName, message = null) {
  return callRpc(
    'ping_attendee',
    {
      p_event_id: eventId,
      p_target_attendee_id: Number(attendeeId),
      p_source_name: sourceName,
      p_message: message,
    },
    'Šťouchnutí se nepodařilo odeslat.',
  )
}

export function deleteAttendee(eventId, attendeeId, token) {
  return callRpc(
    'delete_attendee',
    {
      p_event_id: eventId,
      p_attendee_id: Number(attendeeId),
      p_token: token,
    },
    'Účastníka se nepodařilo smazat.',
  )
}

export function removeEvent(eventId, token) {
  return callRpc(
    'delete_event',
    {
      p_event_id: eventId,
      p_token: token,
    },
    'Akci se nepodařilo smazat.',
  )
}

export function updateEvent(eventId, data) {
  return callRpc(
    'update_event',
    {
      p_event_id: eventId,
      p_token: data.token,
      p_name: data.name,
      p_location: data.location,
      p_datetime: data.datetime,
      p_description: data.description,
      p_require_phone: data.requirePhone ?? false,
    },
    'Akci se nepodařilo upravit.',
  )
}

export async function getEventChatMessages(eventId, limit = 120) {
  const { data, error } = await supabase.rpc('get_event_chat_messages', {
    p_event_id: eventId,
    p_limit: limit,
  })

  if (error) {
    throw new Error(error.message || 'Chat se nepodařilo načíst.')
  }

  return (data ?? []).reverse()
}

export function registerPushSubscription(eventId, subscription) {
  return callRpc(
    'register_push_subscription',
    {
      p_event_id: eventId,
      p_endpoint: subscription.endpoint,
      p_p256dh: subscription.p256dh,
      p_auth: subscription.auth,
    },
    'Připomínku se nepodařilo zapnout.',
  )
}

export function unregisterPushSubscription(endpoint) {
  return callRpc(
    'unregister_push_subscription',
    { p_endpoint: endpoint },
    'Připomínku se nepodařilo vypnout.',
  )
}

export function checkInAttendee(eventId, attendeeName) {
  return callRpc(
    'check_in_attendee',
    { p_event_id: eventId, p_attendee_name: attendeeName },
    'Check-in se nepodařil.',
  )
}

export function toggleChatReaction(messageId, senderName, emoji) {
  return callRpc(
    'toggle_chat_reaction',
    { p_message_id: messageId, p_sender_name: senderName, p_emoji: emoji },
    'Reakci se nepodařilo uložit.',
  )
}

export async function getChatReactions(eventId, messageIds) {
  if (!messageIds.length) {
    return []
  }

  const { data, error } = await supabase.rpc('get_chat_reactions', {
    p_event_id: eventId,
    p_message_ids: messageIds,
  })

  if (error) {
    throw new Error(error.message || 'Reakce se nepodařilo načíst.')
  }

  return data ?? []
}

export function addSignupItem(eventId, data) {
  return callRpc(
    'add_signup_item',
    {
      p_event_id: eventId,
      p_category: data.category,
      p_label: data.label,
      p_capacity: data.capacity ?? 1,
      p_note: data.note ?? null,
      p_created_by: data.createdBy,
    },
    'Položku se nepodařilo přidat.',
  )
}

export function claimSignupItem(itemId, attendeeName, seats = 1) {
  return callRpc(
    'claim_signup_item',
    { p_item_id: itemId, p_attendee_name: attendeeName, p_seats: seats },
    'Přihlášení se nepodařilo uložit.',
  )
}

export function unclaimSignupItem(itemId, attendeeName) {
  return callRpc(
    'unclaim_signup_item',
    { p_item_id: itemId, p_attendee_name: attendeeName, p_requester_name: attendeeName },
    'Odhlášení se nepodařilo uložit.',
  )
}

export function removeSignupClaim(itemId, claimAttendeeName, requesterName) {
  return callRpc(
    'remove_signup_claim',
    { p_item_id: itemId, p_claim_attendee_name: claimAttendeeName, p_requester_name: requesterName },
    'Odebrání se nepodařilo uložit.',
  )
}

export function deleteSignupItem(eventId, itemId, token) {
  return callRpc(
    'delete_signup_item',
    { p_event_id: eventId, p_item_id: itemId, p_token: token },
    'Položku se nepodařilo smazat.',
  )
}

export async function getSignupItems(eventId) {
  const { data, error } = await supabase.rpc('get_event_signup_items', { p_event_id: eventId })

  if (error) {
    throw new Error(error.message || 'Seznam se nepodařilo načíst.')
  }

  return data ?? []
}

export function addEventStop(eventId, token, data) {
  return callRpc(
    'add_event_stop',
    {
      p_event_id: eventId,
      p_token: token,
      p_name: data.name,
      p_location: data.location ?? null,
      p_starts_at_label: data.startsAtLabel ?? null,
    },
    'Zastávku se nepodařilo přidat.',
  )
}

export function deleteEventStop(eventId, token, stopId) {
  return callRpc(
    'delete_event_stop',
    { p_event_id: eventId, p_token: token, p_stop_id: stopId },
    'Zastávku se nepodařilo smazat.',
  )
}

export async function getEventStops(eventId) {
  const { data, error } = await supabase.rpc('get_event_stops', { p_event_id: eventId })

  if (error) {
    throw new Error(error.message || 'Itinerář se nepodařilo načíst.')
  }

  return data ?? []
}

export function createEventPoll(data) {
  return callRpc(
    'create_event_poll',
    {
      p_creator_name: data.creatorName,
      p_name: data.name,
      p_description: data.description ?? null,
      p_options: data.options,
    },
    'Anketu se nepodařilo vytvořit.',
  )
}

export function getPollPayload(pollId, token = null) {
  return callRpc(
    'get_poll_payload',
    { p_poll_id: pollId, p_token: token },
    'Anketu se nepodařilo načíst.',
  )
}

export function votePoll(pollId, optionId, voterName) {
  return callRpc(
    'vote_event_poll',
    { p_poll_id: pollId, p_option_id: optionId, p_voter_name: voterName },
    'Hlas se nepodařilo uložit.',
  )
}

export function finalizePoll(pollId, token, optionId, organizerPin, description) {
  return callRpc(
    'finalize_event_poll',
    {
      p_poll_id: pollId,
      p_token: token,
      p_option_id: optionId,
      p_organizer_pin: organizerPin,
      p_description: description ?? null,
    },
    'Anketu se nepodařilo vyhodnotit.',
  )
}

export function recordEventPhoto(eventId, storagePath, uploadedBy) {
  return callRpc(
    'record_event_photo',
    { p_event_id: eventId, p_storage_path: storagePath, p_uploaded_by: uploadedBy },
    'Fotku se nepodařilo uložit.',
  )
}

export async function getEventPhotos(eventId) {
  const { data, error } = await supabase.rpc('get_event_photos', { p_event_id: eventId })

  if (error) {
    throw new Error(error.message || 'Fotky se nepodařilo načíst.')
  }

  return data ?? []
}

export function deleteEventPhoto(eventId, token, photoId) {
  return callRpc(
    'delete_event_photo',
    { p_event_id: eventId, p_token: token, p_photo_id: photoId },
    'Fotku se nepodařilo smazat.',
  )
}

const MAX_PHOTO_BYTES = 10 * 1024 * 1024

export async function uploadEventPhoto(eventId, file) {
  if (!file.type.startsWith('image/')) {
    throw new Error('Nahrát lze jen obrázky.')
  }

  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('Fotka je moc velká (limit je 10 MB).')
  }

  const fileExt = file.name.split('.').pop()
  const storagePath = `${eventId}/${crypto.randomUUID()}.${fileExt}`

  const { error: uploadError } = await supabase.storage
    .from('event-photos')
    .upload(storagePath, file)

  if (uploadError) {
    throw new Error(uploadError.message || 'Nahrání fotky selhalo.')
  }

  return storagePath
}

export function getEventPhotoUrl(storagePath) {
  const { data } = supabase.storage.from('event-photos').getPublicUrl(storagePath)
  return data.publicUrl
}

export async function sendEventChatMessage(eventId, senderName, message) {
  const cleanSenderName = (senderName || '').trim()
  const cleanMessage = (message || '').trim()

  if (!cleanSenderName) {
    throw new Error('Pro odeslání zprávy vyplň svoje jméno.')
  }

  if (!cleanMessage) {
    throw new Error('Napiš zprávu do chatu.')
  }

  const { data, error } = await supabase.rpc('send_event_chat_message', {
    p_event_id: eventId,
    p_sender_name: cleanSenderName,
    p_message: cleanMessage,
  })

  if (error) {
    throw new Error(error.message || 'Zprávu se nepodařilo odeslat.')
  }

  return data?.[0]
}

export function submitFeedback(type, name, message) {
  return callRpc(
    'submit_feedback_report',
    { p_type: type, p_name: name, p_message: message },
    'Hlášení se nepodařilo odeslat.',
  )
}

export function getFeedbackReports() {
  return callRpc(
    'get_feedback_reports',
    {},
    'Hlášení se nepodařilo načíst.',
  )
}
