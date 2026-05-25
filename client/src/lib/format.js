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
  return new URL(path, window.location.origin).toString()
}

export function summaryText(summary) {
  return `${summary.confirmed} přijde · ${summary.excused} se omluvili`
}