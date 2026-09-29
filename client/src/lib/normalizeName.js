// Names are compared case-insensitively, the same way the database does.
export function normalizeName(value) {
  return (value || '').trim().toLocaleLowerCase('cs-CZ')
}
