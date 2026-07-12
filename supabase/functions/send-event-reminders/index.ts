// Scheduled Edge Function: sends Web Push reminders 24h and 1h before an event.
// Deploy with: supabase functions deploy send-event-reminders --no-verify-jwt
// Required secrets (supabase secrets set ...):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com)
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are provided automatically by the runtime.
// Trigger this function on a schedule (every 15-30 min) via pg_cron+pg_net or the
// Supabase dashboard's Cron Jobs feature — see supabase/sql/SQL-phases/phase-10-push-reminders.sql.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
const vapidSubject = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com'

if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
  console.error('Missing required secrets (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY).')
}

webpush.setVapidDetails(vapidSubject, vapidPublicKey ?? '', vapidPrivateKey ?? '')

const supabase = createClient(supabaseUrl ?? '', serviceRoleKey ?? '')

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

Deno.serve(async () => {
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured: missing secrets.' }), { status: 500 })
  }

  const { data: reminders, error: remindersError } = await supabase.rpc('get_pending_event_reminders')

  if (remindersError) {
    return new Response(JSON.stringify({ error: remindersError.message }), { status: 500 })
  }

  let sentCount = 0
  let failedCount = 0

  for (const reminder of reminders ?? []) {
    const { data: subscriptions, error: subscriptionsError } = await supabase.rpc(
      'get_push_subscriptions_for_event',
      { p_event_id: reminder.event_id },
    )

    if (subscriptionsError) {
      console.error(`Failed to load subscriptions for event ${reminder.event_id}:`, subscriptionsError.message)
      continue
    }

    const payload = JSON.stringify(buildNotificationPayload(reminder))

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
          await supabase.rpc('delete_push_subscription_by_endpoint', { p_endpoint: subscription.endpoint })
        } else {
          console.error(`Push failed for endpoint ${subscription.endpoint}:`, sendError?.message ?? sendError)
        }
      }
    }

    await supabase.rpc('mark_event_reminder_sent', {
      p_event_id: reminder.event_id,
      p_reminder_type: reminder.reminder_type,
    })
  }

  return new Response(
    JSON.stringify({ processedReminders: reminders?.length ?? 0, sentCount, failedCount }),
    { headers: { 'Content-Type': 'application/json' } },
  )
})
