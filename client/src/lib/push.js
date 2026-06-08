const APP_BASE_PATH = import.meta.env.BASE_URL || '/'

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
