import { createHash } from 'node:crypto'
import { supabase } from '../../src/lib/supabase.js'
import { setLocale, t } from '../../src/lib/i18n.js'
import {
  accessOwnerAccount,
  claimSignupItem,
  createEvent,
  getChatReactions,
  getEvent,
  getEventChatMessages,
  getEventPhotos,
  getEventStops,
  getSignupItems,
  moderateAttendee,
  removeEvent,
  addEventPhotoComment,
  deleteEventPhoto,
  deleteEventPhotoComment,
  deleteOwnEventPhoto,
  getEventPhotoComments,
  getEventPhotoLikes,
  isPushSubscribed,
  toggleEventPhotoLike,
  recordEventPhoto,
  replayRetryQueue,
  sendEventChatMessage,
  submitRsvp,
  unclaimSignupItem,
  unlockManageWithPin,
  unregisterPushSubscription,
  uploadEventPhoto,
} from '../../src/lib/api.js'

jest.mock('../../src/lib/supabase.js', () => ({
  supabase: {
    rpc: jest.fn(),
    storage: {
      from: jest.fn(),
    },
    functions: {
      invoke: jest.fn(),
    },
  },
}))

// The client above is bare jest.fn()s. These handles type them for what the
// tests do with them - the SDK's own types describe the real client and
// would reject a hand-made { data, error }.
type RpcResult = { data: unknown; error: { message?: string; code?: string } | null }
const rpc = supabase.rpc as unknown as jest.Mock<Promise<RpcResult>, [name: string, args?: Record<string, unknown>]>
const storageFrom = supabase.storage.from as unknown as jest.Mock
const invokeFunction = supabase.functions.invoke as unknown as jest.Mock

beforeEach(() => {
  rpc.mockReset()
  storageFrom.mockReset()
  invokeFunction.mockReset()
  window.localStorage.removeItem('ruin-retry-queue')
})

describe('callRpc error handling (via submitRsvp)', () => {
  it('resolves with the RPC data on success', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    const result = await submitRsvp('event-1', { name: 'Alice', status: 'confirmed' })

    expect(result).toEqual({ success: true })
    expect(supabase.rpc).toHaveBeenCalledWith('submit_rsvp', {
      p_event_id: 'event-1',
      p_name: 'Alice',
      p_status: 'confirmed',
      p_excuse_reason: null,
      p_phone: null,
    })
  })

  it('throws the RPC error message when the call fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Vyplň svoje jméno.' } })

    await expect(submitRsvp('event-1', { name: '', status: 'confirmed' })).rejects.toThrow('Vyplň svoje jméno.')
  })

  it('falls back to the generic message when the error has none', async () => {
    rpc.mockResolvedValue({ data: null, error: {} })

    await expect(createEvent({ name: 'x' })).rejects.toThrow('Akci se nepodařilo vytvořit.')
  })
})

describe('deleteEventData', () => {
  it('calls the server-side handler to delete an event and its stored photos', async () => {
    invokeFunction.mockResolvedValue({ data: { success: true }, error: null })

    await removeEvent('event-1', 'organizer-token')

    expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-event-data', {
      body: { action: 'delete_event', eventId: 'event-1', token: 'organizer-token' },
    })
  })

  it('calls the server-side handler to delete a guest’s own photo with its delete token', async () => {
    invokeFunction.mockResolvedValue({ data: { success: true }, error: null })

    await deleteOwnEventPhoto('event-1', 12, 'delete-token-1')

    expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-event-data', {
      body: { action: 'delete_photo', eventId: 'event-1', photoId: 12, photoToken: 'delete-token-1' },
    })
  })

  it('calls the server-side handler to delete a photo', async () => {
    invokeFunction.mockResolvedValue({ data: { success: true }, error: null })

    await deleteEventPhoto('event-1', 'organizer-token', 12)

    expect(supabase.functions.invoke).toHaveBeenCalledWith('delete-event-data', {
      body: { action: 'delete_photo', eventId: 'event-1', token: 'organizer-token', photoId: 12 },
    })
  })
})

