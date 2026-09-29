// localStorage access that never throws. Even reading window.localStorage
// throws a SecurityError when site data is blocked (or in a sandboxed
// iframe), so every access stays inside a try; callers get "nothing saved".

export function readStoredValue(key) {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStoredValue(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

export function removeStoredValue(key) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore storage failures in restricted browser environments.
  }
}

// A JSON object saved under one key, e.g. tokens keyed by event id.
export function readStoredMap(key) {
  const raw = readStoredValue(key)

  if (!raw) {
    return {}
  }

  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function writeStoredMap(key, map) {
  writeStoredValue(key, JSON.stringify(map))
}

// Sets one entry; when that adds a new one past maxEntries, the oldest
// entries are dropped.
export function saveStoredMapEntry(key, entryKey, value, maxEntries) {
  const map = readStoredMap(key)
  const isNewEntry = !(entryKey in map)
  map[entryKey] = value

  if (isNewEntry) {
    const keys = Object.keys(map)

    while (keys.length > maxEntries) {
      delete map[keys.shift()]
    }
  }

  writeStoredMap(key, map)
}

export function removeStoredMapEntry(key, entryKey) {
  const map = readStoredMap(key)

  if (!(entryKey in map)) {
    return
  }

  delete map[entryKey]
  writeStoredMap(key, map)
}
