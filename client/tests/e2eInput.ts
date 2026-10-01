// What app.e2e.ts types in, per language. `satisfies` checks that both
// languages fill in the same fields, while keeping each value's own type.

export type Locale = 'cs' | 'en'

export const INPUT = {
  cs: {
    organizer: 'Eva',
    event: 'Grilovačka na střeše',
    location: 'Stromovka',
    description: 'Přineste dobrou náladu.',
    newDescription: 'Začínáme v 18:00, vezměte si deku.',
    stop: 'Hospoda U Fleků',
    item: 'Pivo',
    guest: 'Petr',
    secondGuest: 'Jana',
    excuse: 'Mám noční směnu.',
    chat: 'Ahoj všichni, těším se!',
    comment: 'Super fotka!',
    ping: 'Pojď aspoň na chvíli!',
    poll: 'Kdy na hokej?',
    pollPlaceA: 'Zimní stadion',
    pollPlaceB: 'Hokejová hala',
    voter: 'Karel',
    feedback: 'Bylo by fajn exportovat itinerář do kalendáře.',
  },
  en: {
    organizer: 'Eve',
    event: 'Rooftop barbecue',
    location: 'Stromovka',
    description: 'Bring a good mood.',
    newDescription: 'We start at 6 pm, bring a blanket.',
    stop: 'The Old Pub',
    item: 'Beer',
    guest: 'Peter',
    secondGuest: 'Jane',
    excuse: 'I have a night shift.',
    chat: 'Hi everyone, looking forward to it!',
    comment: 'Great photo!',
    ping: 'Come at least for a bit!',
    poll: 'When do we play hockey?',
    pollPlaceA: 'Winter stadium',
    pollPlaceB: 'Hockey hall',
    voter: 'Charles',
    feedback: 'It would be nice to export the itinerary to a calendar.',
  },
} satisfies Record<Locale, Record<string, string>>