describe('recordEventPhoto', () => {
  it('sends the photo’s delete token so the uploader can delete it later', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await recordEventPhoto('event-1', 'event-1/photo.jpg', 'Alice', 'delete-token-1')

    expect(supabase.rpc).toHaveBeenCalledWith('record_event_photo', {
      p_event_id: 'event-1',
      p_storage_path: 'event-1/photo.jpg',
      p_uploaded_by: 'Alice',
      p_delete_token: 'delete-token-1',
    })
  })
})

const OFFLINE = { data: null, error: { message: 'TypeError: Failed to fetch' } }
const RETRY_QUEUE_MAX_AGE_MS = 6 * 60 * 60 * 1000

type QueuedCall = { id: string; name: string; args: Record<string, unknown>; queuedAt: number }

function queuedRsvp(eventId: string, queuedAt = Date.now()): QueuedCall {
  return { id: `queued-${eventId}`, name: 'submit_rsvp', args: { p_event_id: eventId, p_name: 'Alice', p_status: 'confirmed' }, queuedAt }
}

function seedRetryQueue(items: QueuedCall[]) {
  window.localStorage.setItem('ruin-retry-queue', JSON.stringify(items))
}

function readRetryQueue(): QueuedCall[] {
  return JSON.parse(window.localStorage.getItem('ruin-retry-queue') ?? '[]')
}

describe('retry queue', () => {
  it('queues a retryable call made offline and throws an error marked queued', async () => {
    rpc.mockResolvedValue(OFFLINE)

    const error = await submitRsvp('event-1', { name: 'Alice', status: 'confirmed' }).catch((caught) => caught)

    expect(error.queued).toBe(true)
    expect(readRetryQueue()).toEqual([
      { id: expect.any(String), name: 'submit_rsvp', args: expect.objectContaining({ p_event_id: 'event-1' }), queuedAt: expect.any(Number) },
    ])
  })

  it('never queues a call that would duplicate something when replayed', async () => {
    rpc.mockResolvedValue(OFFLINE)

    const error = await sendEventChatMessage('event-1', 'Alice', 'Hi').catch((caught) => caught)

    expect(error.message).toBe(t('api.offline'))
    expect(error.queued).toBeUndefined()
    expect(readRetryQueue()).toEqual([])
  })

  it('keeps only the newest of two queued calls for the same thing', async () => {
    rpc.mockResolvedValue(OFFLINE)

    await submitRsvp('event-1', { name: 'Alice', status: 'confirmed' }).catch(() => {})
    await submitRsvp('event-1', { name: 'Alice', status: 'excused', excuseReason: 'Sick' }).catch(() => {})
    await submitRsvp('event-1', { name: 'Bob', status: 'confirmed' }).catch(() => {})

    expect(readRetryQueue().map((item) => [item.args.p_name, item.args.p_status])).toEqual([
      ['Alice', 'excused'],
      ['Bob', 'confirmed'],
    ])
  })

  it('replays the queue oldest first and empties it', async () => {
    seedRetryQueue([queuedRsvp('event-1'), queuedRsvp('event-2')])
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await replayRetryQueue()

    expect(rpc.mock.calls.map(([, args]) => args?.p_event_id)).toEqual(['event-1', 'event-2'])
    expect(readRetryQueue()).toEqual([])
  })

  it('stops at the first call that is still offline and keeps it and the rest', async () => {
    seedRetryQueue([queuedRsvp('event-1'), queuedRsvp('event-2')])
    rpc.mockResolvedValue(OFFLINE)

    await replayRetryQueue()

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(readRetryQueue().map((item) => item.id)).toEqual(['queued-event-1', 'queued-event-2'])
  })

  it('drops a call that fails for a real reason and goes on with the next', async () => {
    seedRetryQueue([queuedRsvp('event-1'), queuedRsvp('event-2')])
    rpc.mockImplementation((_name, args) =>
      Promise.resolve(
        args?.p_event_id === 'event-1'
          ? { data: null, error: { message: 'Na tuhle akci se už nedá odpovědět.', code: 'P0001' } }
          : { data: { success: true }, error: null },
      ),
    )

    await replayRetryQueue()

    expect(rpc).toHaveBeenCalledTimes(2)
    expect(readRetryQueue()).toEqual([])
  })

  it('drops calls older than 6 hours, or without a time, without replaying them', async () => {
    // JSON drops the undefined queuedAt.
    const undated = { ...queuedRsvp('event-3'), queuedAt: undefined }
    window.localStorage.setItem(
      'ruin-retry-queue',
      JSON.stringify([queuedRsvp('event-1', Date.now() - RETRY_QUEUE_MAX_AGE_MS - 1000), queuedRsvp('event-2'), undated]),
    )
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await replayRetryQueue()

    expect(rpc.mock.calls.map(([, args]) => args?.p_event_id)).toEqual(['event-2'])
    expect(readRetryQueue()).toEqual([])
  })
})

