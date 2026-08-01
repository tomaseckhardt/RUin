import { useEffect, useState } from 'react'

function getCurrentOnlineStatus() {
  if (typeof navigator === 'undefined') {
    return true
  }

  return navigator.onLine
}

// Tracks browser-level connectivity (navigator.onLine plus the window
// "online"/"offline" events). This is a simple, best-effort signal - it can't
// tell apart "no network interface" from "network interface up but the
// internet/Supabase is unreachable" - but it's enough to show a "you're
// offline" banner and to know when it's worth replaying queued requests.
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(getCurrentOnlineStatus)

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true)
    }

    function handleOffline() {
      setIsOnline(false)
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return isOnline
}

export default useOnlineStatus
