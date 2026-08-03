export function createEmptyInvitee() {
  return { key: crypto.randomUUID(), name: '', phone: '' }
}

function normalizeForDedupe(value) {
  return (value || '').trim().toLocaleLowerCase('cs-CZ')
}

// Filters out rows the user never filled in, and trims whitespace - both
// CreateEventPage and InvitePeopleModal need this exact shape before calling
// inviteAttendees/createContactGroup, so it lives here instead of being
// duplicated at each call site.
export function getFilledInvitees(invitees) {
  return invitees
    .map((invitee) => ({ name: (invitee.name || '').trim(), phone: (invitee.phone || '').trim() }))
    .filter((invitee) => invitee.name !== '')
}

// Merges a saved group's members into an existing invite list, skipping
// anyone already present (matched by phone first, falling back to name) so
// picking the same group twice - or picking two overlapping groups - doesn't
// create duplicate rows.
export function mergeInvitees(existing, incoming) {
  const seen = new Set(
    existing.map((invitee) => normalizeForDedupe(invitee.phone) || normalizeForDedupe(invitee.name)),
  )
  const merged = [...existing]

  for (const member of incoming) {
    const key = normalizeForDedupe(member.phone) || normalizeForDedupe(member.name)

    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    merged.push({ key: crypto.randomUUID(), name: member.name, phone: member.phone })
  }

  return merged
}
