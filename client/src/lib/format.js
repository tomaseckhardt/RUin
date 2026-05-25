const basePath = import.meta.env.BASE_URL || '/'

function normalizePath(path) {
  return path.startsWith('/') ? path : `/${path}`
}

export function formatDateTime(dateString) {
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
