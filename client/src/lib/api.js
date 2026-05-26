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
    },
    'Akci se nepodařilo vytvořit.',
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
