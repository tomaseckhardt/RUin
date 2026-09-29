// Scheduled Edge Function: sends Web Push reminders 24h and 1h before an event.
//
// Each event can get two reminders - 'day_before' and 'hour_before' - tracked
// independently in event_reminders_sent so a reminder is never sent twice,
// even though this function runs on a recurring schedule and
// get_pending_event_reminders() re-queries "what's due right now" every time.
//
// Deploy with: supabase functions deploy send-event-reminders --no-verify-jwt
// Required secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically by the runtime.
// Trigger this function on a schedule (every 15-30 min) via pg_cron+pg_net or the
// Supabase dashboard's Cron Jobs feature — see supabase/sql/all-phases.sql.
//
// --no-verify-jwt means the Supabase gateway itself performs no auth check on
// this endpoint - anyone who finds the URL (trivially derivable from the
// project ref, which is public in the frontend bundle) could otherwise call
// it directly, on demand, as many times as they like. The handler below
// requires the caller to send `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`
// itself - whichever scheduler triggers this (pg_cron+pg_net or the
// dashboard's Cron Jobs UI) must be configured to send that header. See
// "Automatické připomínky před akcí" in README.md.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { errorMessage, refuseUnlessScheduler } from '../_shared/common.ts'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'

type EventReminder = {
  event_id: string
  reminder_type: 'day_before' | 'hour_before'
  name: string
  location: string
  starts_in_seconds: number
  starts_today: boolean
  starts_at_label: string
}

type PushSubscription = {
  endpoint: string
  p256dh: string
  auth: string
}

// Both of these throw synchronously on a falsy key - only call them once we
// know every secret is actually present, so a missing secret surfaces as the
// handler's "Server misconfigured" response below instead of a boot-time crash.
const supabase = supabaseUrl && serviceRoleKey && vapidPublicKey && vapidPrivateKey ? createClient(supabaseUrl, serviceRoleKey) : null

if (supabase) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
} else {
  console.error('Missing required secrets (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).')
}

// Worded by when the event really starts (starts_in_seconds, starts_today and
// starts_at_label come from get_pending_event_reminders()): a day-before
// reminder can also go out on the event's own day, and an hour-before one
// anywhere within that last hour.
function buildNotificationPayload(reminder: EventReminder) {
  const url = `#/event/${reminder.event_id}`
  const tag = `reminder-${reminder.event_id}-${reminder.reminder_type}`

  if (reminder.reminder_type === 'hour_before') {
    const minutes = Math.max(1, Math.round(reminder.starts_in_seconds / 60))

    return {
      title: `Za ${minutes} min: ${reminder.name}`,
      body: `Akce začíná v ${reminder.starts_at_label} — ${reminder.location}`,
      url,
      tag,
    }
  }

  const day = reminder.starts_today ? 'Dnes' : 'Zítra'

  return {
    title: `${day} v ${reminder.starts_at_label}: ${reminder.name}`,
    body: `Akce je ${day.toLowerCase()} v ${reminder.starts_at_label} — ${reminder.location}`,
    url,
    tag,
  }
}

// Claims one batch of endpoints for this reminder. A delivery is acknowledged
// only after push succeeds; transient failures keep their own retry state.
async function processReminder(supabase: SupabaseClient, reminder: EventReminder) {
  const { data: subscriptions, error: subscriptionsError } = await supabase.rpc('claim_event_reminder_deliveries', {
    p_event_id: reminder.event_id,
    p_reminder_type: reminder.reminder_type,
  })

  if (subscriptionsError) {
    console.error(`Failed to claim reminder deliveries for event ${reminder.event_id}:`, subscriptionsError.message)
    return { sentCount: 0, failedCount: 0 }
  }

  const payload = JSON.stringify(buildNotificationPayload(reminder))
  // The push service keeps an undelivered message for its TTL (4 weeks by
  // default); a reminder that can't reach the device before the event
  // starts is better dropped than shown afterwards.
  const pushOptions = { TTL: Math.max(60, reminder.starts_in_seconds) }
  let sentCount = 0
  let failedCount = 0

  for (const subscription of (subscriptions ?? []) as PushSubscription[]) {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }

    try {
      await webpush.sendNotification(pushSubscription, payload, pushOptions)
      sentCount += 1

      const { error: markDeliveryError } = await supabase.rpc('mark_event_reminder_delivery', {
        p_event_id: reminder.event_id,
        p_reminder_type: reminder.reminder_type,
        p_endpoint: subscription.endpoint,
        p_sent: true,
      })

      if (markDeliveryError) {
        failedCount += 1
        console.error(`Failed to acknowledge reminder for endpoint ${subscription.endpoint}:`, markDeliveryError.message)
      }
    } catch (sendError: unknown) {
      failedCount += 1
      const statusCode = (sendError as { statusCode?: unknown } | null)?.statusCode

      // 404/410: the browser dropped the subscription, so it goes for good.
      if (statusCode === 404 || statusCode === 410) {
        const { error: deleteError } = await supabase.rpc('delete_push_subscription_by_endpoint', {
          p_endpoint: subscription.endpoint,
        })

        if (!deleteError) {
          continue
        }

        console.error(`Failed to delete dead subscription ${subscription.endpoint}:`, deleteError.message)
      } else {
        console.error(`Push failed for endpoint ${subscription.endpoint}:`, errorMessage(sendError))
      }

      // Release the claim so the next run retries this endpoint.
      const { error: releaseError } = await supabase.rpc('mark_event_reminder_delivery', {
        p_event_id: reminder.event_id,
        p_reminder_type: reminder.reminder_type,
        p_endpoint: subscription.endpoint,
        p_sent: false,
      })

      if (releaseError) {
        console.error(`Failed to release reminder claim for ${subscription.endpoint}:`, releaseError.message)
      }
    }
  }

  const { error: completeError } = await supabase.rpc('complete_event_reminder', {
    p_event_id: reminder.event_id,
    p_reminder_type: reminder.reminder_type,
  })

  if (completeError) {
    console.error(`Failed to complete ${reminder.reminder_type} reminder for event ${reminder.event_id}:`, completeError.message)
  }

  return { sentCount, failedCount }
}

Deno.serve(async (req: Request) => {
  if (!supabase || !serviceRoleKey) {
    return Response.json({ error: 'Server misconfigured: missing secrets.' }, { status: 500 })
  }

  const refusal = refuseUnlessScheduler(req, serviceRoleKey)

  if (refusal) {
    return refusal
  }

  const { data: reminders, error: remindersError } = await supabase.rpc('get_pending_event_reminders')

  if (remindersError) {
    return Response.json({ error: remindersError.message }, { status: 500 })
  }

  let sentCount = 0
  let failedCount = 0

  for (const reminder of (reminders ?? []) as EventReminder[]) {
    const result = await processReminder(supabase, reminder)
    sentCount += result.sentCount
    failedCount += result.failedCount
  }

  return Response.json({ processedReminders: reminders?.length ?? 0, sentCount, failedCount })
})
