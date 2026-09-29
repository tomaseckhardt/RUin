import { readStoredMap, removeStoredMapEntry, saveStoredMapEntry } from './browserStorage.js'

const ORGANIZER_TOKENS_KEY = 'ruin-organizer-tokens'
const MAX_SAVED_ORGANIZER_TOKENS = 30

export function getSavedOrganizerToken(eventId) {
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    return ''
  }

  const token = readStoredMap(ORGANIZER_TOKENS_KEY)[eventId]

  return typeof token === 'string' ? token : ''
}

export function saveOrganizerToken(eventId, token) {
  if (typeof eventId !== 'string' || eventId.trim() === '' || typeof token !== 'string' || token.trim() === '') {
    return
  }

  saveStoredMapEntry(ORGANIZER_TOKENS_KEY, eventId, token, MAX_SAVED_ORGANIZER_TOKENS)
}

export function clearSavedOrganizerToken(eventId) {
  if (typeof eventId !== 'string' || eventId.trim() === '') {
    return
  }

  removeStoredMapEntry(ORGANIZER_TOKENS_KEY, eventId)
}

export function getSavedOrganizerEventIds() {
  const map = readStoredMap(ORGANIZER_TOKENS_KEY)

  return Object.keys(map).filter((key) => typeof key === 'string' && key.trim() !== '')
}
