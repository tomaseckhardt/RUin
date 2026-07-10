const basePath = import.meta.env.BASE_URL || '/'

function normalizePath(path) {
  return path.startsWith('/') ? path : `/${path}`
}

export function parseLocalDateTime(dateString) {
  if (typeof dateString !== 'string') {
    return null
  }

  const match = dateString.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/)

  if (!match) {
    return null
  }

  const [, year, month, day, hour, minute, second = '0'] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

export function formatDateTime(dateString) {
  const localDate = parseLocalDateTime(dateString)

  if (localDate) {
    return new Intl.DateTimeFormat('cs-CZ', {
      dateStyle: 'full',
      timeStyle: 'short',
    }).format(localDate)
  }

  const date = new Date(dateString)

  if (Number.isNaN(date.getTime())) {
    return dateString
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date)
}

export function buildAbsoluteUrl(path) {
  const normalizedPath = normalizePath(path)
  const base = basePath.endsWith('/') ? basePath : `${basePath}/`
  return new URL(`${base}#${normalizedPath}`, window.location.origin).toString()
}

export function summaryText(summary) {
  return `${summary.confirmed} přijde · ${summary.excused} se omluvili`
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
