// An in-memory stand-in for the Supabase project, so the E2E test never
// touches a real database. It answers the requests the app makes to
// SUPABASE_URL (RPCs, Storage uploads and downloads, the delete-event-data
// Edge Function) with the shapes and the Czech error messages of
// supabase/sql/all-phases.sql and supabase/functions/delete-event-data, and
// fakes the Open-Meteo weather API. Realtime is a socket that never answers.
// Only what the E2E flow uses is implemented, but the checks the app relies
// on (tokens, cooldowns, a photo's folder and file name, ...) follow the
// real SQL; any other request is recorded in `unexpected` and fails the test.

import { createHash } from 'node:crypto'
import type { Page, Route } from '@playwright/test'

export const SUPABASE_URL = 'https://e2e.supabase.test'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

// A 1x1 PNG, served for every uploaded photo.
const PHOTO_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

type AttendeeStatus = 'invited' | 'confirmed' | 'excused' | 'excused_accepted' | 'excused_rejected'
const STATUS_ORDER: AttendeeStatus[] = ['invited', 'confirmed', 'excused', 'excused_accepted', 'excused_rejected']

// The fake's tables. Rows that get a numeric id and created_at from insert()
// extend Row; events and polls have their own random text ids.
type Row = { id: number; created_at: string }

type EventRow = {
  id: string
  organizer_token: string
  pin: string
  pin_failed_attempts: number
  pin_locked_until: number | null
  name: string
  location: string
  datetime: string
  description: string
  organizer_name: string
  require_phone: boolean
  enable_bring_list: boolean
  enable_carpool: boolean
  enable_stops: boolean
  created_at: string
}
type AttendeeRow = Row & {
  event_id: string
  name: string
  status: AttendeeStatus
  excuse_reason: string | null
  phone: string | null
  checked_in_at: string | null
}
type PingRow = Row & { event_id: string; target_attendee_id: number; source_name: string; message: string | null }
type ChatMessageRow = Row & { event_id: string; sender_name: string; message: string }
type ReactionRow = Row & { message_id: number; sender_name: string; emoji: string }
type SignupItemRow = Row & {
  event_id: string
  category: 'bring' | 'ride'
  label: string
  capacity: number
  note: string | null
  created_by: string
}
type SignupClaimRow = Row & { item_id: number; attendee_name: string; seats: number }
type StopRow = Row & { event_id: string; position: number; name: string; location: string | null; starts_at_label: string | null }
type PhotoRow = Row & { event_id: string; storage_path: string; uploaded_by: string; delete_token_hash: string | null }
type PhotoLikeRow = Row & { event_id: string; photo_id: number; liker_name: string }
type PhotoCommentRow = Row & { event_id: string; photo_id: number; author_name: string; message: string }
type PollRow = {
  id: string
  creator_token: string
  creator_name: string
  name: string
  description: string | null
  finalized_event_id: string | null
}
type PollOptionRow = Row & { poll_id: string; datetime: string; location: string; note: string | null }
type PollVoteRow = Row & { poll_id: string; option_id: number; voter_name: string }
type FeedbackRow = Row & { type: 'bug' | 'idea'; name: string; message: string }

type Tables = {
  events: EventRow[]
  attendees: AttendeeRow[]
  pings: PingRow[]
  messages: ChatMessageRow[]
  reactions: ReactionRow[]
  items: SignupItemRow[]
  claims: SignupClaimRow[]
  stops: StopRow[]
  photos: PhotoRow[]
  likes: PhotoLikeRow[]
  comments: PhotoCommentRow[]
  polls: PollRow[]
  options: PollOptionRow[]
  votes: PollVoteRow[]
  feedback: FeedbackRow[]
  // storage.objects of the event-photos bucket: the uploaded paths.
  objects: string[]
}

// The tables insert() can fill: those whose rows extend Row.
type InsertableTable = { [Name in keyof Tables]: Tables[Name][number] extends Row ? Name : never }[keyof Tables]
type RowOf<Name extends keyof Tables> = Tables[Name][number]

// What create_event (and finalize_event_poll) return.
type CreatedEvent = {
  event: Pick<EventRow, 'id' | 'name' | 'location' | 'datetime' | 'description'>
  guestPath: string
  organizerPath: string
}

type CreateEventArgs = {
  p_name: string
  p_location: string
  p_datetime: string
  p_description: string
  p_organizer_name: string
  p_organizer_pin: string
  p_require_phone?: boolean
  p_enable_bring_list?: boolean
  p_enable_carpool?: boolean
  p_enable_stops?: boolean
}

