import { Fragment, createElement, isValidElement, useSyncExternalStore } from 'react'
import cs from '../locales/cs.js'
import en from '../locales/en.js'
import enServerMessages from '../locales/serverMessages.en.js'

const LOCALE_STORAGE_KEY = 'ruin-locale'
const DICTIONARIES = { cs, en }
const SERVER_MESSAGE_TRANSLATIONS = { en: enServerMessages }
// en-GB rather than en-US: event times are Europe/Prague wall-clock time (see
// AddToCalendarButton) typed in 24h format, so AM/PM would only add noise.
const INTL_LOCALES = { cs: 'cs-CZ', en: 'en-GB' }
// Endonyms for the language toggle - always shown in their own language.
export const LOCALE_NAMES = { cs: 'Čeština', en: 'English' }
export const LOCALE_SHORT_NAMES = { cs: 'CZ', en: 'EN' }
export const SUPPORTED_LOCALES = Object.keys(DICTIONARIES)
const PLACEHOLDER_PATTERN = /\{(\w+)\}/

// Picks the UI language from the browser's preference list. Slovak readers
// get Czech (close enough, and there's no Slovak dictionary); a language the
// app doesn't have falls through to the next preference, and English is the
// fallback for everyone else.
export function detectLocale(languages) {
  for (const language of languages || []) {
    const base = String(language || '').toLowerCase().split('-')[0]

    if (base === 'cs' || base === 'sk') {
      return 'cs'
    }

    if (base === 'en') {
      return 'en'
    }
  }

  return 'en'
}

function readSavedLocale() {
  try {
    const saved = window.localStorage.getItem(LOCALE_STORAGE_KEY)
    return SUPPORTED_LOCALES.includes(saved) ? saved : null
  } catch {
    return null
  }
}

function getInitialLocale() {
  if (typeof window === 'undefined') {
    return 'cs'
  }

  const browserLanguages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return readSavedLocale() || detectLocale(browserLanguages)
}

function applyDocumentLanguage(locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale
  }
}

let currentLocale = getInitialLocale()
const listeners = new Set()

applyDocumentLanguage(currentLocale)

export function getLocale() {
  return currentLocale
}

export function getIntlLocale() {
  return INTL_LOCALES[currentLocale]
}

export function setLocale(nextLocale) {
  if (!SUPPORTED_LOCALES.includes(nextLocale) || nextLocale === currentLocale) {
    return
  }

  currentLocale = nextLocale

  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale)
  } catch {
    // Ignore storage failures in restricted browser environments.
  }

  applyDocumentLanguage(nextLocale)
  listeners.forEach((listener) => listener())
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function lookup(dictionary, key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), dictionary)
}

function isPluralEntry(entry) {
  return Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry) && typeof entry.other === 'string'
}

function interpolate(template, params) {
  const hasElementParam = Object.values(params).some((value) => isValidElement(value))

  if (!hasElementParam) {
    return template.replace(new RegExp(PLACEHOLDER_PATTERN, 'g'), (match, name) => (name in params ? String(params[name]) : match))
  }

  // A React element can't be concatenated into a string, so split the
  // template around its placeholders (split() puts the captured placeholder
  // names at odd indexes) and hand back renderable nodes instead.
  return template
    .split(PLACEHOLDER_PATTERN)
    .map((part, index) => (index % 2 === 0 ? part : (params[part] ?? `{${part}}`)))
    .filter((part) => part !== '')
    .map((part, index) => createElement(Fragment, { key: index }, part))
}

// Looks up `key` (dot-separated path) in the active dictionary, falling back
// to Czech - the source language - so a missing translation still shows
// something readable. `params` fill `{name}` placeholders; a numeric
// `params.count` also selects the plural form ({ one, few, other, ... }) of
// an entry that has them.
export function t(key, params) {
  let entry = lookup(DICTIONARIES[currentLocale], key) ?? lookup(cs, key)

  if (entry === undefined) {
    return key
  }

  if (isPluralEntry(entry)) {
    const pluralCategory = typeof params?.count === 'number'
      ? new Intl.PluralRules(INTL_LOCALES[currentLocale]).select(params.count)
      : 'other'
    entry = entry[pluralCategory] ?? entry.other
  }

  if (typeof entry !== 'string' || !params) {
    return entry
  }

  return interpolate(entry, params)
}

// Error messages raised by the database (all-phases.sql) are Czech; this
// swaps a known one for its translation in the active language and passes
// anything else (Supabase/network errors, new messages) through untouched.
export function localizeServerMessage(message) {
  return SERVER_MESSAGE_TRANSLATIONS[currentLocale]?.[message] ?? message
}

// Re-renders the calling component whenever the language changes - any
// component that renders translated text must call this, not just import t.
export function useI18n() {
  const locale = useSyncExternalStore(subscribe, getLocale, getLocale)

  return { locale, t, setLocale }
}
