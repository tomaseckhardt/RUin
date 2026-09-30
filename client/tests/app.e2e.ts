// One end-to-end walk through the whole app, run once in Czech and once in
// English. Every label and button is looked up in the locale dictionaries,
// so both runs are the same test. The backend is the in-memory fake in
// fakeSupabase.ts - nothing reaches a real Supabase project.
//
// Run: npm run test:e2e (in client/). It starts its own dev server; failure
// traces land in tests/test-results/.

import { expect, test, type Page } from '@playwright/test'
import cs from '../src/locales/cs.js'
import en from '../src/locales/en.js'
import serverMessagesEn from '../src/locales/serverMessages.en.js'
import { createFakeSupabase } from './fakeSupabase.ts'

type Locale = 'cs' | 'en'
// A dictionary entry is a text, a list of texts, plural forms ({ one, other,
// ... }) or a nested group of entries.
type Dictionary = { [key: string]: string | string[] | Dictionary }
type TextParams = Record<string, string | number>

const DICTIONARIES: Record<Locale, Dictionary> = { cs, en }
const LOCALE_NAMES: Record<Locale, string> = { cs: 'Czech', en: 'English' }

// What the test types in, per language. `satisfies` checks that both
// languages fill in the same fields, while keeping each value's own type.
const INPUT = {
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

// A 1x1 PNG to upload as a photo.
const PHOTO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

// The same lookup as t() in src/lib/i18n.js, for plain-text entries.
function translator(locale: Locale) {
  const plural = new Intl.PluralRules(locale)

  return (key: string, params: TextParams = {}): string => {
    let entry: Dictionary[string] | undefined = DICTIONARIES[locale]

    for (const part of key.split('.')) {
      entry = typeof entry === 'object' && !Array.isArray(entry) ? entry[part] : undefined
    }

    // Plural forms: pick the one Intl.PluralRules names for params.count.
    if (typeof entry === 'object' && !Array.isArray(entry)) {
      entry = entry[plural.select(Number(params.count))] ?? entry.other
    }

    if (typeof entry !== 'string') {
      throw new Error(`No ${locale} text for ${key}`)
    }

    return entry.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name]))
  }
}

// The first capture group of pattern in text; fails the test if it doesn't match.
function capture(text: string, pattern: RegExp): string {
  const match = text.match(pattern)

  if (!match) {
    throw new Error(`${text} does not match ${pattern}`)
  }

  return match[1]
}

