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

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'

const hasRequiredSecrets = Boolean(supabaseUrl && serviceRoleKey && vapidPublicKey && vapidPrivateKey)

if (!hasRequiredSecrets) {
  console.error('Missing required secrets (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).')
}

// Both of these throw synchronously on a falsy key - only call them once we
// know every secret is actually present, so a missing secret surfaces as the
// handler's "Server misconfigured" response below instead of a boot-time crash.
const supabase = hasRequiredSecrets ? createClient(supabaseUrl, serviceRoleKey) : null

if (hasRequiredSecrets) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

function buildNotificationPayload(reminder) {
  const isHourBefore = reminder.reminder_type === 'hour_before'

  return {
    title: isHourBefore ? `Za hodinu: ${reminder.name}` : `Zítra: ${reminder.name}`,
    body: isHourBefore
      ? `Akce začíná už za hodinu — ${reminder.location}`
      : `Akce je zítra v plánu — ${reminder.location}`,
    url: `#/event/${reminder.event_id}`,
    tag: `reminder-${reminder.event_id}-${reminder.reminder_type}`,
  }
}

// Sends one reminder's notification to every subscriber of its event, then
// marks the reminder as sent. Returns per-reminder sent/failed counts.
async function processReminder(reminder) {
  const { data: subscriptions, error: subscriptionsError } = await supabase.rpc(
    'get_push_subscriptions_for_event',
    { p_event_id: reminder.event_id },
  )

  if (subscriptionsError) {
    console.error(`Failed to load subscriptions for event ${reminder.event_id}:`, subscriptionsError.message)
    return { sentCount: 0, failedCount: 0 }
  }

  const payload = JSON.stringify(buildNotificationPayload(reminder))
  let sentCount = 0
  let failedCount = 0

  for (const subscription of subscriptions ?? []) {
    const pushSubscription = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    }

    try {
      await webpush.sendNotification(pushSubscription, payload)
      sentCount += 1
    } catch (sendError) {
      failedCount += 1

      if (sendError?.statusCode === 404 || sendError?.statusCode === 410) {
        const { error: deleteError } = await supabase.rpc('delete_push_subscription_by_endpoint', {
          p_endpoint: subscription.endpoint,
        })

        if (deleteError) {
          console.error(`Failed to delete dead subscription ${subscription.endpoint}:`, deleteError.message)
        }
      } else {
        console.error(`Push failed for endpoint ${subscription.endpoint}:`, sendError?.message ?? sendError)
      }
    }
  }

  const { error: markSentError } = await supabase.rpc('mark_event_reminder_sent', {
    p_event_id: reminder.event_id,
    p_reminder_type: reminder.reminder_type,
  })

  if (markSentError) {
    // Not marking this as sent means the same reminder will be re-sent on
    // the next scheduled tick (15-30 min later) - log loudly, since a
    // silent failure here means every subscriber gets paged repeatedly.
    console.error(`Failed to mark ${reminder.reminder_type} reminder sent for event ${reminder.event_id}:`, markSentError.message)
  }

  return { sentCount, failedCount }
}

Deno.serve(async (req) => {
  if (!supabase) {
    return new Response(
      JSON.stringify({ error: 'Server misconfigured: missing secrets.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  if (req.headers.get('authorization') !== `Bearer ${serviceRoleKey}`) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized.' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const { data: reminders, error: remindersError } = await supabase.rpc('get_pending_event_reminders')

  if (remindersError) {
    return new Response(
      JSON.stringify({ error: remindersError.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }

  let sentCount = 0
  let failedCount = 0

  for (const reminder of reminders ?? []) {
    const result = await processReminder(reminder)
    sentCount += result.sentCount
    failedCount += result.failedCount
  }

  return new Response(
    JSON.stringify({ processedReminders: reminders?.length ?? 0, sentCount, failedCount }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
