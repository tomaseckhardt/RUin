// Saves a URL (data: or blob:) as a file through a temporary download link.
export function downloadHref(href, fileName) {
  const link = document.createElement('a')
  link.href = href
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  downloadHref(url, fileName)
  // Safari can read the blob: URL asynchronously after click() returns, so
  // revoking it immediately can produce an empty/truncated download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
