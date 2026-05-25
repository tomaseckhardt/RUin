import { Router } from 'express'
import { nanoid } from 'nanoid'
import db from '../db.js'

const router = Router()

const allowedRsvpStatuses = new Set(['confirmed', 'excused'])
const allowedModerationStatuses = new Set(['excused_accepted', 'excused_rejected'])

const selectEvent = db.prepare(`
  SELECT id, name, location, datetime, description, organizer_token, created_at
  FROM events
  WHERE id = ?
`)

const selectEventAttendees = db.prepare(`
  SELECT id, event_id, name, status, excuse_reason, created_at
  FROM attendees
  WHERE event_id = ?
  ORDER BY
    CASE status
      WHEN 'confirmed' THEN 1
      WHEN 'excused' THEN 2
      WHEN 'excused_accepted' THEN 3
      WHEN 'excused_rejected' THEN 4
      ELSE 5
    END,
    created_at ASC,
    name ASC
`)

const insertEvent = db.prepare(`
  INSERT INTO events (id, name, location, datetime, description, organizer_token)
  VALUES (@id, @name, @location, @datetime, @description, @organizerToken)
`)

const upsertAttendee = db.prepare(`
  INSERT INTO attendees (event_id, name, status, excuse_reason)
  VALUES (@eventId, @name, @status, @excuseReason)
  ON CONFLICT(event_id, name) DO UPDATE SET
    status = excluded.status,
    excuse_reason = excluded.excuse_reason
`)

const selectAttendeeByName = db.prepare(`
  SELECT id, event_id, name, status, excuse_reason, created_at
  FROM attendees
  WHERE event_id = ? AND name = ?
`)

const selectAttendeeById = db.prepare(`
  SELECT id, event_id, name, status, excuse_reason, created_at
  FROM attendees
  WHERE event_id = ? AND id = ?
`)

const updateAttendeeStatus = db.prepare(`
  UPDATE attendees
  SET status = @status
  WHERE event_id = @eventId AND id = @attendeeId
`)

const deleteAttendeesByEvent = db.prepare('DELETE FROM attendees WHERE event_id = ?')
const deleteEventById = db.prepare('DELETE FROM events WHERE id = ?')

function makeSummary(attendees) {
  return attendees.reduce(
    (summary, attendee) => {
      if (attendee.status === 'confirmed') {
        summary.confirmed += 1
      }

      if (attendee.status === 'excused' || attendee.status === 'excused_accepted') {
        summary.excused += 1
      }

      if (attendee.status === 'excused_rejected') {
        summary.rejected += 1
      }

      return summary
    },
    { confirmed: 0, excused: 0, rejected: 0 },
  )
}

function serializeEventPayload(event, attendees) {
  return {
    event: {
      id: event.id,
      name: event.name,
      location: event.location,
      datetime: event.datetime,
      description: event.description,
      createdAt: event.created_at,
    },
    attendees,
    summary: makeSummary(attendees),
  }
}

function getOrigin(request) {
  const forwardedProto = request.headers['x-forwarded-proto']
  const protocol = forwardedProto ? forwardedProto.split(',')[0] : request.protocol
  return `${protocol}://${request.get('host')}`
}

function requireEvent(id) {
  const event = selectEvent.get(id)

  if (!event) {
    return null
  }

  const attendees = selectEventAttendees.all(id)
  return { event, attendees }
}

function assertOrganizerToken(event, token) {
  return event.organizer_token === token
}

router.post('/', (request, response) => {
  const name = request.body?.name?.trim()
  const location = request.body?.location?.trim()
  const datetime = request.body?.datetime?.trim()
  const description = request.body?.description?.trim() ?? ''

  if (!name || !location || !datetime || !description) {
    return response.status(400).json({
      message: 'Vyplň název, místo, datum a stručný popis akce.',
    })
  }

  const id = nanoid(10)
  const organizerToken = nanoid(24)

  insertEvent.run({
    id,
    name,
    location,
    datetime,
    description,
    organizerToken,
  })

  const origin = getOrigin(request)
  const guestPath = `/event/${id}`
  const organizerPath = `/event/${id}/manage?token=${organizerToken}`

  return response.status(201).json({
    event: {
      id,
      name,
      location,
      datetime,
      description,
    },
    guestPath,
    organizerPath,
    guestUrl: `${origin}${guestPath}`,
    organizerUrl: `${origin}${organizerPath}`,
  })
})

router.get('/:id', (request, response) => {
  const payload = requireEvent(request.params.id)

  if (!payload) {
    return response.status(404).json({ message: 'Tahle akce už neexistuje.' })
  }

  return response.json(serializeEventPayload(payload.event, payload.attendees))
})

router.post('/:id/rsvp', (request, response) => {
  const payload = requireEvent(request.params.id)

  if (!payload) {
    return response.status(404).json({ message: 'Na tuhle akci se už nedá odpovědět.' })
  }

  const name = request.body?.name?.trim()
  const status = request.body?.status
  const excuseReason = request.body?.excuseReason?.trim() || null

  if (!name) {
    return response.status(400).json({ message: 'Vyplň svoje jméno.' })
  }

  if (!allowedRsvpStatuses.has(status)) {
    return response.status(400).json({ message: 'Neplatný typ odpovědi.' })
  }

  upsertAttendee.run({
    eventId: request.params.id,
    name,
    status,
    excuseReason: status === 'excused' ? excuseReason : null,
  })

  const attendee = selectAttendeeByName.get(request.params.id, name)
  return response.status(201).json({ attendee })
})

router.patch('/:id/attendees/:attendeeId', (request, response) => {
  const event = selectEvent.get(request.params.id)

  if (!event) {
    return response.status(404).json({ message: 'Akce neexistuje.' })
  }

  const token = request.body?.token
  const status = request.body?.status

  if (!assertOrganizerToken(event, token)) {
    return response.status(403).json({ message: 'Neplatný organizátorský odkaz.' })
  }

  if (!allowedModerationStatuses.has(status)) {
    return response.status(400).json({ message: 'Neplatná změna stavu omluvenky.' })
  }

  const attendee = selectAttendeeById.get(request.params.id, request.params.attendeeId)

  if (!attendee) {
    return response.status(404).json({ message: 'Účastník nebyl nalezen.' })
  }

  if (!attendee.status.startsWith('excused')) {
    return response.status(400).json({ message: 'Měnit lze jen omluvené účastníky.' })
  }

  updateAttendeeStatus.run({
    eventId: request.params.id,
    attendeeId: request.params.attendeeId,
    status,
  })

  return response.json({
    attendee: selectAttendeeById.get(request.params.id, request.params.attendeeId),
  })
})

router.delete('/:id', (request, response) => {
  const event = selectEvent.get(request.params.id)

  if (!event) {
    return response.status(404).json({ message: 'Akce už neexistuje.' })
  }

  const token = request.body?.token

  if (!assertOrganizerToken(event, token)) {
    return response.status(403).json({ message: 'Neplatný organizátorský odkaz.' })
  }

  db.transaction(() => {
    deleteAttendeesByEvent.run(request.params.id)
    deleteEventById.run(request.params.id)
  })()

  return response.json({ success: true })
})

export default router