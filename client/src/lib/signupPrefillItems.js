export function createEmptySignupPrefillItem() {
  return { key: crypto.randomUUID(), label: '', personName: '', quantity: 1 }
}

// Filters out rows the user never filled in (label is required, person is
// optional - a 'bring' item with no assigned person is just left open for
// anyone to claim later, a 'ride' with no named driver falls back to the
// organizer as created_by), and clamps quantity into the 1-20 range
// add_signup_item's own capacity check enforces.
export function getFilledSignupPrefillItems(items) {
  return items
    .map((item) => ({
      label: (item.label || '').trim(),
      personName: (item.personName || '').trim(),
      quantity: Math.min(20, Math.max(1, Number(item.quantity) || 1)),
    }))
    .filter((item) => item.label !== '')
}