// get_organizer_path_with_pin and access_owner_account return a refusal as
// { error } (so the failed-attempt counter commits) instead of raising it.
describe('refusals returned as { error }', () => {
  afterEach(() => {
    setLocale('cs')
  })

  it('throws a wrong PIN like a raised error, translated with serverMessage kept', async () => {
    setLocale('en')
    rpc.mockResolvedValue({ data: { error: 'Neplatný správcovský PIN.' }, error: null })

    const error = await unlockManageWithPin('event-1', '0000').catch((caught) => caught)

    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('Invalid admin PIN.')
    expect(error.serverMessage).toBe('Neplatný správcovský PIN.')
  })

  it('throws a locked PIN', async () => {
    rpc.mockResolvedValue({ data: { error: 'PIN je dočasně zablokovaný. Zkus to později.' }, error: null })

    await expect(unlockManageWithPin('event-1', '1234')).rejects.toThrow('PIN je dočasně zablokovaný. Zkus to později.')
  })

  it('resolves with the organizer path for the right PIN', async () => {
    rpc.mockResolvedValue({ data: { organizerPath: '/event/event-1/manage?token=abc' }, error: null })

    await expect(unlockManageWithPin('event-1', '1234')).resolves.toEqual({ organizerPath: '/event/event-1/manage?token=abc' })
    expect(rpc).toHaveBeenCalledWith('get_organizer_path_with_pin', { p_event_id: 'event-1', p_pin: '1234' })
  })

  it('throws a wrong owner code and resolves with the account for the right one', async () => {
    rpc.mockResolvedValueOnce({ data: { error: 'Neplatný kód.' }, error: null })
    await expect(accessOwnerAccount('Eva', '+420 777 000 000', '000000')).rejects.toThrow('Neplatný kód.')

    rpc.mockResolvedValueOnce({ data: { ownerId: 'owner-1', token: 'owner-token' }, error: null })
    await expect(accessOwnerAccount('Eva', '+420 777 000 000', '123456')).resolves.toEqual({ ownerId: 'owner-1', token: 'owner-token' })
  })
})

describe('retry queue concurrency', () => {
  it('preserves a retryable request enqueued while an older request is replaying', async () => {
    let finishReplay: (result: RpcResult) => void = () => {}
    const pendingReplay = new Promise<RpcResult>((resolve) => {
      finishReplay = resolve
    })

    seedRetryQueue([queuedRsvp('event-1')])
    rpc.mockImplementation((_name, args) =>
      args?.p_event_id === 'event-1' ? pendingReplay : Promise.resolve({ data: null, error: { message: 'TypeError: Failed to fetch' } }),
    )

    const replay = replayRetryQueue()
    await Promise.resolve()
    await expect(submitRsvp('event-2', { name: 'Alice', status: 'confirmed' })).rejects.toThrow()

    finishReplay({ data: { success: true }, error: null })
    await replay

    const remainingQueue = JSON.parse(window.localStorage.getItem('ruin-retry-queue') ?? '[]')
    expect(remainingQueue).toHaveLength(1)
    expect(remainingQueue[0].args.p_event_id).toBe('event-2')
  })
})

