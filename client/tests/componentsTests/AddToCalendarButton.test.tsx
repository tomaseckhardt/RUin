import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddToCalendarButtonComponent from '../../src/components/AddToCalendarButton.jsx'
import { downloadBlob } from '../../src/lib/download.js'
import { t } from '../../src/lib/i18n.js'
import { withOptionalProps } from './withOptionalProps.ts'

const AddToCalendarButton = withOptionalProps(AddToCalendarButtonComponent)

jest.mock('../../src/lib/download.js', () => ({ downloadBlob: jest.fn() }))

const EVENT = { id: 'event-1', name: 'Grilovačka', location: 'Stromovka', description: 'Přineste deku.', datetime: '2026-07-01T18:30' }

let openWindow: jest.SpyInstance

beforeEach(() => {
  jest.clearAllMocks()
  openWindow = jest.spyOn(window, 'open').mockReturnValue({} as Window)
})

afterEach(() => {
  openWindow.mockRestore()
})

async function openMenu() {
  const user = userEvent.setup()
  render(<AddToCalendarButton eventData={EVENT} />)
  await user.click(screen.getByRole('button', { name: t('calendar.button') }))
  return user
}

describe('AddToCalendarButton', () => {
  it('opens a menu of calendars and focuses Google outside Apple devices', async () => {
    await openMenu()

    expect(screen.getByRole('button', { name: t('calendar.button') })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('list', { name: t('calendar.menuLabel') }).parentElement).toBe(document.body)
    for (const key of ['google', 'apple', 'outlook', 'download']) {
      expect(screen.getByRole('button', { name: t(`calendar.options.${key}`) })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: t('calendar.options.google') })).toHaveFocus()
  })

  it('opens Google Calendar at the Prague time and closes the menu', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('button', { name: t('calendar.options.google') }))

    const url = new URL(openWindow.mock.calls[0][0])
    expect(url.hostname).toBe('calendar.google.com')
    expect(url.searchParams.get('dates')).toBe('20260701T163000Z/20260701T193000Z')
    expect(url.searchParams.get('text')).toBe('Grilovačka')
    expect(screen.queryByRole('button', { name: t('calendar.options.google') })).not.toBeInTheDocument()
  })

  it('opens Outlook with the start and end time', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('button', { name: t('calendar.options.outlook') }))

    const url = new URL(openWindow.mock.calls[0][0])
    expect(url.hostname).toBe('outlook.live.com')
    expect(url.searchParams.get('startdt')).toBe('2026-07-01T16:30:00.000Z')
    expect(url.searchParams.get('enddt')).toBe('2026-07-01T19:30:00.000Z')
  })

  it('downloads an .ics file with a two-day reminder', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('button', { name: t('calendar.options.download') }))

    const [blob, fileName] = jest.mocked(downloadBlob).mock.calls[0] as [Blob, string]
    expect(fileName).toBe('grilovacka.ics')
    // jsdom's Blob has no text().
    const ics = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(ics).toContain('DTSTART:20260701T163000Z')
    expect(ics).toContain('TRIGGER:-P2D')
  })

  it('closes with Escape without opening anything', async () => {
    const user = await openMenu()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('button', { name: t('calendar.options.google') })).not.toBeInTheDocument()
    expect(openWindow).not.toHaveBeenCalled()
  })
})