for (const locale of ['cs', 'en'] as const) {
  test(`the whole app works in ${LOCALE_NAMES[locale]}`, async ({ browser, page }) => {
    const t = translator(locale)
    const input = INPUT[locale]
    const backend = createFakeSupabase()
    const pageErrors: string[] = []
    const realSupabaseRequests: string[] = []

    // Every browser in the test (a second one votes in the poll) talks to the
    // same fake backend.
    async function preparePage(browserPage: Page) {
      browserPage.on('pageerror', (error) => pageErrors.push(error.message))
      // A safety net: the dev server is built against the fake URL, so nothing
      // may ever go to a real project.
      await browserPage.route(/\.supabase\.(co|in)\//, (route) => {
        realSupabaseRequests.push(route.request().url())
        return route.abort()
      })
      await backend.install(browserPage)
      await browserPage.addInitScript((appLocale) => {
        localStorage.setItem('ruin-locale', appLocale)

        if (!localStorage.getItem('ruin-theme')) {
          localStorage.setItem('ruin-theme', 'light')
        }
      }, locale)
    }

    await preparePage(page)
    // Time runs normally; the test only skips ahead past the RSVP celebrations.
    await page.clock.install()
    // Deleting asks window.confirm(); Playwright would dismiss it.
    page.on('dialog', (browserDialog) => browserDialog.accept())

    const dialog = page.getByRole('dialog')
    const toast = (text: string) => expect(page.getByText(text, { exact: true }).first()).toBeVisible()
    let eventId = ''

    await test.step('the organizer creates an event with a bring list', async () => {
      await page.goto('/')
      await page.getByRole('button', { name: t('createEvent.composerExpand') }).click()

      const form = page.locator('#create-form form')
      await form.getByPlaceholder(t('common.namePlaceholder')).fill(input.organizer)
      await form.getByPlaceholder(t('createEvent.pinPlaceholder')).fill('1234')
      await form.getByLabel(t('eventForm.name'), { exact: true }).fill(input.event)
      await form.getByLabel(t('eventForm.location'), { exact: true }).fill(input.location)
      await form.getByRole('button', { name: t('datePicker.placeholder') }).click()
      await form.getByRole('button', { name: t('datePicker.presetTomorrow') }).click()
      await form.getByLabel(t('eventForm.description'), { exact: true }).fill(input.description)
      await form.getByRole('checkbox', { name: t('eventForm.bringList') }).check()
      await form.getByRole('checkbox', { name: t('eventForm.stops') }).check()
      await form.getByLabel(t('signup.bring.itemLabel'), { exact: true }).fill(input.item)
      await form.getByLabel(t('signup.bring.quantityLabel'), { exact: true }).fill('2')
      await form.getByRole('button', { name: t('createEvent.submit') }).click()

      await toast(t('createEvent.created'))
      // The link's token is saved and dropped from the address bar.
      await expect(page).toHaveURL(/#\/event\/\w+\/manage$/)
      await expect(page.getByRole('heading', { level: 1, name: input.event })).toBeVisible()
      eventId = capture(page.url(), /#\/event\/(\w+)\/manage$/)
      expect(backend.db.items).toEqual([expect.objectContaining({ label: input.item, capacity: 2, category: 'bring' })])
    })

    await test.step('the organizer sees the weather, edits the event, adds a stop and opens the overview', async () => {
      await expect(page.getByText('18° / 26°C')).toBeVisible()

      await page.getByRole('button', { name: t('manage.editEvent') }).click()
      await dialog.getByLabel(t('eventForm.description'), { exact: true }).fill(input.newDescription)
      await dialog.getByRole('button', { name: t('manage.saveChanges') }).click()
      await toast(t('manage.eventUpdated'))
      await expect(dialog).toBeHidden()
      expect(backend.db.events[0].description).toBe(input.newDescription)

      await page.getByRole('button', { name: t('stops.title') }).click()
      await page.getByRole('button', { name: t('stops.add') }).click()
      await page.getByPlaceholder(t('stops.namePlaceholder')).fill(input.stop)
      await page.getByRole('button', { name: t('common.add'), exact: true }).click()
      await expect(page.getByText(input.stop)).toBeVisible()

      await page.getByRole('button', { name: t('overview.title') }).click()
      await expect(dialog.getByRole('heading', { name: input.event })).toBeVisible()
      await expect(dialog.getByText(input.newDescription)).toBeVisible()
      await dialog.getByRole('button', { name: t('common.close') }).click()
      await expect(dialog).toBeHidden()
    })

    await test.step('a guest confirms, chats, reacts, claims an item and posts a photo', async () => {
      await page.goto(`/#/event/${eventId}`)
      await expect(page.getByText(input.newDescription)).toBeVisible()
      await page.getByLabel(t('common.yourName')).fill(input.guest)
      await page.getByRole('button', { name: t('event.confirmOption'), exact: true }).click()
      // The guest's own panel replaces the celebration after 4.5 s.
      await expect(page.getByText(t('celebration.confirmTitleWithName', { name: input.guest }))).toBeVisible()
      await page.clock.fastForward(4500)
      await expect(page.getByRole('heading', { level: 2, name: input.guest, exact: true })).toBeVisible()

      const chatInput = page.getByPlaceholder(t('chat.placeholder'))
      await chatInput.fill(input.chat)
      // Enter sends (lib/enterToSubmit.js).
      await chatInput.press('Enter')
      await expect(page.getByText(input.chat)).toBeVisible()
      await expect(chatInput).toHaveValue('')
      await page.getByRole('button', { name: t('chat.addReaction') }).click()
      await page.getByRole('button', { name: '👍', exact: true }).click()
      await expect.poll(() => backend.db.reactions.length).toBe(1)

      await page.getByRole('button', { name: t('signup.bring.title') }).click()
      await page.getByRole('button', { name: t('signup.claim') }).click()
      await expect.poll(() => backend.db.claims.map((claim) => claim.attendee_name)).toEqual([input.guest])

      await page.locator('input[type=file]').setInputFiles({ name: 'party.png', mimeType: 'image/png', buffer: PHOTO })
      await toast(t('photos.uploadedOne'))
      const photo = page.getByRole('img', { name: t('photos.photoBy', { name: input.guest }) })
      await expect(photo).toBeVisible()

      await photo.click()
      await dialog.getByRole('button', { name: t('photos.like'), exact: true }).click()
      await expect(dialog.getByText(t('photos.likeCount', { count: 1 }))).toBeVisible()
      const commentInput = dialog.getByLabel(t('photos.commentLabel'))
      await commentInput.fill(input.comment)
      await commentInput.press('Enter')
      await expect(dialog.getByText(input.comment)).toBeVisible()
      // Escape in a field with a draft keeps the lightbox open.
      await expect(commentInput).toHaveValue('')
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
    })

    await test.step('the guest deletes their own photo', async () => {
      const photo = page.getByRole('img', { name: t('photos.photoBy', { name: input.guest }) })
      await photo.click()
      // Only the uploader's browser (it holds the delete token) offers Delete.
      await dialog.getByRole('button', { name: t('common.delete'), exact: true }).click()
      // The lightbox closes with the last photo gone.
      await expect(dialog).toBeHidden()
      await expect(photo).toBeHidden()
      await expect(page.getByText(t('photos.empty'))).toBeVisible()
      expect(backend.db.photos).toEqual([])
      expect(backend.db.objects).toEqual([])
      expect(backend.db.likes).toEqual([])
      expect(backend.db.comments).toEqual([])
    })

    await test.step('a second guest excuses themselves', async () => {
      await page.getByRole('button', { name: t('event.notMe') }).click()
      await page.getByLabel(t('common.yourName')).fill(input.secondGuest)
      await page.getByRole('radio', { name: t('event.excuseOption') }).click()
      await page.getByLabel(t('event.excuseReason')).fill(input.excuse)
      await page.getByRole('button', { name: t('event.sendExcuse') }).click()
      await expect(page.getByText(t('celebration.declineTitleWithName', { name: input.secondGuest }))).toBeVisible()
      await page.clock.fastForward(3500)
      await expect(page.getByRole('heading', { level: 2, name: input.secondGuest, exact: true })).toBeVisible()
      // The organizer is the event's first guest.
      expect(backend.db.attendees.map((attendee) => [attendee.name, attendee.status])).toEqual([
        [input.organizer, 'confirmed'],
        [input.guest, 'confirmed'],
        [input.secondGuest, 'excused'],
      ])
    })

    await test.step('the first guest comes back, sees the reaction and pings the second', async () => {
      await page.evaluate(([id, name]) => localStorage.setItem(`ruin-event-identity:${id}`, name), [eventId, input.guest])
      await page.reload()
      await expect(page.getByRole('heading', { level: 2, name: input.guest, exact: true })).toBeVisible()
      await expect(page.getByTitle(input.guest, { exact: true })).toBeVisible()

      await page.getByRole('button', { name: t('attendees.ping'), exact: true }).click()
      const message = dialog.getByLabel(t('ping.messageLabel'))
      await message.fill(input.ping)
      await message.press('Enter')
      await toast(t('ping.sent'))
      await expect(dialog).toBeHidden()
      expect(backend.db.pings).toEqual([expect.objectContaining({ source_name: input.guest, message: input.ping })])
    })

    await test.step('a wrong link asks for the PIN, which refuses a wrong one and unlocks the event again', async () => {
      // A wrong link doesn't cost this browser its saved organizer link.
      await page.goto(`/#/event/${eventId}/manage?token=not-the-real-token`)
      await expect(page).toHaveURL(new RegExp(`#/event/${eventId}/manage$`))
      await expect(page.getByRole('heading', { level: 1, name: input.event })).toBeVisible()

      // Without one, it asks for the PIN.
      await page.evaluate(() => localStorage.removeItem('ruin-organizer-tokens'))
      await page.goto(`/#/event/${eventId}/manage?token=not-the-real-token`)
      await expect(page.getByRole('heading', { level: 1, name: t('manage.unlockTitle') })).toBeVisible()
      await expect(page.getByText(t('manage.unlockAgain'))).toBeVisible()
      // The wrong token is dropped from the address bar and from storage.
      await expect(page).toHaveURL(new RegExp(`#/event/${eventId}/manage$`))

      // A wrong PIN comes back as { error } (so the lockout counter sticks)
      // and is shown like any other error.
      const wrongPin = 'Neplatný správcovský PIN.'
      await page.getByLabel(t('pin.label')).fill('0000')
      await page.getByRole('button', { name: t('pin.enter') }).click()
      await toast(locale === 'cs' ? wrongPin : serverMessagesEn[wrongPin])
      expect(backend.db.events[0].pin_failed_attempts).toBe(1)

      await page.getByLabel(t('pin.label')).fill('1234')
      await page.getByRole('button', { name: t('pin.enter') }).click()
      await toast(t('manage.unlockedAndSaved'))
      await expect(page.getByRole('heading', { level: 1, name: input.event })).toBeVisible()
    })

    await test.step('the organizer accepts the excuse', async () => {
      await page.getByRole('button', { name: t('attendees.accept') }).click()
      await toast(t('manage.excuseAccepted'))
      await expect(page.getByText(t('attendees.status.excused_accepted'), { exact: true })).toBeVisible()
      expect(backend.db.attendees[2].status).toBe('excused_accepted')
    })

    await test.step('someone runs a poll, a friend votes and the poll becomes an event', async () => {
      await page.goto('/#/poll/new')
      await page.getByPlaceholder(t('common.namePlaceholder')).fill(input.organizer)
      await page.getByPlaceholder(t('createPoll.namePlaceholder')).fill(input.poll)
      await page
        .getByRole('button', { name: t('datePicker.placeholder') })
        .first()
        .click()
      await page.getByRole('button', { name: t('datePicker.presetTomorrow') }).click()
      await page.getByPlaceholder(t('createPoll.locationPlaceholder')).first().fill(input.pollPlaceA)
      // The button pulses forever, so it never counts as stable.
      await page.getByRole('button', { name: t('createPoll.addOption') }).click({ force: true })
      await page.getByRole('button', { name: t('datePicker.placeholder') }).click()
      await page.getByRole('button', { name: t('datePicker.presetSaturday') }).click()
      await page.getByPlaceholder(t('createPoll.locationPlaceholder')).nth(1).fill(input.pollPlaceB)
      await page.getByRole('button', { name: t('createPoll.submit') }).click()
      await toast(t('createPoll.created'))
      // The creator's token stays in this browser; the address bar shows the
      // plain voting link.
      await expect(page).toHaveURL(/#\/poll\/\w+$/)
      const pollId = capture(page.url(), /#\/poll\/(\w+)$/)
      await expect(page.getByRole('button', { name: t('poll.copyVoteLink') })).toBeVisible()

      // The friend votes from their own browser, where the same link is the voting page.
      const voterContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, serviceWorkers: 'block', timezoneId: 'Europe/Prague', reducedMotion: 'reduce' })
      const voterPage = await voterContext.newPage()
      await preparePage(voterPage)
      await voterPage.goto(`/#/poll/${pollId}`)
      await expect(voterPage.getByRole('button', { name: t('poll.copyVoteLink') })).toBeHidden()
      await voterPage.getByPlaceholder(t('common.guestNamePlaceholder')).fill(input.voter)
      await voterPage.getByRole('radio').first().check()
      await voterPage.getByRole('button', { name: t('poll.vote'), exact: true }).click()
      await expect(voterPage.getByText(t('poll.voteSaved'), { exact: true }).first()).toBeVisible()
      await expect(voterPage.getByText(t('poll.votes', { count: 1 }), { exact: true })).toBeVisible()
      await voterContext.close()

      await page.reload()
      await expect(page.getByText(t('poll.votes', { count: 1 }), { exact: true })).toBeVisible()
      await page
        .getByRole('button', { name: t('poll.pick'), exact: true })
        .first()
        .click()
      await page.getByPlaceholder('1234').fill('5678')
      await page.getByRole('button', { name: t('poll.finalize') }).click()
      await toast(t('poll.eventCreated'))
      await expect(page).toHaveURL(/#\/event\/\w+\/manage$/)
      await expect(page.getByRole('heading', { level: 1, name: input.poll })).toBeVisible()
      expect(backend.db.polls[0].finalized_event_id).toBe(backend.db.events[1].id)
    })

    await test.step('the organizer sends an idea and switches to dark mode', async () => {
      await page.getByRole('button', { name: t('feedback.fabLabel') }).click()
      await dialog.getByRole('button', { name: t('feedback.types.idea') }).click()
      await expect(dialog.getByRole('heading', { name: t('feedback.idea.title') })).toBeVisible()
      await dialog.getByLabel(t('common.name'), { exact: true }).fill(input.organizer)
      await dialog.getByLabel(t('feedback.idea.messageLabel')).fill(input.feedback)
      await dialog.getByRole('button', { name: t('common.send'), exact: true }).click()
      await toast(t('feedback.thanks'))
      expect(backend.db.feedback).toEqual([expect.objectContaining({ type: 'idea', name: input.organizer, message: input.feedback })])

      await page.getByRole('switch', { name: t('shell.darkMode') }).click()
      await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    })

    await test.step('the organizer deletes the first event with everything in it', async () => {
      // The PIN unlock saved the organizer link in this browser.
      await page.goto(`/#/event/${eventId}/manage`)
      await expect(page.getByRole('heading', { level: 1, name: input.event })).toBeVisible()
      await page.getByRole('button', { name: t('manage.deleteEvent') }).click()
      await toast(t('manage.eventDeleted'))
      await expect(page).toHaveURL(/#\/$/)
      expect(backend.db.events.map((event) => event.id)).not.toContain(eventId)
      expect(backend.db.attendees.filter((attendee) => attendee.event_id === eventId)).toEqual([])
      expect(backend.db.items.filter((item) => item.event_id === eventId)).toEqual([])
    })

    expect(backend.unexpected).toEqual([])
    expect(realSupabaseRequests).toEqual([])
    expect(pageErrors).toEqual([])
  })
}
