import { supabase } from './supabase.js'

// Uncaught errors go to the client_errors table (log_client_error in
// all-phases.sql). Production only, each message once and at most
// MAX_REPORTS per page load; reporting itself must never throw.
const MAX_REPORTS = 5
const reportedMessages = new Set()

// Organizer, owner and photo tokens travel in links (`?token=` in the hash).
function withoutTokens(text) {
  return text.replace(/token=[^&#\s]+/gi, 'token=…')
}

// Drops the query string, including the one inside the hash route.
function currentUrl() {
  return window.location.origin + window.location.pathname + window.location.hash.split('?')[0]
}

function report(error, fallbackMessage) {
  try {
    const message = String(error?.message || fallbackMessage || error || '').trim()

    if (!message || reportedMessages.has(message) || reportedMessages.size >= MAX_REPORTS) {
      return
    }

    reportedMessages.add(message)
    supabase
      .rpc('log_client_error', {
        p_message: withoutTokens(message),
        p_stack: typeof error?.stack === 'string' ? withoutTokens(error.stack) : null,
        p_url: currentUrl(),
        p_user_agent: navigator.userAgent,
      })
      .then(
        () => {},
        () => {},
      )
  } catch {
    // Best effort - a failed report is simply lost.
  }
}

export function installErrorReporting() {
  if (import.meta.env.DEV || !import.meta.env.VITE_SUPABASE_URL) {
    return
  }

  window.addEventListener('error', (event) => report(event.error, event.message))
  window.addEventListener('unhandledrejection', (event) => report(event.reason))
}
