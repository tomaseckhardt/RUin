import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { downloadBlob } from '../lib/download.js'
import { buildAbsoluteUrl, parseEventDateTime } from '../lib/format.js'
import { t, useI18n } from '../lib/i18n.js'

const MOBILE_BROWSER_RE = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i
const APPLE_DEVICE_RE = /iPhone|iPad|iPod/i
const ICS_LINE_LENGTH_LIMIT = 75
const ICS_LINE_FOLD_LENGTH = 74

// 2026-05-01T18:30:00.000Z -> 20260501T183000Z. toISOString() throws on an
// invalid date, which sends the callers to their fallback.
function toUtcIcsDateTime(date) {
  return date.toISOString().replace(/[-:]|\.\d{3}/g, '')
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
  if (icsTextEncoder.encode(line).length <= ICS_LINE_LENGTH_LIMIT) {
    return line
  }

  const segments = []
  let current = ''
  let currentBytes = 0

  for (const char of line) {
    const charBytes = icsTextEncoder.encode(char).length
    const limit = segments.length === 0 ? ICS_LINE_LENGTH_LIMIT : ICS_LINE_FOLD_LENGTH

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

function slugify(value) {
  return String(value || t('calendar.fileNameFallback'))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function getCalendarFileName(eventData) {
  return `${slugify(eventData.name) || t('calendar.fileNameFallback')}.ics`
}

function openCalendarUrl(url) {
  const calendarWindow = window.open(url, '_blank', 'noopener,noreferrer')

  if (!calendarWindow) {
    window.location.href = url
  }
}

function exportIcs(eventData) {
  const content = buildIcs(eventData)
  const isMobileBrowser = MOBILE_BROWSER_RE.test(navigator.userAgent) || window.matchMedia('(pointer: coarse)').matches

  if (isMobileBrowser) {
    // Mobile browsers often block download links or blob URLs, but they do
    // intercept a direct data:text/calendar navigation and open the native
    // calendar sheet to add the event.
    window.location.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(content)}`
    return
  }

  downloadBlob(new Blob([content], { type: 'text/calendar;charset=utf-8' }), getCalendarFileName(eventData))
}

// Google Calendar's "render" endpoint is a plain https URL that opens a
// prefilled "add event" form on calendar.google.com - unlike the .ics/
// data:-URI flow above, it works from inside restricted in-app browsers
// (Instagram, Messenger, TikTok, ...) since those only block downloads and
// non-http(s) navigation, not ordinary link clicks.
function buildEventUrl(eventData) {
  if (!eventData?.id) {
    return ''
  }

  return buildAbsoluteUrl(`/event/${eventData.id}`)
}

function buildGoogleCalendarUrl(eventData) {
  const startDate = parseEventDateTime(eventData.datetime) ?? new Date(eventData.datetime)
  const endDate = addHours(startDate, 3)
  const eventUrl = buildEventUrl(eventData)
  const details = [eventData.description || '', eventUrl ? `${t('calendar.googleLinkLabel')} ${eventUrl}` : ''].filter(Boolean).join('\n\n')

  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: eventData.name || '',
    dates: `${toUtcIcsDateTime(startDate)}/${toUtcIcsDateTime(endDate)}`,
    details,
    location: eventData.location || '',
  })

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

function buildIcs(eventData) {
  const nowUtc = toUtcIcsDateTime(new Date())
  const startDate = parseEventDateTime(eventData.datetime) ?? new Date(eventData.datetime)
  const startUtc = toUtcIcsDateTime(startDate)
  const endUtc = toUtcIcsDateTime(addHours(startDate, 3))
  const name = eventData.name || ''
  const summary = escapeIcsText(name)
  const location = escapeIcsText(eventData.location)
  const eventUrl = buildEventUrl(eventData)
  const description = escapeIcsText(
    [eventData.description || '', eventUrl ? `${t('calendar.descriptionLinkLabel')} ${eventUrl}` : ''].filter(Boolean).join('\n\n'),
  )
  const reminderText = escapeIcsText(t('calendar.reminder', { name }))
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
  ]
    .map(foldIcsLine)
    .join('\r\n')
}

function buildOutlookCalendarUrl(eventData) {
  const startDate = parseEventDateTime(eventData.datetime) ?? new Date(eventData.datetime)
  const eventUrl = buildEventUrl(eventData)
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: eventData.name || '',
    startdt: startDate.toISOString(),
    enddt: addHours(startDate, 3).toISOString(),
    body: [eventData.description || '', eventUrl ? `${t('calendar.googleLinkLabel')} ${eventUrl}` : ''].filter(Boolean).join('\n\n'),
    location: eventData.location || '',
  })

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`
}

// Google and Outlook are plain https links, so they work from in-app browsers
// (Instagram, Messenger, ...) too; the .ics options need a real browser.
const CALENDAR_OPTIONS = [
  { key: 'google', open: (eventData) => openCalendarUrl(buildGoogleCalendarUrl(eventData)) },
  { key: 'apple', open: exportIcs, toastKey: 'calendar.downloaded' },
  { key: 'outlook', open: (eventData) => openCalendarUrl(buildOutlookCalendarUrl(eventData)) },
]

function AddToCalendarButton({ eventData }) {
  // The helpers above call t() directly when a click builds the calendar
  // entry; the hook only re-renders the labels on a language switch.
  useI18n()
  const [isOpen, setIsOpen] = useState(false)
  const triggerContainerRef = useRef(null)
  const triggerRef = useRef(null)
  const menuRef = useRef(null)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0 })
  const menuId = useId()

  useLayoutEffect(() => {
    if (!isOpen) {
      return undefined
    }

    function positionMenu() {
      const triggerRect = triggerRef.current?.getBoundingClientRect()
      if (!triggerRect) {
        return
      }

      const menuWidth = menuRef.current?.offsetWidth || 224
      const menuHeight = menuRef.current?.offsetHeight || 160
      const left = Math.max(8, Math.min(triggerRect.left, window.innerWidth - menuWidth - 8))
      let top = triggerRect.bottom + 8

      if (top + menuHeight > window.innerHeight - 8 && triggerRect.top - menuHeight - 8 >= 8) {
        top = triggerRect.top - menuHeight - 8
      }

      setMenuPosition({ left, top })
    }

    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    // The device's own calendar gets the focus, so Enter picks it.
    const preferredKey = APPLE_DEVICE_RE.test(navigator.userAgent) ? 'apple' : 'google'
    menuRef.current?.querySelector(`[data-calendar="${preferredKey}"]`)?.focus()

    function closeOnOutsideClick(event) {
      if (!triggerContainerRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  if (!eventData?.datetime) {
    return null
  }

  function handlePick(option) {
    setIsOpen(false)

    try {
      option.open(eventData)

      if (option.toastKey) {
        toast.success(t(option.toastKey))
      }
    } catch {
      toast.error(t('calendar.error'))
    }
  }

  // Phones and tablets only: a device whose main pointer is a mouse or
  // trackpad (pointer: fine) doesn't show the button.
  return (
    <div ref={triggerContainerRef} className="relative inline-block pointer-fine:hidden">
      <button
        ref={triggerRef}
        type="button"
        className="secondary-button"
        aria-expanded={isOpen}
        aria-controls={menuId}
        onClick={() => setIsOpen((current) => !current)}>
        {t('calendar.button')}
      </button>
      {isOpen
        ? createPortal(
            <ul
              ref={menuRef}
              id={menuId}
              aria-label={t('calendar.menuLabel')}
              className="fixed z-20 w-56 max-w-[calc(100vw-1rem)] rounded-2xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
              style={menuPosition}>
              {CALENDAR_OPTIONS.map((option) => (
                <li key={option.key}>
                  <button
                    type="button"
                    data-calendar={option.key}
                    className="w-full rounded-xl px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-100 focus:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus:bg-slate-800"
                    onClick={() => handlePick(option)}>
                    {t(`calendar.options.${option.key}`)}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  )
}

export default AddToCalendarButton
