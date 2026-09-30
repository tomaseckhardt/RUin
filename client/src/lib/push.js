import { isPushSubscribed, registerPushSubscription, unregisterPushSubscription } from './api.js'
import { readStoredMap, saveStoredMapEntry } from './browserStorage.js'
import { t } from './i18n.js'

const APP_BASE_PATH = import.meta.env.BASE_URL || '/'
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() || ''
// Events this browser turned reminders on for. The server can't list an
// endpoint's events, and a VAPID key change forces a new subscription (so a
// new endpoint) - this is how the old endpoint's events move over to it.
// is_push_subscribed weeds out the ones turned off since.
const REMINDER_EVENTS_KEY = 'ruin-push-reminder-events'
const MAX_SAVED_REMINDER_EVENTS = 100

function isServiceWorkerSupported() {
  return 'serviceWorker' in navigator
}

function isPushSupported() {
  return isServiceWorkerSupported() && 'PushManager' in window && 'Notification' in window
}

export async function ensurePushServiceWorker() {
  // The same service worker also drives offline app-shell caching, so it
  // should register whenever the browser supports service workers at all -
  // push support (checked separately below) is only required for the actual
  // push-subscription flow, not for registering the worker in the first
  // place.
  if (!isServiceWorkerSupported()) {
    return null
  }

  return navigator.serviceWorker.register(`${APP_BASE_PATH}sw.js`, { scope: APP_BASE_PATH })
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)))
}

export function isReminderSupported() {
  return isPushSupported() && Boolean(VAPID_PUBLIC_KEY)
}

function subscriptionKeyMatches(subscription, applicationServerKey) {
  const existingKey = subscription.options?.applicationServerKey

  if (!existingKey) {
    // Browser doesn't expose the key it subscribed with - assume it still
    // matches rather than force everyone through an unnecessary resubscribe.
    return true
  }

  const existingBytes = new Uint8Array(existingKey)

  if (existingBytes.length !== applicationServerKey.length) {
    return false
  }

  return existingBytes.every((byte, index) => byte === applicationServerKey[index])
}

// Pass the event the subscription is for, so a later key change can move it.
export async function subscribeToEventReminders(eventId) {
  if (!isReminderSupported()) {
    throw new Error(t('push.unsupported'))
  }

  const permission = await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error(t('push.permissionDenied'))
  }

  const registration = await ensurePushServiceWorker()

  if (!registration) {
    throw new Error(t('push.registrationFailed'))
  }

  const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
  let subscription = await registration.pushManager.getSubscription()
  let oldEndpoint = null
  let movedEventIds = []

  if (subscription && !subscriptionKeyMatches(subscription, applicationServerKey)) {
    oldEndpoint = subscription.endpoint
    const savedEventIds = Object.keys(readStoredMap(REMINDER_EVENTS_KEY)).filter((savedId) => savedId !== eventId)
    const checks = await Promise.allSettled(savedEventIds.map((savedId) => isPushSubscribed(savedId, oldEndpoint)))
    movedEventIds = savedEventIds.filter((_, index) => checks[index].status === 'fulfilled' && checks[index].value)
    await subscription.unsubscribe()
    subscription = null
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    })
  }

  const json = subscription.toJSON()
  const result = {
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  }

  if (eventId) {
    saveStoredMapEntry(REMINDER_EVENTS_KEY, eventId, true, MAX_SAVED_REMINDER_EVENTS)
  }

  if (oldEndpoint) {
    // Best effort: an event deleted in the meantime just fails.
    await Promise.allSettled(movedEventIds.map((movedId) => registerPushSubscription(movedId, result)))
    await unregisterPushSubscription(oldEndpoint).catch(() => {})
  }

  return result
}

// The browser's push endpoint, or null without a subscription. All events
// share it (the server keeps one row per event and endpoint), so turning
// reminders off for one event leaves the subscription itself alone.
export async function getPushEndpoint() {
  if (!isPushSupported()) {
    return null
  }

  const registration = await navigator.serviceWorker.getRegistration(APP_BASE_PATH)
  const subscription = await registration?.pushManager.getSubscription()

  return subscription?.endpoint ?? null
}
