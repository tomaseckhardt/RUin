import { supabase } from './supabase.js'

const DEBOUNCE_MS = 120

// event_realtime_ticks rows carry event_key = lowercase hex SHA-256 of the
// event id instead of the id itself, so the table leaks no event ids.
async function hashEventId(eventId) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eventId))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// Subscribes to event_realtime_ticks (a no-payload "something changed" table)
// instead of the underlying data table directly, then debounces and calls
// onTick to refetch. Used instead of subscribing to postgres_changes on
// event_chat_messages/event_chat_message_reactions/event_signup_items/
// event_signup_claims/event_stops directly, since those tables' SELECT RLS
// policies are `using (false)` - a direct subscription would never receive
// any row content. See the Realtime section of all-phases.sql.
export function subscribeToEventTicks(eventId, reasons, onTick) {
  const reasonSet = new Set(reasons)
  let timeoutId = null
  let channel = null
  let isCancelled = false

  function scheduleTick() {
    if (timeoutId) {
      return
    }

    timeoutId = setTimeout(() => {
      timeoutId = null
      onTick()
    }, DEBOUNCE_MS)
  }

  hashEventId(eventId).then((eventKey) => {
    if (isCancelled) {
      return
    }

    let hasSubscribed = false

    // A unique topic per call: reusing a topic makes Supabase's client return
    // the existing channel object - one that another subscriber (or a
    // StrictMode remount) is still leaving - and live updates silently die.
    channel = supabase
      .channel(`event-ticks:${reasons.join(',')}:${crypto.randomUUID()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'event_realtime_ticks', filter: `event_key=eq.${eventKey}` }, (payload) => {
        if (reasonSet.has(payload.new?.reason)) {
          scheduleTick()
        }
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') {
          return
        }

        // Every SUBSCRIBED after the first is a reconnect: refetch whatever
        // changed while the connection was down.
        if (hasSubscribed) {
          scheduleTick()
        }

        hasSubscribed = true
      })
  })

  return () => {
    isCancelled = true

    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    if (channel) {
      supabase.removeChannel(channel)
    }
  }
}