describe('database error messages in the English UI', () => {
  afterEach(() => {
    setLocale('cs')
  })

  it('translates a known message but keeps the original on serverMessage', async () => {
    setLocale('en')
    rpc.mockResolvedValue({ data: null, error: { message: 'Neplatný organizátorský odkaz.' } })

    const error = await getEvent('event-1', 'stale-token').catch((caught) => caught)

    expect(error.message).toBe('Invalid organizer link.')
    expect(error.serverMessage).toBe('Neplatný organizátorský odkaz.')
  })

  it('falls back to the English generic message when the error has none', async () => {
    setLocale('en')
    rpc.mockResolvedValue({ data: null, error: {} })

    await expect(createEvent({ name: 'x' })).rejects.toThrow('Couldn’t create the event.')
  })
})

describe('unclaimSignupItem', () => {
  it('sends the same name as both the target and the requester', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await unclaimSignupItem(42, 'Bob')

    expect(supabase.rpc).toHaveBeenCalledWith('unclaim_signup_item', {
      p_item_id: 42,
      p_attendee_name: 'Bob',
      p_requester_name: 'Bob',
    })
  })
})

describe('reads go through event-scoped RPCs, not direct table selects', () => {
  it('getEventChatMessages calls get_event_chat_messages and reverses the order', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 2 }, { id: 1 }],
      error: null,
    })

    const result = await getEventChatMessages('event-1', 50)

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_chat_messages', {
      p_event_id: 'event-1',
      p_limit: 50,
    })
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('getChatReactions passes the event id and skips the RPC call for an empty id list', async () => {
    const result = await getChatReactions('event-1', [])

    expect(result).toEqual([])
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('getChatReactions calls get_chat_reactions with the event id when there are ids', async () => {
    rpc.mockResolvedValue({ data: [{ id: 1, message_id: 9 }], error: null })

    await getChatReactions('event-1', [9])

    expect(supabase.rpc).toHaveBeenCalledWith('get_chat_reactions', {
      p_event_id: 'event-1',
      p_message_ids: [9],
    })
  })

  it('getSignupItems calls get_event_signup_items', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await getSignupItems('event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_signup_items', { p_event_id: 'event-1' })
  })

  it('getEventStops calls get_event_stops', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await getEventStops('event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_stops', { p_event_id: 'event-1' })
  })

  it('getEventPhotos calls get_event_photos', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await getEventPhotos('event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_photos', { p_event_id: 'event-1' })
  })
})

describe('sendEventChatMessage', () => {
  it('rejects an empty message without calling supabase', async () => {
    await expect(sendEventChatMessage('event-1', 'Alice', '   ')).rejects.toThrow('Napiš zprávu do chatu.')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects a missing sender name without calling supabase', async () => {
    await expect(sendEventChatMessage('event-1', '  ', 'Ahoj')).rejects.toThrow('Pro odeslání zprávy vyplň svoje jméno.')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('sends the trimmed values and returns the first returned row', async () => {
    rpc.mockResolvedValue({
      data: [{ id: 1, event_id: 'event-1', sender_name: 'Alice', message: 'Ahoj', created_at: 'now' }],
      error: null,
    })

    const result = await sendEventChatMessage('event-1', '  Alice  ', '  Ahoj  ')

    expect(supabase.rpc).toHaveBeenCalledWith('send_event_chat_message', {
      p_event_id: 'event-1',
      p_sender_name: 'Alice',
      p_message: 'Ahoj',
    })
    expect(result.sender_name).toBe('Alice')
  })
})

describe('uploadEventPhoto client-side validation', () => {
  it('rejects a non-image file without touching storage', async () => {
    const file = { type: 'text/plain', size: 10, name: 'notes.txt' }

    await expect(uploadEventPhoto('event-1', file)).rejects.toThrow('Nahrát lze jen obrázky JPG, PNG, WebP nebo GIF.')
    expect(supabase.storage.from).not.toHaveBeenCalled()
  })

  it('rejects a file over the size limit without touching storage', async () => {
    const file = { type: 'image/jpeg', size: 11 * 1024 * 1024, name: 'huge.jpg' }

    await expect(uploadEventPhoto('event-1', file)).rejects.toThrow('limit je 10 MB')
    expect(supabase.storage.from).not.toHaveBeenCalled()
  })
})

describe('moderateAttendee/claimSignupItem numeric ids', () => {
  it('moderateAttendee coerces attendeeId to a number', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await moderateAttendee('event-1', '7', { token: 'tok', status: 'excused_accepted' })

    expect(supabase.rpc).toHaveBeenCalledWith('moderate_attendee', {
      p_event_id: 'event-1',
      p_attendee_id: 7,
      p_token: 'tok',
      p_status: 'excused_accepted',
    })
  })

  it('claimSignupItem defaults seats to 1', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await claimSignupItem(5, 'Alice')

    expect(supabase.rpc).toHaveBeenCalledWith('claim_signup_item', {
      p_item_id: 5,
      p_attendee_name: 'Alice',
      p_seats: 1,
    })
  })
})

