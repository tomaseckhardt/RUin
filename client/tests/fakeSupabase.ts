// An in-memory stand-in for the Supabase project, so the E2E test never
// touches a real database. It answers the requests the app makes to
// SUPABASE_URL (RPCs, Storage, the delete-event-data function) with the
// shapes the SQL in supabase/sql/all-phases.sql returns, and fakes the
// Open-Meteo weather API. Only what the E2E flow uses is implemented; any
// other request is recorded in `unexpected` and fails the test.

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
type PhotoRow = Row & { event_id: string; storage_path: string; uploaded_by: string }
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

  const findEvent = (id: string) => db.events.find((event) => event.id === id) || fail('Akce neexistuje.')
  const requireOrganizer = (eventId: string, token: string) => {
    const event = findEvent(eventId)
    return event.organizer_token === token ? event : fail('Neplatný organizátorský odkaz.')
  }

  function createEvent(args: CreateEventArgs): CreatedEvent {
    if (!/^\d{4}$/.test(args.p_organizer_pin || '')) {
      fail('Správcovský PIN musí mít přesně 4 číslice.')
    }

    const event: EventRow = {
      id: randomId(),
      organizer_token: randomId(24),
      pin: args.p_organizer_pin,
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

    return {
      event: { id: event.id, name: event.name, location: event.location, datetime: event.datetime, description: event.description },
      guestPath: `/event/${event.id}`,
      organizerPath: `/event/${event.id}/manage?token=${event.organizer_token}`,
    }
  }

  function eventPayload(args: { p_event_id: string; p_organizer_token?: string | null }) {
    const event = findEvent(args.p_event_id)

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
    get_organizer_path_with_pin(args: { p_event_id: string; p_pin: string }) {
      const event = findEvent(args.p_event_id)
      return event.pin === args.p_pin
        ? { organizerPath: `/event/${event.id}/manage?token=${event.organizer_token}` }
        : fail('Neplatný správcovský PIN.')
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
      const event = requireOrganizer(args.p_event_id, args.p_token)
      Object.assign(event, {
        name: args.p_name.trim(),
        location: args.p_location.trim(),
        datetime: toTimestamp(args.p_datetime),
        description: args.p_description.trim(),
        require_phone: args.p_require_phone,
        enable_bring_list: args.p_enable_bring_list,
        enable_carpool: args.p_enable_carpool,
        enable_stops: args.p_enable_stops,
      })
      return { event: eventPayload({ p_event_id: event.id }).event }
    },
    submit_rsvp(args: { p_event_id: string; p_name: string; p_status: AttendeeStatus; p_excuse_reason: string | null; p_phone: string | null }) {
      findEvent(args.p_event_id)
      const name = (args.p_name || '').trim() || fail('Vyplň svoje jméno.')
      const existing = db.attendees.find((attendee) => attendee.event_id === args.p_event_id && sameName(attendee.name, name))
      const fields = { status: args.p_status, excuse_reason: args.p_excuse_reason || null, phone: args.p_phone }
      const attendee = existing
        ? Object.assign(existing, fields)
        : insert('attendees', { event_id: args.p_event_id, name, checked_in_at: null, ...fields })
      return { attendee }
    },
    moderate_attendee(args: { p_event_id: string; p_attendee_id: number; p_token: string; p_status: AttendeeStatus }) {
      requireOrganizer(args.p_event_id, args.p_token)
      const attendee = db.attendees.find((row) => row.id === args.p_attendee_id) || fail('Účastník nebyl nalezen.')
      attendee.status = args.p_status
      return { attendee }
    },
    ping_attendee(args: { p_event_id: string; p_target_attendee_id: number; p_source_name: string; p_message: string | null }) {
      const target = db.attendees.find((row) => row.id === args.p_target_attendee_id) || fail('Účastník nebyl nalezen.')

      if (sameName(target.name, args.p_source_name)) {
        fail('Nemůžeš šťouchnout sám sebe.')
      }

      if (target.status !== 'excused' && target.status !== 'excused_rejected') {
        fail('Šťouchnout jde jen účastníka, který nejde.')
      }

      insert('pings', {
        event_id: args.p_event_id,
        target_attendee_id: target.id,
        source_name: args.p_source_name,
        message: args.p_message || null,
      })
      return { success: true, pingCount: db.pings.filter((ping) => ping.target_attendee_id === target.id).length, lastMessage: args.p_message }
    },

    get_event_chat_messages: (args: { p_event_id: string; p_limit: number }) =>
      db.messages
        .filter((message) => message.event_id === args.p_event_id)
        .reverse()
        .slice(0, args.p_limit),
    send_event_chat_message: (args: { p_event_id: string; p_sender_name: string; p_message: string }) => [
      insert('messages', { event_id: args.p_event_id, sender_name: args.p_sender_name, message: args.p_message }),
    ],
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
      findEvent(args.p_event_id)
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
      const item = db.items.find((row) => row.id === args.p_item_id) || fail('Položka nebyla nalezena.')
      const taken = db.claims.filter((claim) => claim.item_id === item.id).reduce((sum, claim) => sum + claim.seats, 0)

      if (taken + args.p_seats > item.capacity) {
        fail('Už je to obsazené.')
      }

      insert('claims', { item_id: item.id, attendee_name: args.p_attendee_name, seats: args.p_seats })
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

    record_event_photo(args: { p_event_id: string; p_storage_path: string; p_uploaded_by: string; p_delete_token: string }) {
      findEvent(args.p_event_id)
      insert('photos', { event_id: args.p_event_id, storage_path: args.p_storage_path, uploaded_by: args.p_uploaded_by })
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
      const poll = db.polls.find((row) => row.id === args.p_poll_id) || fail('Anketa neexistuje.')
      return {
        poll: {
          id: poll.id,
          name: poll.name,
          description: poll.description,
          creatorName: poll.creator_name,
          finalizedEventId: poll.finalized_event_id,
        },
        isCreator: args.p_token === poll.creator_token,
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
      db.votes = db.votes.filter((vote) => !(vote.poll_id === args.p_poll_id && sameName(vote.voter_name, args.p_voter_name)))
      insert('votes', { poll_id: args.p_poll_id, option_id: args.p_option_id, voter_name: args.p_voter_name })
      return { success: true }
    },
    finalize_event_poll(args: { p_poll_id: string; p_token: string; p_option_id: number; p_organizer_pin: string; p_description: string | null }) {
      const poll = db.polls.find((row) => row.id === args.p_poll_id && row.creator_token === args.p_token) || fail('Neplatný odkaz tvůrce ankety.')
      const option = db.options.find((row) => row.id === args.p_option_id) || fail('Tahle možnost neexistuje.')
      const result = createEvent({
        p_name: poll.name,
        p_location: option.location,
        p_datetime: option.datetime,
        p_description: args.p_description || poll.name,
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

    if (request.method() === 'POST' && pathname.startsWith('/storage/v1/object/event-photos/')) {
      const path = pathname.slice('/storage/v1/object/event-photos/'.length)
      calls.push({ name: 'storage.upload', args: { path } })
      return json(route, { Key: `event-photos/${path}`, Id: crypto.randomUUID() })
    }

    if (request.method() === 'GET' && pathname.startsWith('/storage/v1/object/public/event-photos/')) {
      return route.fulfill({ status: 200, headers: CORS_HEADERS, contentType: 'image/png', body: PHOTO_PNG })
    }

    unexpected.push(`${request.method()} ${pathname}`)
    return json(route, { message: `Not faked: ${pathname}` }, 404)
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
