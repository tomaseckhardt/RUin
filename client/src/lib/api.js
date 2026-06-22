import { supabase } from './supabase.js'

async function callRpc(name, args, fallbackMessage) {
  const { data, error } = await supabase.rpc(name, args)

  if (error) {
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

export function getEvent(id) {
  return callRpc('get_event_payload', { p_event_id: id }, 'Akci se nepodařilo načíst.')
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
    },
    'Akci se nepodařilo upravit.',
  )
}

export async function getEventChatMessages(eventId, limit = 120) {
  const { data, error } = await supabase
    .from('event_chat_messages')
    .select('id, event_id, sender_name, message, created_at')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error) {
    throw new Error(error.message || 'Chat se nepodařilo načíst.')
  }

  return data ?? []
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

  const { data, error } = await supabase
    .from('event_chat_messages')
    .insert({
      event_id: eventId,
      sender_name: cleanSenderName,
      message: cleanMessage,
    })
    .select('id, event_id, sender_name, message, created_at')
    .single()

  if (error) {
    throw new Error(error.message || 'Zprávu se nepodařilo odeslat.')
  }

  return data
}
