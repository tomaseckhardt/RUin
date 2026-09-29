// Delete tokens for photos uploaded from this browser, keyed by the photo's
// storage path. The photo's file is named after the SHA-256 hash of its token
// and the server keeps only that hash (see record_event_photo in
// all-phases.sql), so this is the only copy: a photo uploaded
// elsewhere, or before the tokens existed, can only be deleted by the
// organizer.
import { readStoredMap, removeStoredMapEntry, saveStoredMapEntry } from './browserStorage.js'

const PHOTO_DELETE_TOKENS_KEY = 'ruin-photo-delete-tokens'
const MAX_SAVED_PHOTO_DELETE_TOKENS = 200

export async function hashPhotoDeleteToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

// All saved tokens at once, so a gallery reads storage once per render
// instead of once per photo.
export function getPhotoDeleteTokens() {
  return readStoredMap(PHOTO_DELETE_TOKENS_KEY)
}

export function savePhotoDeleteToken(storagePath, token) {
  if (typeof storagePath !== 'string' || storagePath === '' || typeof token !== 'string' || token === '') {
    return
  }

  saveStoredMapEntry(PHOTO_DELETE_TOKENS_KEY, storagePath, token, MAX_SAVED_PHOTO_DELETE_TOKENS)
}

export function clearPhotoDeleteToken(storagePath) {
  removeStoredMapEntry(PHOTO_DELETE_TOKENS_KEY, storagePath)
}
