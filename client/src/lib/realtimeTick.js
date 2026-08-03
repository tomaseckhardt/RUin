import { supabase } from './supabase.js'

const DEBOUNCE_MS = 120

// Subscribes to event_realtime_ticks (a no-payload "something changed" table)
// instead of the underlying data table directly, then debounces and calls
// onTick to refetch. Used instead of subscribing to postgres_changes on
// event_chat_messages/event_chat_message_reactions/event_signup_items/
// event_signup_claims/event_stops directly, since those tables' SELECT RLS
// policies are `using (false)` - a direct subscription would never receive
// any row content. See "Realtime read hardening" in all-phases.sql.
export function subscribeToEventTicks(eventId, reasons, onTick, discriminator) {
  const reasonSet = new Set(reasons)
  let timeoutId = null

  function scheduleTick() {
    if (timeoutId) {
      return
    }

    timeoutId = setTimeout(() => {
      timeoutId = null
      onTick()
    }, DEBOUNCE_MS)
  }

  // discriminator keeps two subscribers that share an eventId AND reasons
  // (e.g. SignupBoard's "bring" and "ride" instances) on distinct channel
  // topics - reusing the same topic string would make Supabase's client
  // return the other instance's already-subscribed channel object, and
  // calling .on() on it after it's joined throws.
  const topicSuffix = discriminator ? `${discriminator}:${reasons.join(',')}` : reasons.join(',')

  const channel = supabase
    .channel(`event-ticks:${eventId}:${topicSuffix}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'event_realtime_ticks', filter: `event_id=eq.${eventId}` },
      (payload) => {
        if (reasonSet.has(payload.new?.reason)) {
          scheduleTick()
        }
      },
    )
    .subscribe()

  return () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }

    supabase.removeChannel(channel)
  }
}
