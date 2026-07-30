import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SignupBoard from './SignupBoard.jsx'
import { claimSignupItem, getSignupItems, unclaimSignupItem } from '../lib/api.js'

jest.mock('../lib/api.js', () => ({
  addSignupItem: jest.fn(),
  claimSignupItem: jest.fn(),
  deleteSignupItem: jest.fn(),
  getSignupItems: jest.fn(),
  removeSignupClaim: jest.fn(),
  unclaimSignupItem: jest.fn(),
}))

jest.mock('../lib/realtimeTick.js', () => ({
  subscribeToEventTicks: jest.fn(() => () => {}),
}))

function bringItem({ claims = [], capacity = 2 } = {}) {
  return {
    id: 1,
    event_id: 'event-1',
    category: 'bring',
    label: 'Pivo',
    capacity,
    note: null,
    created_by: 'Organizátor',
    created_at: '2026-01-01T00:00:00Z',
    event_signup_claims: claims,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  claimSignupItem.mockResolvedValue({ success: true })
  unclaimSignupItem.mockResolvedValue({ success: true })
})

async function expandCard(user) {
  const toggle = await screen.findByRole('button', { expanded: false })
  await user.click(toggle)
}

describe('SignupBoard claim/unclaim flow', () => {
  it('lets an attendee claim an open item', async () => {
    const user = userEvent.setup()
    getSignupItems.mockResolvedValue([bringItem()])

    render(<SignupBoard eventId="event-1" category="bring" currentName="Alice" canInteract />)
    await expandCard(user)

    const claimButton = await screen.findByRole('button', { name: 'Přihlásit se' })
    await user.click(claimButton)

    await waitFor(() => {
      expect(claimSignupItem).toHaveBeenCalledWith(1, 'Alice')
    })
  })

  it('lets the claim owner unclaim their own claim', async () => {
    const user = userEvent.setup()
    getSignupItems.mockResolvedValue([
      bringItem({ claims: [{ id: 10, attendee_name: 'Alice', seats: 1 }] }),
    ])

    render(<SignupBoard eventId="event-1" category="bring" currentName="Alice" canInteract />)
    await expandCard(user)

    const unclaimButton = await screen.findByRole('button', { name: 'Odhlásit se' })
    await user.click(unclaimButton)

    await waitFor(() => {
      expect(unclaimSignupItem).toHaveBeenCalledWith(1, 'Alice')
    })
  })

  it('disables claiming once capacity is full for someone else', async () => {
    const user = userEvent.setup()
    getSignupItems.mockResolvedValue([
      bringItem({
        capacity: 1,
        claims: [{ id: 10, attendee_name: 'Bob', seats: 1 }],
      }),
    ])

    render(<SignupBoard eventId="event-1" category="bring" currentName="Alice" canInteract />)
    await expandCard(user)

    const fullButton = await screen.findByRole('button', { name: 'Obsazeno' })
    expect(fullButton).toBeDisabled()
    expect(claimSignupItem).not.toHaveBeenCalled()
  })
})
