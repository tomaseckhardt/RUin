import { useEffect, useState } from 'react'
import { toast } from 'sonner'

const MOBILE_QUERY = '(max-width: 767px)'

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
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
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
  URL.revokeObjectURL(url)
}

function buildIcs(eventData) {
  const nowUtc = toUtcIcsDateTime(new Date())
  const startUtc = toUtcIcsDateTime(eventData.datetime)
  const summary = escapeIcsText(eventData.name)
  const location = escapeIcsText(eventData.location)
  const description = escapeIcsText(eventData.description)
  const reminderText = escapeIcsText(`Připomínka: ${eventData.name}`)
  const uid = `${eventData.id || Date.now()}@ruin.app`

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
  ].join('\r\n')
}

function AddToCalendarButton({ eventData }) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY)

    const syncMobileState = () => {
      setIsMobile(mediaQuery.matches)
    }

    syncMobileState()

    mediaQuery.addEventListener('change', syncMobileState)

    return () => {
      mediaQuery.removeEventListener('change', syncMobileState)
    }
  }, [])

  if (!isMobile || !eventData?.datetime) {
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
