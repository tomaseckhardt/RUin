import { getIntlLocale, t } from './i18n.js'

export function parseLocalDateTime(dateString) {
  if (typeof dateString !== 'string') {
    return null
  }

  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/)

  if (!match) {
    return null
  }

  const [, year, month, day, hour, minute, second = '0'] = match
  const monthNum = Number(month)
  const dayNum = Number(day)
  const hourNum = Number(hour)
  const minuteNum = Number(minute)
  const secondNum = Number(second)

  if (monthNum < 1 || monthNum > 12 || dayNum < 1 || dayNum > 31 || hourNum > 23 || minuteNum > 59 || secondNum > 59) {
    return null
  }

  const date = new Date(Number(year), monthNum - 1, dayNum, hourNum, minuteNum, secondNum)

  if (Number.isNaN(date.getTime()) || date.getMonth() !== monthNum - 1) {
    return null
  }

  return date
}

export function formatDateTime(dateString) {
  const date = parseLocalDateTime(dateString) ?? new Date(dateString)
  return Number.isNaN(date.getTime()) ? dateString : new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'full', timeStyle: 'short' }).format(date)
}

// path starts with '/', e.g. `/event/${id}`; BASE_URL always ends with '/'.
export function buildAbsoluteUrl(path) {
  return new URL(`${import.meta.env.BASE_URL}#${path}`, window.location.origin).href
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

export function shouldShowPastEventBadge(dateString) {
  const eventDate = parseLocalDateTime(dateString)

  if (!eventDate) {
    return false
  }

  const badgeDate = new Date(eventDate)
  badgeDate.setDate(badgeDate.getDate() + 1)
  badgeDate.setHours(8, 0, 0, 0)

  return Date.now() >= badgeDate.getTime()
}
