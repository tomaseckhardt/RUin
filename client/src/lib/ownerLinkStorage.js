import { readStoredMap, removeStoredValue, writeStoredMap } from './browserStorage.js'

const OWNER_IDENTITY_KEY = 'ruin-owner-identity'

function isValidOwnerIdentity(value) {
  return typeof value.ownerId === 'string' && value.ownerId.trim() !== '' && typeof value.token === 'string' && value.token.trim() !== ''
}

export function getSavedOwner() {
  const owner = readStoredMap(OWNER_IDENTITY_KEY)
  return isValidOwnerIdentity(owner) ? owner : null
}

export function saveOwnerIdentity(ownerId, token) {
  if (typeof ownerId !== 'string' || ownerId.trim() === '' || typeof token !== 'string' || token.trim() === '') {
    return
  }

  writeStoredMap(OWNER_IDENTITY_KEY, { ownerId, token })
}

export function clearSavedOwnerIdentity() {
  removeStoredValue(OWNER_IDENTITY_KEY)
}
