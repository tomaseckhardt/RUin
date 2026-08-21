import { toast } from 'sonner'

function pad(value) {
  return String(value).padStart(2, '0')
}

function toUtcIcsDateTime(input) {
  const date = new Date(input)

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid event datetime')
  }

  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hours = pad(date.getUTCHours())
  const minutes = pad(date.getUTCMinutes())
  const seconds = pad(date.getUTCSeconds())

  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

const icsTextEncoder = new TextEncoder()

// RFC 5545 requires content lines to be folded at 75 octets, with each
// continuation line prefixed by a single space. Iterating by Unicode code
// point (not raw string index) keeps multi-byte characters (accents, emoji)
// intact instead of splitting them across a fold boundary.
function foldIcsLine(line) {
  if (icsTextEncoder.encode(line).length <= 75) {
    return line
  }

  const segments = []
  let current = ''
  let currentBytes = 0

  for (const char of line) {
    const charBytes = icsTextEncoder.encode(char).length
    const limit = segments.length === 0 ? 75 : 74

    if (currentBytes + charBytes > limit) {
      segments.push(current)
      current = ''
      currentBytes = 0
    }

    current += char
    currentBytes += charBytes
  }

  segments.push(current)

  return segments.join('\r\n ')
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000)
}

const EVENT_TIME_ZONE = 'Europe/Prague'
const NAIVE_DATETIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/

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

// eventData.datetime has no timezone offset (Postgres "timestamp without
// time zone") and is, by app-wide convention, wall-clock time in Europe/
// Prague - not the viewer's device timezone. Resolve it to the correct UTC
// instant using the IANA zone's real offset (which also covers DST) instead
// of letting `new Date()` assume the browser's local timezone.
function eventStartToUtcDate(input) {
  const match = String(input).match(NAIVE_DATETIME_PATTERN)

  if (!match) {
    return new Date(input)
  }

  const [, year, month, day, hour, minute, second = '0'] = match
  const naiveUtcMillis = Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour), Number(minute), Number(second),
  )
  const offsetMinutes = getTimeZoneOffsetMinutes(naiveUtcMillis, EVENT_TIME_ZONE)

  return new Date(naiveUtcMillis - offsetMinutes * 60000)
}

function slugify(value) {
  return String(value || 'udalost')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function downloadIcs(content, fileName) {
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // Safari can read the blob: URL asynchronously after click() returns, so
  // revoking it immediately can produce an empty/truncated download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function buildIcs(eventData) {
  const nowUtc = toUtcIcsDateTime(new Date())
  const startDate = eventStartToUtcDate(eventData.datetime)
  const startUtc = toUtcIcsDateTime(startDate)
  const endUtc = toUtcIcsDateTime(addHours(startDate, 3))
  const name = eventData.name || ''
  const summary = escapeIcsText(name)
  const location = escapeIcsText(eventData.location)
  const description = escapeIcsText(eventData.description)
  const reminderText = escapeIcsText(`Připomínka: ${name}`)
  const uid = `${eventData.id ?? Date.now()}@ruin.app`

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//R U in?//Event Calendar//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:${summary}`,
    `LOCATION:${location}`,
    `DESCRIPTION:${description}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${reminderText}`,
    'TRIGGER:-P2D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].map(foldIcsLine).join('\r\n')
}

function AddToCalendarButton({ eventData }) {
  if (!eventData?.datetime) {
    return null
  }

  function handleAddToCalendar() {
    try {
      const calendarContent = buildIcs(eventData)
      const fileName = `${slugify(eventData.name) || 'udalost'}.ics`

      downloadIcs(calendarContent, fileName)
      toast.success('Kalendář stažen. Upozornění je nastavené na 2 dny předem.')
    } catch {
      toast.error('Nepodařilo se vytvořit kalendářovou pozvánku.')
    }
  }

  return (
    <button type="button" className="secondary-button" onClick={handleAddToCalendar}>
      Přidat do kalendáře
    </button>
  )
}

export default AddToCalendarButton
