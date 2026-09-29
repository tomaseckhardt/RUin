import { readStoredMap, readStoredValue, saveStoredMapEntry, writeStoredMap } from '../../src/lib/browserStorage.js'
import { getPhotoDeleteTokens, savePhotoDeleteToken } from '../../src/lib/photoDeleteTokens.js'
import { getSavedOrganizerToken, saveOrganizerToken } from '../../src/lib/organizerLinkStorage.js'

const TEST_KEY = 'ruin-test-map'

afterEach(() => {
  window.localStorage.removeItem(TEST_KEY)
  window.localStorage.removeItem('ruin-photo-delete-tokens')
})

describe('browserStorage', () => {
  it('drops the oldest entries once a new one goes past the limit', () => {
    writeStoredMap(TEST_KEY, { a: '1', b: '2' })

    saveStoredMapEntry(TEST_KEY, 'c', '3', 2)

    expect(readStoredMap(TEST_KEY)).toEqual({ b: '2', c: '3' })
  })

  it('keeps every entry when an existing one is only updated', () => {
    writeStoredMap(TEST_KEY, { a: '1', b: '2' })

    saveStoredMapEntry(TEST_KEY, 'a', 'updated', 2)

    expect(readStoredMap(TEST_KEY)).toEqual({ a: 'updated', b: '2' })
  })

  it('treats a corrupt or non-object value as an empty map', () => {
    window.localStorage.setItem(TEST_KEY, '{not json')
    expect(readStoredMap(TEST_KEY)).toEqual({})

    window.localStorage.setItem(TEST_KEY, '["a"]')
    expect(readStoredMap(TEST_KEY)).toEqual({})
  })

  it('reports nothing saved instead of throwing when the browser blocks storage', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError')
      },
    })

    try {
      expect(readStoredValue(TEST_KEY)).toBeNull()
      expect(() => savePhotoDeleteToken('event-1/photo.jpg', 'delete-token-1')).not.toThrow()
      expect(getPhotoDeleteTokens()).toEqual({})
      expect(() => saveOrganizerToken('event-1', 'organizer-token')).not.toThrow()
      expect(getSavedOrganizerToken('event-1')).toBe('')
    } finally {
      if (descriptor) {
        Object.defineProperty(window, 'localStorage', descriptor)
      } else {
        delete window.localStorage
      }
    }
  })
})
