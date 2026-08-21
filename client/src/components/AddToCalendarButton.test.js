import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { toast } from 'sonner'
import AddToCalendarButton from './AddToCalendarButton.jsx'

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

function eventData(overrides = {}) {
  return {
    id: 'event-1',
    name: 'Grill párty',
    location: 'Chata u lesa',
    description: 'Vezmi si karimatku.',
    datetime: '2026-08-21T18:00:00',
    ...overrides,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')
  global.URL.revokeObjectURL = jest.fn()
})

test('renders nothing without a datetime', () => {
  const { container } = render(<AddToCalendarButton eventData={{ name: 'No date' }} />)
  expect(container).toBeEmptyDOMElement()
})

test('opens a menu with Google Calendar and system calendar options', async () => {
  const user = userEvent.setup()
  render(<AddToCalendarButton eventData={eventData()} />)

  expect(screen.queryByText('Google Calendar')).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Přidat do kalendáře' }))

  const googleLink = screen.getByRole('link', { name: 'Google Calendar' })
  expect(googleLink).toHaveAttribute('target', '_blank')
  expect(googleLink.href).toContain('https://calendar.google.com/calendar/render')
  expect(googleLink.href).toContain('dates=20260821T160000Z')

  expect(screen.getByRole('button', { name: 'Systémový kalendář (.ics)' })).toBeInTheDocument()
})

test('closes the menu when clicking outside', async () => {
  const user = userEvent.setup()
  render(
    <div>
      <AddToCalendarButton eventData={eventData()} />
      <button type="button">Elsewhere</button>
    </div>,
  )

  await user.click(screen.getByRole('button', { name: 'Přidat do kalendáře' }))
  expect(screen.getByRole('link', { name: 'Google Calendar' })).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
  expect(screen.queryByRole('link', { name: 'Google Calendar' })).not.toBeInTheDocument()
})

test('downloading the .ics closes the menu and shows a success toast', async () => {
  const user = userEvent.setup()
  render(<AddToCalendarButton eventData={eventData()} />)

  await user.click(screen.getByRole('button', { name: 'Přidat do kalendáře' }))
  await user.click(screen.getByRole('button', { name: 'Systémový kalendář (.ics)' }))

  await waitFor(() => expect(toast.success).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Systémový kalendář (.ics)' })).not.toBeInTheDocument()
})
