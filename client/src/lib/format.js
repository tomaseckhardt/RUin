import { getIntlLocale, t } from './i18n.js'

// events.datetime has no timezone offset (Postgres "timestamp without time
// zone") and is, by app-wide convention, wall-clock time in Europe/Prague -
// not the viewer's device timezone.
export const EVENT_TIME_ZONE = 'Europe/Prague'

// '2026-05-01T18:30' -> [2026, 5, 1, 18, 30, 0], or null when it isn't a
// valid naive date-time. Validated without the device timezone, so a time
// that falls into the viewer's DST gap is not mangled.
function parseNaiveDateTimeParts(dateString) {
  if (typeof dateString !== 'string') {
    return null
  }

  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/)

  if (!match) {
    return null
  }

  const parts = match.slice(1).map((part = '0') => Number(part))
  const [year, month, day, hour, minute, second] = parts

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return null
  }

  return new Date(Date.UTC(year, month - 1, day)).getUTCMonth() === month - 1 ? parts : null
}

// Minutes the zone is ahead of UTC at the instant utcMillis.
function getTimeZoneOffsetMinutes(utcMillis, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMillis))

  const get = (type) => Number(parts.find((part) => part.type === type).value)
  const asIfUtcMillis = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))

  return (asIfUtcMillis - utcMillis) / 60000
}

// Prague wall-clock parts -> the UTC instant. The offset is looked up twice:
// the first guess reads it at the naive time, which is off by the offset
// itself, so near a DST switch the second lookup at the real instant decides.
function pragueWallTimeToMillis(year, month, day, hour = 0, minute = 0, second = 0) {
  const naiveUtcMillis = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstOffset = getTimeZoneOffsetMinutes(naiveUtcMillis, EVENT_TIME_ZONE)
  return naiveUtcMillis - getTimeZoneOffsetMinutes(naiveUtcMillis - firstOffset * 60000, EVENT_TIME_ZONE) * 60000
}

// Parses a naive date-time into a Date with the same local fields (what the
// date picker edits; compare it with getEventTimeZoneNow, not new Date()).
export function parseLocalDateTime(dateString) {
  const parts = parseNaiveDateTimeParts(dateString)

  if (!parts) {
    return null
  }

  const [year, month, day, hour, minute, second] = parts
  return new Date(year, month - 1, day, hour, minute, second)
}

// Now as a Date whose local fields hold the Prague wall-clock time - the
// space the date picker works in, so a viewer abroad gets Prague's today.
// Known limit: a Prague time inside the device's own DST gap shifts by an
// hour, like parseLocalDateTime; UTC-based fields in the picker would fix it.
export function getEventTimeZoneNow(date = new Date()) {
  const wall = new Date(date.getTime() + getTimeZoneOffsetMinutes(date.getTime(), EVENT_TIME_ZONE) * 60000)
  return new Date(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), wall.getUTCSeconds())
}

// Parses events.datetime (Prague wall-clock time) to the real instant - use
// it for anything compared against now.
export function parseEventDateTime(dateString) {
  const parts = parseNaiveDateTimeParts(dateString)
  return parts ? new Date(pragueWallTimeToMillis(...parts)) : null
}

export function formatDateTime(dateString) {
  const date = parseEventDateTime(dateString) ?? new Date(dateString)
  return Number.isNaN(date.getTime())
    ? dateString
    : new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'full', timeStyle: 'short', timeZone: EVENT_TIME_ZONE }).format(date)
}

// path starts with '/', e.g. `/event/${id}`; BASE_URL always ends with '/'.
export function buildAbsoluteUrl(path) {
  return new URL(`${import.meta.env.BASE_URL}#${path}`, window.location.origin).href
}

// The token in an organizerPath such as `/event/${id}/manage?token=…`.
export function parseOrganizerToken(path) {
  try {
    return new URL(path, window.location.origin).searchParams.get('token') || ''
  } catch {
    return ''
  }
}

export function summaryText(summary) {
  return t('attendees.summary', { confirmed: summary.confirmed, excused: summary.excused })
}

export function toDateTimeLocalValue(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')

  return `${year}-${month}-${day}T${hours}:${minutes}`
}

// The badge shows from 8:00 Prague time the day after the event.
export function shouldShowPastEventBadge(dateString) {
  const parts = parseNaiveDateTimeParts(dateString)

  if (!parts) {
    return false
  }

  const [year, month, day] = parts
  // Date.UTC rolls day + 1 over into the next month/year.
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1))

  return Date.now() >= pragueWallTimeToMillis(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate(), 8)
}

// Today's date in Prague as 'YYYY-MM-DD'.
export function getEventTimeZoneDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: EVENT_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