describe('uploadEventPhoto file name', () => {
  it('names the file after the SHA-256 hash of the photo’s delete token', async () => {
    const upload = jest.fn().mockResolvedValue({ error: null })
    storageFrom.mockReturnValue({ upload })
    const file = { type: 'image/jpeg', size: 1024, name: 'party.JPG' }

    const storagePath = await uploadEventPhoto('event-1', file, 'delete-token-1')

    const expectedHash = createHash('sha256').update('delete-token-1').digest('hex')
    expect(storagePath).toBe(`event-1/${expectedHash}.jpg`)
    expect(upload).toHaveBeenCalledWith(storagePath, file)
  })
})

describe('photo likes and comments', () => {
  it('reads likes and comments through event-scoped RPCs', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await getEventPhotoLikes('event-1')
    await getEventPhotoComments('event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_photo_likes', { p_event_id: 'event-1' })
    expect(supabase.rpc).toHaveBeenCalledWith('get_event_photo_comments', { p_event_id: 'event-1' })
  })

  it('toggles a like under the given name', async () => {
    rpc.mockResolvedValue({ data: { success: true, liked: true }, error: null })

    await expect(toggleEventPhotoLike('event-1', 12, 'Alice')).resolves.toEqual({ success: true, liked: true })
    expect(supabase.rpc).toHaveBeenCalledWith('toggle_event_photo_like', { p_event_id: 'event-1', p_photo_id: 12, p_liker_name: 'Alice' })
  })

  it('returns the saved comment row', async () => {
    const row = { id: 3, photo_id: 12, author_name: 'Alice', message: 'Hezká', created_at: 'now' }
    rpc.mockResolvedValue({ data: [row], error: null })

    await expect(addEventPhotoComment('event-1', 12, 'Alice', 'Hezká')).resolves.toEqual(row)
    expect(supabase.rpc).toHaveBeenCalledWith('add_event_photo_comment', {
      p_event_id: 'event-1',
      p_photo_id: 12,
      p_author_name: 'Alice',
      p_message: 'Hezká',
    })
  })

  it('deletes a comment with the organizer token', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await deleteEventPhotoComment('event-1', 'organizer-token', 3)

    expect(supabase.rpc).toHaveBeenCalledWith('delete_event_photo_comment', { p_event_id: 'event-1', p_token: 'organizer-token', p_comment_id: 3 })
  })
})

describe('push reminders per event', () => {
  it('turns reminders off only for the given event', async () => {
    rpc.mockResolvedValue({ data: { success: true }, error: null })

    await unregisterPushSubscription('https://push.example/endpoint-1', 'event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('unregister_push_subscription', {
      p_endpoint: 'https://push.example/endpoint-1',
      p_event_id: 'event-1',
    })
  })

  it('asks the server whether this browser has reminders on for the event', async () => {
    rpc.mockResolvedValue({ data: true, error: null })

    await expect(isPushSubscribed('event-1', 'https://push.example/endpoint-1')).resolves.toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('is_push_subscribed', { p_event_id: 'event-1', p_endpoint: 'https://push.example/endpoint-1' })
  })
})