export type RpcCall = { name: string; args: Record<string, unknown> }

// A `raise exception` in the SQL: PostgREST answers 400 with code P0001.
class RpcError extends Error {}

function fail(message: string): never {
  throw new RpcError(message)
}

function randomId(length = 10) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('cs-CZ') === b.trim().toLocaleLowerCase('cs-CZ')
// `timestamp without time zone` comes back with seconds.
const toTimestamp = (value: string) => (value.length === 16 ? `${value}:00` : value)
const sha256Hex = (value: string) => createHash('sha256').update(value).digest('hex')
// `now() at time zone 'Europe/Prague'`, comparable with toTimestamp() values.
const pragueNow = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Prague' }).replace(' ', 'T')
const MINUTE_MS = 60_000

export function createFakeSupabase() {
  const db: Tables = {
    events: [],
    attendees: [],
    pings: [],
    messages: [],
    reactions: [],
    items: [],
    claims: [],
    stops: [],
    photos: [],
    likes: [],
    comments: [],
    polls: [],
    options: [],
    votes: [],
    feedback: [],
    objects: [],
  }
  const calls: RpcCall[] = []
  const unexpected: string[] = []
  let nextId = 1

  const now = () => new Date().toISOString()

  function insert<Name extends InsertableTable>(table: Name, row: Omit<RowOf<Name>, keyof Row>): RowOf<Name> {
    const saved = { id: nextId++, created_at: now(), ...row } as RowOf<Name>
    ;(db[table] as RowOf<Name>[]).push(saved)
    return saved
  }

  // Each RPC words a missing event its own way, so the caller names the message.
  const findEvent = (id: string, missingMessage: string) => db.events.find((event) => event.id === id) || fail(missingMessage)
  // Like `organizer_token is distinct from p_token`: a missing token never matches.
  const requireOrganizer = (eventId: string, token: string | null, missingMessage = 'Akce neexistuje.') => {
    const event = findEvent(eventId, missingMessage)
    return token != null && event.organizer_token === token ? event : fail('Neplatný organizátorský odkaz.')
  }
  const findPoll = (id: string) => db.polls.find((poll) => poll.id === id) || fail('Anketa neexistuje.')

  // What the tables' `on delete cascade` foreign keys remove with a photo or an event.
  function deletePhotos(photoIds: number[]) {
    db.likes = db.likes.filter((like) => !photoIds.includes(like.photo_id))
    db.comments = db.comments.filter((comment) => !photoIds.includes(comment.photo_id))
    db.photos = db.photos.filter((photo) => !photoIds.includes(photo.id))
  }

  function deleteEvent(eventId: string) {
    const itemIds = db.items.filter((item) => item.event_id === eventId).map((item) => item.id)
    const messageIds = db.messages.filter((message) => message.event_id === eventId).map((message) => message.id)
    deletePhotos(db.photos.filter((photo) => photo.event_id === eventId).map((photo) => photo.id))
    db.claims = db.claims.filter((claim) => !itemIds.includes(claim.item_id))
    db.reactions = db.reactions.filter((reaction) => !messageIds.includes(reaction.message_id))
    db.items = db.items.filter((item) => item.event_id !== eventId)
    db.messages = db.messages.filter((message) => message.event_id !== eventId)
    db.attendees = db.attendees.filter((attendee) => attendee.event_id !== eventId)
    db.pings = db.pings.filter((ping) => ping.event_id !== eventId)
    db.stops = db.stops.filter((stop) => stop.event_id !== eventId)
    db.events = db.events.filter((event) => event.id !== eventId)
  }

  function createEvent(args: CreateEventArgs): CreatedEvent {
    if (!/^\d{4}$/.test(args.p_organizer_pin || '')) {
      fail('Správcovský PIN musí mít přesně 4 číslice.')
    }

    const event: EventRow = {
      id: randomId(),
      organizer_token: randomId(24),
      pin: args.p_organizer_pin,
      pin_failed_attempts: 0,
      pin_locked_until: null,
      name: args.p_name.trim(),
      location: args.p_location.trim(),
      datetime: toTimestamp(args.p_datetime),
      description: args.p_description.trim(),
      organizer_name: args.p_organizer_name.trim(),
      require_phone: Boolean(args.p_require_phone),
      enable_bring_list: args.p_enable_bring_list ?? true,
      enable_carpool: args.p_enable_carpool ?? true,
      enable_stops: args.p_enable_stops ?? true,
      created_at: now(),
    }
    db.events.push(event)
    // The organizer is the event's first confirmed guest.
    insert('attendees', { event_id: event.id, name: event.organizer_name, status: 'confirmed', excuse_reason: null, phone: null, checked_in_at: null })

    return {
      event: { id: event.id, name: event.name, location: event.location, datetime: event.datetime, description: event.description },
      guestPath: `/event/${event.id}`,
      organizerPath: `/event/${event.id}/manage?token=${event.organizer_token}`,
    }
  }

  function eventPayload(args: { p_event_id: string; p_organizer_token?: string | null }) {
    const event = findEvent(args.p_event_id, 'Tahle akce už neexistuje.')

    if (args.p_organizer_token != null && args.p_organizer_token !== event.organizer_token) {
      fail('Neplatný organizátorský odkaz.')
    }

    const isOrganizer = args.p_organizer_token != null
    const attendees = db.attendees
      .filter((attendee) => attendee.event_id === event.id)
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.id - b.id)
      .map((attendee) => {
        const pings = db.pings.filter((ping) => ping.target_attendee_id === attendee.id)
        const last = pings.at(-1)
        return {
          id: attendee.id,
          event_id: event.id,
          name: attendee.name,
          status: attendee.status,
          excuse_reason: attendee.excuse_reason,
          phone: isOrganizer ? attendee.phone : null,
          created_at: attendee.created_at,
          checked_in_at: attendee.checked_in_at,
          ping_count: pings.length,
          ping_last_source_name: last?.source_name ?? null,
          ping_last_message: last?.message ?? null,
          ping_last_created_at: last?.created_at ?? null,
        }
      })
    const count = (...statuses: AttendeeStatus[]) => attendees.filter((attendee) => statuses.includes(attendee.status)).length

    return {
      event: {
        id: event.id,
        name: event.name,
        location: event.location,
        datetime: event.datetime,
        description: event.description,
        createdAt: event.created_at,
        requirePhone: event.require_phone,
        organizerName: event.organizer_name,
        enableBringList: event.enable_bring_list,
        enableCarpool: event.enable_carpool,
        enableStops: event.enable_stops,
      },
      attendees,
      summary: {
        confirmed: count('confirmed'),
        excused: count('excused', 'excused_accepted'),
        rejected: count('excused_rejected'),
        invited: count('invited'),
      },
    }
  }

  // Keyed by RPC name; each takes the JSON body supabase.rpc() sends.
  const rpcs = {
    create_event: createEvent,
    get_event_payload: eventPayload,
    // A wrong or locked PIN is returned as { error }, not raised, so the
    // failed-attempt count sticks (see the SQL).
    get_organizer_path_with_pin(args: { p_event_id: string; p_pin: string }) {
      const event = findEvent(args.p_event_id, 'Akce neexistuje.')

      if (event.pin_locked_until !== null && event.pin_locked_until > Date.now()) {
        return { error: 'PIN je dočasně zablokovaný. Zkus to později.' }
      }

      if ((args.p_pin || '').trim() !== event.pin) {
        event.pin_failed_attempts += 1
        const lockMinutes = event.pin_failed_attempts >= 15 ? 24 * 60 : event.pin_failed_attempts >= 10 ? 60 : event.pin_failed_attempts >= 5 ? 15 : 0
        event.pin_locked_until = lockMinutes ? Date.now() + lockMinutes * MINUTE_MS : event.pin_locked_until
        return { error: 'Neplatný správcovský PIN.' }
      }

      event.pin_failed_attempts = 0
      event.pin_locked_until = null
      return { organizerPath: `/event/${event.id}/manage?token=${event.organizer_token}` }
    },
    update_event(args: {
      p_event_id: string
      p_token: string
      p_name: string
      p_location: string
      p_datetime: string
      p_description: string
      p_require_phone: boolean
      p_enable_bring_list: boolean
      p_enable_carpool: boolean
      p_enable_stops: boolean
    }) {
      if (!(args.p_token || '').trim()) {
        fail('Správa vyžaduje platný organizátorský odkaz.')
      }

      // update_event looks the event up by id and token together.
      const event =
        db.events.find((row) => row.id === args.p_event_id && row.organizer_token === args.p_token.trim()) || fail('Neplatný organizátorský odkaz.')
      Object.assign(event, {
        name: args.p_name.trim(),
        location: args.p_location.trim(),
        datetime: toTimestamp(args.p_datetime),
        description: args.p_description.trim(),
        require_phone: args.p_require_phone ?? false,
        enable_bring_list: args.p_enable_bring_list ?? true,
        enable_carpool: args.p_enable_carpool ?? true,
        enable_stops: args.p_enable_stops ?? true,
      })
      return { event: eventPayload({ p_event_id: event.id }).event }
    },
    // Skips the SQL's phone matching of invited guests; the flow never invites.
    submit_rsvp(args: { p_event_id: string; p_name: string; p_status: AttendeeStatus; p_excuse_reason: string | null; p_phone: string | null }) {
      const event = findEvent(args.p_event_id, 'Na tuhle akci se už nedá odpovědět.')
      const name = (args.p_name || '').trim() || fail('Vyplň svoje jméno.')
      const phone = (args.p_phone || '').replace(/[^0-9+]/g, '') || null

      if (args.p_status !== 'confirmed' && args.p_status !== 'excused') {
        fail('Neplatný typ odpovědi.')
      }

      if (event.require_phone && !phone) {
        fail('Vyplň prosím telefonní číslo.')
      }

      const existing = db.attendees.find((attendee) => attendee.event_id === event.id && sameName(attendee.name, name))
      const fields = {
        status: args.p_status,
        excuse_reason: args.p_status === 'excused' ? (args.p_excuse_reason || '').trim() || null : null,
        phone: phone ?? existing?.phone ?? null,
      }
      const attendee = existing ? Object.assign(existing, fields) : insert('attendees', { event_id: event.id, name, checked_in_at: null, ...fields })
      // Never the phone: anyone who knows a guest's name can call this.
      // (JSON drops an undefined field.)
      return { attendee: { ...attendee, phone: undefined } }
    },
    moderate_attendee(args: { p_event_id: string; p_attendee_id: number; p_token: string; p_status: AttendeeStatus }) {
      requireOrganizer(args.p_event_id, args.p_token)

      if (args.p_status !== 'excused_accepted' && args.p_status !== 'excused_rejected') {
        fail('Neplatná změna stavu omluvenky.')
      }

      const attendee =
        db.attendees.find((row) => row.event_id === args.p_event_id && row.id === args.p_attendee_id) || fail('Účastník nebyl nalezen.')

      if (!attendee.status.startsWith('excused')) {
        fail('Účastník mezitím změnil stav, zkus to prosím znovu.')
      }

      attendee.status = args.p_status
      return { attendee }
    },
    ping_attendee(args: { p_event_id: string; p_target_attendee_id: number; p_source_name: string; p_message: string | null }) {
      findEvent(args.p_event_id, 'Akce neexistuje.')
      const sourceName = (args.p_source_name || '').trim() || fail('Vyplň svoje jméno pro šťouchnutí.')
      const message = (args.p_message || '').trim() || null

      if (message && message.length > 280) {
        fail('Zpráva ke šťouchnutí může mít maximálně 280 znaků.')
      }

      const target =
        db.attendees.find((row) => row.event_id === args.p_event_id && row.id === args.p_target_attendee_id) || fail('Účastník nebyl nalezen.')

      if (sameName(target.name, sourceName)) {
        fail('Nemůžeš šťouchnout sám sebe.')
      }

      if (target.status !== 'excused' && target.status !== 'excused_rejected') {
        fail('Šťouchnout jde jen účastníka, který nejde.')
      }

      // One row per target and source, refreshed at most every 10 minutes.
      const previous = db.pings.find((ping) => ping.target_attendee_id === target.id && sameName(ping.source_name, sourceName))

      if (previous && Date.parse(previous.created_at) > Date.now() - 10 * MINUTE_MS) {
        fail('Tuhle osobu můžeš šťouchnout znovu až za 10 minut od posledního šťouchnutí.')
      }

      if (previous) {
        Object.assign(previous, { message, created_at: now() })
      } else {
        insert('pings', { event_id: args.p_event_id, target_attendee_id: target.id, source_name: sourceName, message })
      }

      return { success: true, pingCount: db.pings.filter((ping) => ping.target_attendee_id === target.id).length, lastMessage: message }
    },

    get_event_chat_messages: (args: { p_event_id: string; p_limit: number }) =>
      db.messages
        .filter((message) => message.event_id === args.p_event_id)
        .reverse()
        .slice(0, args.p_limit),
    send_event_chat_message(args: { p_event_id: string; p_sender_name: string; p_message: string }) {
      findEvent(args.p_event_id, 'Akce neexistuje.')
      const senderName = (args.p_sender_name || '').trim() || fail('Pro odeslání zprávy vyplň svoje jméno.')
      const message = (args.p_message || '').trim() || fail('Napiš zprávu do chatu.')

      if (message.length > 500) {
        fail('Text je moc dlouhý (limit 500 znaků).')
      }

      if (!db.attendees.some((row) => row.event_id === args.p_event_id && sameName(row.name, senderName) && row.status !== 'invited')) {
        fail('Do chatu může psát jen ten, kdo na akci odpověděl.')
      }

      const lastSent = db.messages.filter((row) => row.event_id === args.p_event_id && sameName(row.sender_name, senderName)).at(-1)

      if (lastSent && Date.parse(lastSent.created_at) > Date.now() - 3000) {
        fail('Zprávy posíláš moc rychle, chvilku počkej.')
      }

      return [insert('messages', { event_id: args.p_event_id, sender_name: senderName, message })]
    },
    get_chat_reactions: (args: { p_event_id: string; p_message_ids: number[] }) =>
      db.reactions
        .filter((reaction) => args.p_message_ids.includes(reaction.message_id))
        .map(({ id, message_id, sender_name, emoji }) => ({ id, message_id, sender_name, emoji })),
    toggle_chat_reaction(args: { p_message_id: number; p_sender_name: string; p_emoji: string }) {
      const index = db.reactions.findIndex(
        (row) => row.message_id === args.p_message_id && sameName(row.sender_name, args.p_sender_name) && row.emoji === args.p_emoji,
      )

      if (index !== -1) {
        db.reactions.splice(index, 1)
        return { success: true, action: 'removed' }
      }

      insert('reactions', { message_id: args.p_message_id, sender_name: args.p_sender_name, emoji: args.p_emoji })
      return { success: true, action: 'added' }
    },

    get_event_signup_items: (args: { p_event_id: string }) =>
      db.items
        .filter((item) => item.event_id === args.p_event_id)
        .map((item) => ({
          ...item,
          event_signup_claims: db.claims
            .filter((claim) => claim.item_id === item.id)
            .map(({ id, attendee_name, seats }) => ({ id, attendee_name, seats })),
        })),
    add_signup_item(args: {
      p_event_id: string
      p_category: SignupItemRow['category']
      p_label: string
      p_capacity: number
      p_note: string | null
      p_created_by: string
    }) {
      findEvent(args.p_event_id, 'Akce neexistuje.')
      const item = insert('items', {
        event_id: args.p_event_id,
        category: args.p_category,
        label: args.p_label.trim(),
        capacity: args.p_capacity,
        note: args.p_note,
        created_by: args.p_created_by,
      })
      return { success: true, id: item.id }
    },
    claim_signup_item(args: { p_item_id: number; p_attendee_name: string; p_seats: number }) {
      const name = (args.p_attendee_name || '').trim() || fail('Chybí jméno.')
      const seats = Math.max(args.p_seats ?? 1, 1)
      const item = db.items.find((row) => row.id === args.p_item_id) || fail('Položka nebyla nalezena.')

      if (item.category === 'ride' && sameName(item.created_by, name)) {
        fail('Jako řidič už místo v autě máš, nemůžeš se přihlásit na vlastní nabídku odvozu.')
      }

      // Someone's own claim is replaced, so it doesn't count against them.
      const taken = db.claims
        .filter((claim) => claim.item_id === item.id && !sameName(claim.attendee_name, name))
        .reduce((sum, claim) => sum + claim.seats, 0)

      if (taken + seats > item.capacity) {
        fail('Už je to obsazené.')
      }

      const existing = db.claims.find((claim) => claim.item_id === item.id && sameName(claim.attendee_name, name))

      if (existing) {
        existing.seats = seats
      } else {
        insert('claims', { item_id: item.id, attendee_name: name, seats })
      }

      return { success: true }
    },

    get_event_stops: (args: { p_event_id: string }) =>
      db.stops
        .filter((stop) => stop.event_id === args.p_event_id)
        .map(({ id, event_id, position, name, location, starts_at_label }) => ({ id, event_id, position, name, location, starts_at_label })),
    add_event_stop(args: { p_event_id: string; p_token: string; p_name: string; p_location: string | null; p_starts_at_label: string | null }) {
      requireOrganizer(args.p_event_id, args.p_token)
      insert('stops', {
        event_id: args.p_event_id,
        position: db.stops.filter((stop) => stop.event_id === args.p_event_id).length,
        name: args.p_name.trim(),
        location: args.p_location || null,
        starts_at_label: args.p_starts_at_label || null,
      })
      return { success: true }
    },

    record_event_photo(args: { p_event_id: string; p_storage_path: string; p_uploaded_by: string; p_delete_token: string | null }) {
      findEvent(args.p_event_id, 'Akce neexistuje.')
      const uploadedBy = (args.p_uploaded_by || '').trim() || fail('Chybí jméno nahrávajícího.')
      const folders = args.p_storage_path.split('/').slice(0, -1)
      const fileStem = (args.p_storage_path.split('/').at(-1) ?? '').split('.')[0]
      const deleteTokenHash = args.p_delete_token ? sha256Hex(args.p_delete_token) : null

      if (folders.length !== 1 || folders[0] !== args.p_event_id) {
        fail('Fotka nepatří k této akci.')
      }

      // The file is named after the hash of its delete token.
      if ((deleteTokenHash !== null || /^[0-9a-f]{64}$/.test(fileStem)) && deleteTokenHash !== fileStem) {
        fail('Fotku může přidat jen ten, kdo ji nahrál.')
      }

      if (!db.objects.includes(args.p_storage_path)) {
        fail('Nahraná fotka nebyla nalezena.')
      }

      if (db.photos.some((photo) => photo.storage_path === args.p_storage_path)) {
        fail('Fotka už byla přidána.')
      }

      insert('photos', { event_id: args.p_event_id, storage_path: args.p_storage_path, uploaded_by: uploadedBy, delete_token_hash: deleteTokenHash })
      return { success: true }
    },
    get_event_photos: (args: { p_event_id: string }) =>
      db.photos
        .filter((photo) => photo.event_id === args.p_event_id)
        .map(({ id, storage_path, uploaded_by, created_at }) => ({ id, storage_path, uploaded_by, created_at })),
    get_event_photo_likes: (args: { p_event_id: string }) =>
      db.likes.filter((like) => like.event_id === args.p_event_id).map(({ photo_id, liker_name }) => ({ photo_id, liker_name })),
    get_event_photo_comments: (args: { p_event_id: string }) =>
      db.comments
        .filter((comment) => comment.event_id === args.p_event_id)
        .map(({ id, photo_id, author_name, message, created_at }) => ({ id, photo_id, author_name, message, created_at })),
    toggle_event_photo_like(args: { p_event_id: string; p_photo_id: number; p_liker_name: string }) {
      const index = db.likes.findIndex((like) => like.photo_id === args.p_photo_id && sameName(like.liker_name, args.p_liker_name))

      if (index !== -1) {
        db.likes.splice(index, 1)
        return { success: true, liked: false }
      }

      insert('likes', { event_id: args.p_event_id, photo_id: args.p_photo_id, liker_name: args.p_liker_name })
      return { success: true, liked: true }
    },
    add_event_photo_comment: (args: { p_event_id: string; p_photo_id: number; p_author_name: string; p_message: string }) => {
      const { id, photo_id, author_name, message, created_at } = insert('comments', {
        event_id: args.p_event_id,
        photo_id: args.p_photo_id,
        author_name: args.p_author_name,
        message: args.p_message.trim(),
      })
      return [{ id, photo_id, author_name, message, created_at }]
    },

    create_event_poll(args: {
      p_creator_name: string
      p_name: string
      p_description: string | null
      p_options: { datetime: string; location: string; note?: string }[]
    }) {
      const poll: PollRow = {
        id: randomId(),
        creator_token: randomId(24),
        creator_name: args.p_creator_name,
        name: args.p_name,
        description: args.p_description || null,
        finalized_event_id: null,
      }
      db.polls.push(poll)

      for (const option of args.p_options) {
        insert('options', { poll_id: poll.id, datetime: toTimestamp(option.datetime), location: option.location, note: option.note || null })
      }

      return { pollId: poll.id, votePath: `/poll/${poll.id}`, creatorPath: `/poll/${poll.id}?token=${poll.creator_token}` }
    },
    get_poll_payload(args: { p_poll_id: string; p_token: string | null }) {
      const poll = findPoll(args.p_poll_id)
      return {
        poll: {
          id: poll.id,
          name: poll.name,
          description: poll.description,
          creatorName: poll.creator_name,
          finalizedEventId: poll.finalized_event_id,
        },
        isCreator: args.p_token != null && args.p_token === poll.creator_token,
        options: db.options
          .filter((option) => option.poll_id === poll.id)
          .map((option) => ({
            id: option.id,
            datetime: option.datetime,
            location: option.location,
            note: option.note,
            votes: db.votes.filter((vote) => vote.option_id === option.id).map((vote) => vote.voter_name),
          })),
      }
    },
    vote_event_poll(args: { p_poll_id: string; p_option_id: number; p_voter_name: string }) {
      const poll = findPoll(args.p_poll_id)

      if (poll.finalized_event_id) {
        fail('Tahle anketa už byla vyhodnocená.')
      }

      const name = (args.p_voter_name || '').trim() || fail('Napiš svoje jméno pro hlasování.')
      const option = pollOption(poll.id, args.p_option_id)
      // One vote per name and poll: a new vote replaces the old one.
      db.votes = db.votes.filter((vote) => !(vote.poll_id === poll.id && sameName(vote.voter_name, name)))
      insert('votes', { poll_id: poll.id, option_id: option.id, voter_name: name })
      return { success: true }
    },
    finalize_event_poll(args: { p_poll_id: string; p_token: string; p_option_id: number; p_organizer_pin: string; p_description: string | null }) {
      const poll = db.polls.find((row) => row.id === args.p_poll_id)

      if (!poll || args.p_token == null || poll.creator_token !== args.p_token) {
        fail('Neplatný odkaz tvůrce ankety.')
      }

      if (poll.finalized_event_id) {
        fail('Tahle anketa už byla vyhodnocená.')
      }

      const option = pollOption(poll.id, args.p_option_id)
      const result = createEvent({
        p_name: poll.name,
        p_location: option.location,
        p_datetime: option.datetime,
        p_description: (args.p_description || '').trim() || 'Vzniklo z ankety.',
        p_organizer_name: poll.creator_name,
        p_organizer_pin: args.p_organizer_pin,
      })
      poll.finalized_event_id = result.event.id
      return result
    },

    submit_feedback_report: (args: { p_type: FeedbackRow['type']; p_name: string; p_message: string }) => {
      insert('feedback', { type: args.p_type, name: args.p_name, message: args.p_message })
      return { success: true }
    },
  }

  // An option of this poll whose date is still ahead (vote and finalize check both).
  function pollOption(pollId: string, optionId: number) {
    const option = db.options.find((row) => row.id === optionId && row.poll_id === pollId) || fail('Tahle možnost neexistuje.')
    return option.datetime > pragueNow() ? option : fail('Termín možnosti musí být v budoucnosti.')
  }

  type RpcName = keyof typeof rpcs
  const isRpcName = (name: string): name is RpcName => Object.hasOwn(rpcs, name)

  function json(route: Route, body: unknown, status = 200) {
    return route.fulfill({ status, headers: CORS_HEADERS, contentType: 'application/json', body: JSON.stringify(body) })
  }

  async function handleSupabase(route: Route) {
    const request = route.request()
    const { pathname } = new URL(request.url())

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: CORS_HEADERS })
    }

    const rpcName = pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/)?.[1]

    if (rpcName && isRpcName(rpcName)) {
      const args: Record<string, unknown> = request.postDataJSON() ?? {}
      calls.push({ name: rpcName, args })
      // The body is whatever the app sent; each handler declares what it expects.
      const handler = rpcs[rpcName] as (args: unknown) => unknown

      try {
        return json(route, handler(args) ?? null)
      } catch (error) {
        if (error instanceof RpcError) {
          return json(route, { code: 'P0001', message: error.message, details: null, hint: null }, 400)
        }

        throw error
      }
    }

    if (request.method() === 'POST' && pathname === '/functions/v1/delete-event-data') {
      const body: unknown = request.postDataJSON()
      calls.push({ name: 'delete-event-data', args: (body ?? {}) as Record<string, unknown> })
      const { status, payload } = deleteEventData(body)
      return json(route, payload, status)
    }

    if (request.method() === 'POST' && pathname.startsWith('/storage/v1/object/event-photos/')) {
      const path = decodeURIComponent(pathname.slice('/storage/v1/object/event-photos/'.length))
      calls.push({ name: 'storage.upload', args: { path } })

      // Uploads don't upsert, so an existing file is refused.
      if (db.objects.includes(path)) {
        return json(route, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' }, 400)
      }

      db.objects.push(path)
      return json(route, { Key: `event-photos/${path}`, Id: crypto.randomUUID() })
    }

    if (request.method() === 'GET' && pathname.startsWith('/storage/v1/object/public/event-photos/')) {
      const path = decodeURIComponent(pathname.slice('/storage/v1/object/public/event-photos/'.length))
      return db.objects.includes(path)
        ? route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'image/png', body: PHOTO_PNG })
        : json(route, { statusCode: '404', error: 'not_found', message: 'Object not found' }, 400)
    }

    unexpected.push(`${request.method()} ${pathname}`)
    return json(route, { message: `Not faked: ${pathname}` }, 404)
  }

  // supabase/functions/delete-event-data: the same checks and answers, with
  // authorize_event_photo_delete for a photo.
  function deleteEventData(input: unknown): { status: number; payload: Record<string, unknown> } {
    const refuse = (status: number, error: string) => ({ status, payload: { error } })

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return refuse(400, 'Neplatný požadavek.')
    }

    const body = input as { action?: unknown; eventId?: unknown; token?: unknown; photoId?: unknown; photoToken?: unknown }
    const eventId = typeof body.eventId === 'string' ? body.eventId.trim() : ''
    const token = typeof body.token === 'string' ? body.token : ''
    const photoToken = typeof body.photoToken === 'string' ? body.photoToken : ''
    const hasCredentials = token !== '' || (body.action === 'delete_photo' && photoToken !== '')

    if (!eventId || !hasCredentials || (body.action !== 'delete_event' && body.action !== 'delete_photo')) {
      return refuse(400, 'Neplatný požadavek.')
    }

    const event = db.events.find((row) => row.id === eventId)
    const isOrganizer = Boolean(event && token && event.organizer_token === token)

    if (body.action === 'delete_photo') {
      const photoId = String(body.photoId ?? '')

      if (!/^\d{1,18}$/.test(photoId)) {
        return refuse(400, 'Fotka nebyla nalezena.')
      }

      if (!isOrganizer && !photoToken) {
        return refuse(403, 'Neplatný organizátorský odkaz.')
      }

      const photo = db.photos.find((row) => row.id === Number(photoId) && row.event_id === eventId)

      if (!photo) {
        return refuse(403, 'Fotka nebyla nalezena.')
      }

      if (!isOrganizer && photo.delete_token_hash !== sha256Hex(photoToken)) {
        return refuse(403, 'Tuhle fotku může smazat jen ten, kdo ji nahrál, nebo organizátor.')
      }

      db.objects = db.objects.filter((path) => path !== photo.storage_path)
      deletePhotos([photo.id])
      return { status: 200, payload: { success: true } }
    }

    // A missing event gets the same answer as a wrong token.
    if (!isOrganizer) {
      return refuse(401, 'Neplatný organizátorský odkaz.')
    }

    db.objects = db.objects.filter((path) => !path.startsWith(`${eventId}/`))
    deleteEvent(eventId)
    return { status: 200, payload: { success: true } }
  }

  // Open-Meteo: every place is in Prague and every day is sunny, 18-26 °C.
  function handleWeather(route: Route) {
    const url = new URL(route.request().url())

    if (url.hostname.startsWith('geocoding')) {
      return json(route, { results: [{ name: url.searchParams.get('name'), latitude: 50.1, longitude: 14.4 }] })
    }

    const days = Array.from({ length: 20 }, (_, index) => new Date(Date.now() + (index - 2) * 86400000).toISOString().slice(0, 10))
    return json(route, {
      daily: { time: days, weathercode: days.map(() => 0), temperature_2m_max: days.map(() => 26), temperature_2m_min: days.map(() => 18) },
    })
  }

  async function install(page: Page) {
    await page.route(`${SUPABASE_URL}/**`, handleSupabase)
    await page.route(/^https:\/\/(geocoding-)?api\.open-meteo\.com\//, handleWeather)
    // Realtime: a socket that never answers. The app refetches after its own
    // writes, so the flow works without realtime ticks.
    await page.routeWebSocket(/\/realtime\/v1\//, () => {})
  }

  return { db, calls, unexpected, install }
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>
