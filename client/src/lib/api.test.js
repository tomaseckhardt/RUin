import { supabase } from './supabase.js'
import {
  claimSignupItem,
  createEvent,
  getChatReactions,
  getEventChatMessages,
  getEventPhotos,
  getEventStops,
  getSignupItems,
  moderateAttendee,
  sendEventChatMessage,
  submitRsvp,
  unclaimSignupItem,
  uploadEventPhoto,
} from './api.js'

jest.mock('./supabase.js', () => ({
  supabase: {
    rpc: jest.fn(),
    storage: {
      from: jest.fn(),
    },
  },
}))

beforeEach(() => {
  supabase.rpc.mockReset()
  supabase.storage.from.mockReset()
})

describe('callRpc error handling (via submitRsvp)', () => {
  it('resolves with the RPC data on success', async () => {
    supabase.rpc.mockResolvedValue({ data: { success: true }, error: null })

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
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'Vyplň svoje jméno.' } })

    await expect(submitRsvp('event-1', { name: '', status: 'confirmed' })).rejects.toThrow(
      'Vyplň svoje jméno.',
    )
  })

  it('falls back to the generic message when the error has none', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: {} })

    await expect(createEvent({ name: 'x' })).rejects.toThrow('Akci se nepodařilo vytvořit.')
  })
})

describe('unclaimSignupItem', () => {
  it('sends the same name as both the target and the requester', async () => {
    supabase.rpc.mockResolvedValue({ data: { success: true }, error: null })

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
    supabase.rpc.mockResolvedValue({
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
    supabase.rpc.mockResolvedValue({ data: [{ id: 1, message_id: 9 }], error: null })

    await getChatReactions('event-1', [9])

    expect(supabase.rpc).toHaveBeenCalledWith('get_chat_reactions', {
      p_event_id: 'event-1',
      p_message_ids: [9],
    })
  })

  it('getSignupItems calls get_event_signup_items', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null })

    await getSignupItems('event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_signup_items', { p_event_id: 'event-1' })
  })

  it('getEventStops calls get_event_stops', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null })

    await getEventStops('event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_stops', { p_event_id: 'event-1' })
  })

  it('getEventPhotos calls get_event_photos', async () => {
    supabase.rpc.mockResolvedValue({ data: [], error: null })

    await getEventPhotos('event-1')

    expect(supabase.rpc).toHaveBeenCalledWith('get_event_photos', { p_event_id: 'event-1' })
  })
})

describe('sendEventChatMessage', () => {
  it('rejects an empty message without calling supabase', async () => {
    await expect(sendEventChatMessage('event-1', 'Alice', '   ')).rejects.toThrow(
      'Napiš zprávu do chatu.',
    )
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('rejects a missing sender name without calling supabase', async () => {
    await expect(sendEventChatMessage('event-1', '  ', 'Ahoj')).rejects.toThrow(
      'Pro odeslání zprávy vyplň svoje jméno.',
    )
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('sends the trimmed values and returns the first returned row', async () => {
    supabase.rpc.mockResolvedValue({
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

    await expect(uploadEventPhoto('event-1', file)).rejects.toThrow('Nahrát lze jen obrázky.')
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
    supabase.rpc.mockResolvedValue({ data: { success: true }, error: null })

    await moderateAttendee('event-1', '7', { token: 'tok', status: 'excused_accepted' })

    expect(supabase.rpc).toHaveBeenCalledWith('moderate_attendee', {
      p_event_id: 'event-1',
      p_attendee_id: 7,
      p_token: 'tok',
      p_status: 'excused_accepted',
    })
  })

  it('claimSignupItem defaults seats to 1', async () => {
    supabase.rpc.mockResolvedValue({ data: { success: true }, error: null })

    await claimSignupItem(5, 'Alice')

    expect(supabase.rpc).toHaveBeenCalledWith('claim_signup_item', {
      p_item_id: 5,
      p_attendee_name: 'Alice',
      p_seats: 1,
    })
  })
})
