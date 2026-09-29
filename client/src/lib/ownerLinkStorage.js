import { readStoredValue, removeStoredValue, writeStoredValue } from './browserStorage.js'

const OWNER_IDENTITY_KEY = 'ruin-owner-identity'

function isValidOwnerIdentity(value) {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof value.ownerId === 'string' &&
    value.ownerId.trim() !== '' &&
    typeof value.token === 'string' &&
    value.token.trim() !== ''
  )
}

export function getSavedOwner() {
  const raw = readStoredValue(OWNER_IDENTITY_KEY)

  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)

    return isValidOwnerIdentity(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveOwnerIdentity(ownerId, token) {
  if (typeof ownerId !== 'string' || ownerId.trim() === '' || typeof token !== 'string' || token.trim() === '') {
    return
  }

  writeStoredValue(OWNER_IDENTITY_KEY, JSON.stringify({ ownerId, token }))
}

export function clearSavedOwnerIdentity() {
  removeStoredValue(OWNER_IDENTITY_KEY)
}
