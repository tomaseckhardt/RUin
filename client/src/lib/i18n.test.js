/* global __dirname */
import fs from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import cs from '../locales/cs.js'
import en from '../locales/en.js'
import enServerMessages from '../locales/serverMessages.en.js'
import { formatDateTime } from './format.js'
import { detectLocale, getLocale, localizeServerMessage, setLocale, t } from './i18n.js'

const SQL_PATH = path.resolve(__dirname, '../../../supabase/sql/all-phases.sql')

function isLeaf(value) {
  return typeof value === 'string' || Array.isArray(value) || typeof value?.other === 'string'
}

function collectLeaves(node, prefix = '', leaves = new Map()) {
  for (const [key, value] of Object.entries(node)) {
    const fullKey = prefix ? `${prefix}.${key}` : key

    if (isLeaf(value)) {
      leaves.set(fullKey, value)
    } else {
      collectLeaves(value, fullKey, leaves)
    }
  }

  return leaves
}

// Placeholders a leaf uses, across all plural forms / array items.
function placeholdersOf(leaf) {
  const texts = typeof leaf === 'string' ? [leaf] : Object.values(leaf)
  return [...new Set(texts.flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1])))].sort()
}

afterEach(() => {
  setLocale('cs')
})

describe('locale dictionaries', () => {
  const csLeaves = collectLeaves(cs)
  const enLeaves = collectLeaves(en)

  it('have exactly the same keys', () => {
    expect([...enLeaves.keys()].sort()).toEqual([...csLeaves.keys()].sort())
  })

  it('use the same placeholders and shape for every key', () => {
    for (const [key, csLeaf] of csLeaves) {
      const enLeaf = enLeaves.get(key)

      if (Array.isArray(csLeaf)) {
        expect({ key, length: enLeaf.length }).toEqual({ key, length: csLeaf.length })
        csLeaf.forEach((item, index) => {
          expect({ key, index, placeholders: placeholdersOf(enLeaf[index]) }).toEqual({ key, index, placeholders: placeholdersOf(item) })
        })
      } else {
        expect({ key, placeholders: placeholdersOf(enLeaf) }).toEqual({ key, placeholders: placeholdersOf(csLeaf) })
      }
    }
  })
})

describe('database error messages', () => {
  const raisedMessages = new Set(
    [...fs.readFileSync(SQL_PATH, 'utf8').matchAll(/raise exception '([^']*)'/g)].map((match) => match[1]),
  )

  it('has an English translation for every message all-phases.sql raises', () => {
    const untranslated = [...raisedMessages].filter((message) => !(message in enServerMessages))
    expect(untranslated).toEqual([])
  })

  it('has no translations for messages the database no longer raises', () => {
    const stale = Object.keys(enServerMessages).filter((message) => !raisedMessages.has(message))
    expect(stale).toEqual([])
  })

  it('translates known messages only while the UI is in English', () => {
    expect(localizeServerMessage('Akce neexistuje.')).toBe('Akce neexistuje.')

    setLocale('en')

    expect(localizeServerMessage('Akce neexistuje.')).toBe('This event doesn’t exist.')
    expect(localizeServerMessage('TypeError: Failed to fetch')).toBe('TypeError: Failed to fetch')
  })
})

describe('t', () => {
  it('reads the active dictionary and fills placeholders', () => {
    expect(t('createEvent.submit')).toBe('Vytvořit akci')
    expect(t('attendees.summary', { confirmed: 3, excused: 1 })).toBe('3 přijde · 1 se omluvili')

    setLocale('en')

    expect(t('createEvent.submit')).toBe('Create event')
    expect(t('attendees.summary', { confirmed: 3, excused: 1 })).toBe('3 coming · 1 excused')
  })

  it('picks the plural form from params.count', () => {
    setLocale('en')

    expect(t('poll.votes', { count: 1 })).toBe('1 vote')
    expect(t('poll.votes', { count: 2 })).toBe('2 votes')
    expect(t('common.charactersLeft', { count: 1 })).toBe('1 character left')
  })

  it('falls back to `other` for a plural category the entry does not list', () => {
    // Czech PluralRules puts 2 in "few", which poll.votes doesn't define.
    expect(t('poll.votes', { count: 2 })).toBe('2 hlasů')
    expect(t('poll.votes', { count: 1 })).toBe('1 hlas')
  })

  it('returns the key itself for an unknown key', () => {
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('returns renderable nodes when a placeholder is a React element', () => {
    setLocale('en')

    render(<p>{t('poll.creatingFor', { option: <strong>Friday · Prague</strong> })}</p>)

    expect(screen.getByText('Friday · Prague').tagName).toBe('STRONG')
    expect(screen.getByText(/You’re creating the event for/)).toBeInTheDocument()
  })
})

describe('setLocale', () => {
  it('updates the document language and remembers the choice', () => {
    setLocale('en')

    expect(getLocale()).toBe('en')
    expect(document.documentElement.lang).toBe('en')
    expect(window.localStorage.getItem('ruin-locale')).toBe('en')
  })

  it('ignores unsupported locales', () => {
    setLocale('de')

    expect(getLocale()).toBe('cs')
  })

  it('switches date formatting along with the text', () => {
    expect(formatDateTime('2026-10-02T18:00')).toMatch(/října/)

    setLocale('en')

    expect(formatDateTime('2026-10-02T18:00')).toMatch(/October/)
    expect(formatDateTime('2026-10-02T18:00')).toMatch(/18:00/)
  })
})

describe('detectLocale', () => {
  it('maps Czech and Slovak browsers to Czech', () => {
    expect(detectLocale(['cs-CZ'])).toBe('cs')
    expect(detectLocale(['sk'])).toBe('cs')
  })

  it('uses the first supported language in preference order', () => {
    expect(detectLocale(['de-DE', 'cs', 'en'])).toBe('cs')
    expect(detectLocale(['de-DE', 'en-US', 'cs'])).toBe('en')
  })

  it('falls back to English for everything else', () => {
    expect(detectLocale(['de-DE', 'fr'])).toBe('en')
    expect(detectLocale([])).toBe('en')
  })
})
