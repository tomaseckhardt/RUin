const rawBase = import.meta.env.VITE_API_BASE_URL?.trim() || ''
const API_BASE_URL = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase

function resolveApiUrl(path) {
  if (API_BASE_URL) {
    return `${API_BASE_URL}${path}`
  }

  return path
}

async function readResponse(response) {
  const contentType = response.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return response.json()
  }

  return null
}

async function apiRequest(path, options = {}) {
  const response = await fetch(resolveApiUrl(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  const payload = await readResponse(response)

  if (!response.ok) {
    throw new Error(payload?.message || 'Požadavek se nepovedl.')
  }

  return payload
}

export function createEvent(data) {
  return apiRequest('/api/events', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function getEvent(id) {
  return apiRequest(`/api/events/${id}`)
}

export function submitRsvp(id, data) {
  return apiRequest(`/api/events/${id}/rsvp`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function moderateAttendee(eventId, attendeeId, data) {
  return apiRequest(`/api/events/${eventId}/attendees/${attendeeId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function removeEvent(eventId, token) {
  return apiRequest(`/api/events/${eventId}`, {
    method: 'DELETE',
    body: JSON.stringify({ token }),
  })
}
