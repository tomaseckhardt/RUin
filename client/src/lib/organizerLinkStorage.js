const ORGANIZER_PATH_KEY = 'ruin-organizer-path'

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function isValidOrganizerPath(path) {
  if (typeof path !== 'string') {
    return false
  }

  return /^\/event\/[^/?#]+\/manage\?token=.+$/.test(path)
}

export function getSavedOrganizerPath() {
  if (!canUseStorage()) {
    return ''
  }

  try {
    const value = window.localStorage.getItem(ORGANIZER_PATH_KEY) || ''

    if (!isValidOrganizerPath(value)) {
      return ''
    }

    return value
  } catch {
    return ''
  }
}

export function saveOrganizerPath(path) {
  if (!canUseStorage() || !isValidOrganizerPath(path)) {
    return
  }

  try {
    window.localStorage.setItem(ORGANIZER_PATH_KEY, path)
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function clearSavedOrganizerPath() {
  if (!canUseStorage()) {
    return
  }

  try {
    window.localStorage.removeItem(ORGANIZER_PATH_KEY)
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}
