const ORGANIZER_PATH_KEY = 'ruin-organizer-path'
const ORGANIZER_TOKENS_KEY = 'ruin-organizer-tokens'
const MAX_SAVED_ORGANIZER_TOKENS = 30

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

function readOrganizerTokensMap() {
  if (!canUseStorage()) {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(ORGANIZER_TOKENS_KEY)

    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    return parsed
  } catch {
    return {}
  }
}

function writeOrganizerTokensMap(map) {
  if (!canUseStorage()) {
    return
  }

  try {
    window.localStorage.setItem(ORGANIZER_TOKENS_KEY, JSON.stringify(map))
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function getSavedOrganizerToken(eventId) {
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    return ''
  }

  const map = readOrganizerTokensMap()
  const token = map[eventId]

  return typeof token === 'string' ? token : ''
}

export function saveOrganizerToken(eventId, token) {
  if (typeof eventId !== 'string' || eventId.trim() === '' || typeof token !== 'string' || token.trim() === '') {
    return
  }

  const map = readOrganizerTokensMap()
  const isNewEntry = !(eventId in map)
  map[eventId] = token

  if (isNewEntry) {
    const keys = Object.keys(map)

    while (keys.length > MAX_SAVED_ORGANIZER_TOKENS) {
      delete map[keys.shift()]
    }
  }

  writeOrganizerTokensMap(map)
}

export function clearSavedOrganizerToken(eventId) {
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    return
  }

  const map = readOrganizerTokensMap()

  if (!(eventId in map)) {
    return
  }

  delete map[eventId]
  writeOrganizerTokensMap(map)
}

export function getSavedOrganizerEventIds() {
  const map = readOrganizerTokensMap()

  return Object.keys(map)
    .filter((key) => typeof key === 'string' && key.trim() !== '')
}
