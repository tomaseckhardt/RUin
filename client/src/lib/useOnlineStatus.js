import { useSyncExternalStore } from 'react'

function subscribe(onChange) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)

  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

// Tracks browser-level connectivity (navigator.onLine plus the window
// "online"/"offline" events). This is a simple, best-effort signal - it can't
// tell apart "no network interface" from "network interface up but the
// internet/Supabase is unreachable" - but it's enough to show a "you're
// offline" banner and to know when it's worth replaying queued requests.
export function useOnlineStatus() {
  return useSyncExternalStore(subscribe, () => navigator.onLine)
}
