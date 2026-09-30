import { getFilledInvitees, mergeInvitees } from '../../src/lib/invitees.js'
import { normalizeName } from '../../src/lib/normalizeName.js'
import { getFilledSignupPrefillItems } from '../../src/lib/signupPrefillItems.js'

describe('normalizeName', () => {
  it('trims and lowercases with Czech rules, and treats a missing value as empty', () => {
    expect(normalizeName('  ŠTĚPÁN Čech ')).toBe('štěpán čech')
    expect(normalizeName(null)).toBe('')
    expect(normalizeName(undefined)).toBe('')
  })
})

describe('getFilledInvitees', () => {
  it('trims the fields, drops the key and skips rows without a name', () => {
    const rows = [
      { key: 'a', name: '  Alice ', phone: ' +420 777 000 001 ' },
      { key: 'b', name: '   ', phone: '+420 777 000 002' },
      { key: 'c', name: 'Bob', phone: undefined },
    ]

    expect(getFilledInvitees(rows)).toEqual([
      { name: 'Alice', phone: '+420 777 000 001' },
      { name: 'Bob', phone: '' },
    ])
  })
})

describe('mergeInvitees', () => {
  const existing = [
    { key: 'a', name: 'Alice', phone: '+420 777 000 001' },
    { key: 'b', name: 'Bob', phone: '' },
  ]

  it('skips members already listed by phone, or by name when there is no phone', () => {
    const merged = mergeInvitees(existing, [
      { name: 'Alice Nová', phone: '+420 777 000 001' },
      { name: 'BOB', phone: '' },
      { name: 'Cyril', phone: '+420 777 000 003' },
    ])

    expect(merged.map((invitee) => invitee.name)).toEqual(['Alice', 'Bob', 'Cyril'])
    expect(merged[2].key).toEqual(expect.any(String))
  })

  it('adds a member only once when the same group is picked twice, and skips empty ones', () => {
    const group = [
      { name: 'Cyril', phone: '+420 777 000 003' },
      { name: '', phone: '' },
    ]

    const merged = mergeInvitees(mergeInvitees(existing, group), group)

    expect(merged.map((invitee) => invitee.name)).toEqual(['Alice', 'Bob', 'Cyril'])
  })
})

describe('getFilledSignupPrefillItems', () => {
  it('trims, skips rows without a label and clamps the quantity to 1-20', () => {
    const rows = [
      { key: 'a', label: ' Pivo ', personName: ' Petr ', quantity: 50 },
      { key: 'b', label: 'Chleba', personName: '', quantity: 0 },
      { key: 'c', label: 'Auto', personName: undefined, quantity: 'abc' },
      { key: 'd', label: '  ', personName: 'Jana', quantity: 3 },
      { key: 'e', label: 'Deka', personName: 'Jana', quantity: '4' },
    ]

    expect(getFilledSignupPrefillItems(rows)).toEqual([
      { label: 'Pivo', personName: 'Petr', quantity: 20 },
      { label: 'Chleba', personName: '', quantity: 1 },
      { label: 'Auto', personName: '', quantity: 1 },
      { label: 'Deka', personName: 'Jana', quantity: 4 },
    ])
  })
})
