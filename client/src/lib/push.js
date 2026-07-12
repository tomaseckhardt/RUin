const APP_BASE_PATH = import.meta.env.BASE_URL || '/'
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim() || ''

function isPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export async function ensurePushServiceWorker() {
  if (!isPushSupported()) {
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

export async function subscribeToEventReminders() {
  if (!isReminderSupported()) {
    throw new Error('Tenhle prohlížeč nepodporuje připomínky, nebo appka nemá nastavený VAPID klíč.')
  }

  const permission = await Notification.requestPermission()

  if (permission !== 'granted') {
    throw new Error('Bez povolení notifikací ti připomínku poslat nemůžeme.')
  }

  const registration = await ensurePushServiceWorker()

  if (!registration) {
    throw new Error('Service worker se nepodařilo zaregistrovat.')
  }

  const existing = await registration.pushManager.getSubscription()

  const subscription = existing || (await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  }))

  const json = subscription.toJSON()

  return {
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  }
}

export async function unsubscribeFromEventReminders() {
  if (!isPushSupported()) {
    return null
  }

  const registration = await navigator.serviceWorker.getRegistration(APP_BASE_PATH)
  const subscription = await registration?.pushManager.getSubscription()

  if (!subscription) {
    return null
  }

  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return endpoint
}
