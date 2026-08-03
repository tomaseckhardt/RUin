const OWNER_IDENTITY_KEY = 'ruin-owner-identity'

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

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
  if (!canUseStorage()) {
    return null
  }

  try {
    const raw = window.localStorage.getItem(OWNER_IDENTITY_KEY)

    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw)

    return isValidOwnerIdentity(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function saveOwnerIdentity(ownerId, token) {
  if (!canUseStorage() || typeof ownerId !== 'string' || ownerId.trim() === '' || typeof token !== 'string' || token.trim() === '') {
    return
  }

  try {
    window.localStorage.setItem(OWNER_IDENTITY_KEY, JSON.stringify({ ownerId, token }))
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function clearSavedOwnerIdentity() {
  if (!canUseStorage()) {
    return
  }

  try {
    window.localStorage.removeItem(OWNER_IDENTITY_KEY)
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}
