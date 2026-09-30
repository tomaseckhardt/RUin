import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import PollPage from '../../src/pages/PollPage.jsx'
import { finalizePoll, getPollPayload, votePoll } from '../../src/lib/api.js'
import { t } from '../../src/lib/i18n.js'
import { getSavedPollCreatorToken } from '../../src/lib/pollCreatorStorage.js'

jest.mock('../../src/lib/api.js', () => ({
  finalizePoll: jest.fn(),
  getPollPayload: jest.fn(),
  votePoll: jest.fn(),
}))

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}))

const AUTO_REFRESH_MS = 10000

function pollPayload({ isCreator = false, votes = [] as string[] } = {}) {
  return {
    isCreator,
    poll: { name: 'Kdy na hokej?', description: '', creatorName: 'Eva', finalizedEventId: null },
    options: [
      { id: 1, datetime: '2026-11-06T18:00', location: 'Zimní stadion', note: null, votes },
      { id: 2, datetime: '2026-11-07T18:00', location: 'Hokejová hala', note: null, votes: [] },
    ],
  }
}

// Every location the router lands on, so a test can count navigations.
let locations: string[] = []

function LocationSpy() {
  const location = useLocation()

  useEffect(() => {
    locations.push(`${location.pathname}${location.search}`)
  }, [location])

  return null
}

function renderPoll(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationSpy />
      <Routes>
        <Route path="/poll/:id" element={<PollPage />} />
        <Route path="/event/:id/manage" element={<p>Správa akce</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  jest.clearAllMocks()
  locations = []
  window.localStorage.removeItem('ruin-poll-creator-tokens')
  window.localStorage.removeItem('ruin-poll-voter:poll-1')
})

describe('PollPage creator link', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('saves the token, drops it from the address bar once, and keeps refreshing with it', async () => {
    jest.mocked(getPollPayload).mockResolvedValue(pollPayload({ isCreator: true }))

    renderPoll('/poll/poll-1?token=creator-token')

    expect(await screen.findByText(t('poll.creatorEyebrow'))).toBeInTheDocument()
    await waitFor(() => expect(locations.at(-1)).toBe('/poll/poll-1'))
    expect(getSavedPollCreatorToken('poll-1')).toBe('creator-token')

    await act(async () => {
      jest.advanceTimersByTime(AUTO_REFRESH_MS * 2)
    })

    expect(locations).toEqual(['/poll/poll-1?token=creator-token', '/poll/poll-1'])
    // The first load plus one per refresh - dropping the token reloads nothing.
    expect(getPollPayload).toHaveBeenCalledTimes(3)
    expect(getPollPayload).toHaveBeenLastCalledWith('poll-1', 'creator-token')
  })

  it('drops a token that is not the creator’s without saving it', async () => {
    jest.mocked(getPollPayload).mockResolvedValue(pollPayload())

    renderPoll('/poll/poll-1?token=someone-elses')

    await waitFor(() => expect(locations.at(-1)).toBe('/poll/poll-1'))
    expect(getSavedPollCreatorToken('poll-1')).toBe('')
  })
})

describe('PollPage voting', () => {
  it('votes for the picked option under the typed name and remembers the name', async () => {
    const user = userEvent.setup()
    jest.mocked(getPollPayload).mockResolvedValue(pollPayload())
    jest.mocked(votePoll).mockResolvedValue({ success: true })

    renderPoll('/poll/poll-1')

    await user.type(await screen.findByLabelText(t('common.yourName')), 'Karel')
    await user.click(screen.getAllByRole('radio')[1])
    await user.click(screen.getByRole('button', { name: t('poll.vote') }))

    expect(votePoll).toHaveBeenCalledWith('poll-1', 2, 'Karel')
    expect(window.localStorage.getItem('ruin-poll-voter:poll-1')).toBe('Karel')
  })

  it('preselects the remembered voter’s existing vote, whatever its case', async () => {
    window.localStorage.setItem('ruin-poll-voter:poll-1', 'karel')
    jest.mocked(getPollPayload).mockResolvedValue(pollPayload({ votes: ['Karel'] }))

    renderPoll('/poll/poll-1')

    expect(await screen.findByRole('button', { name: t('poll.changeVote') })).toBeInTheDocument()
    expect(screen.getAllByRole('radio')[0]).toBeChecked()
  })

  it('asks for a name and an option before voting', async () => {
    const user = userEvent.setup()
    jest.mocked(getPollPayload).mockResolvedValue(pollPayload())

    renderPoll('/poll/poll-1')

    await user.type(await screen.findByLabelText(t('common.yourName')), 'Karel')
    await user.click(screen.getByRole('button', { name: t('poll.vote') }))

    expect(toast.error).toHaveBeenCalledWith(t('poll.nameAndOptionRequired'))
    expect(votePoll).not.toHaveBeenCalled()
  })

  it('keeps the fresh result after a vote when an older refresh answers late', async () => {
    jest.useFakeTimers()
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime })
    let answerRefresh: (payload: ReturnType<typeof pollPayload>) => void = () => {}
    jest
      .mocked(getPollPayload)
      .mockResolvedValueOnce(pollPayload())
      .mockReturnValueOnce(new Promise((resolve) => (answerRefresh = resolve)))
      .mockResolvedValueOnce(pollPayload({ votes: ['Karel'] }))
    jest.mocked(votePoll).mockResolvedValue({ success: true })

    try {
      renderPoll('/poll/poll-1')
      await user.type(await screen.findByLabelText(t('common.yourName')), 'Karel')
      await user.click(screen.getAllByRole('radio')[0])

      // The refresh starts and hangs; the vote's own reload answers first.
      await act(async () => {
        jest.advanceTimersByTime(AUTO_REFRESH_MS)
      })
      await user.click(screen.getByRole('button', { name: t('poll.vote') }))
      expect(await screen.findByText(t('poll.votes', { count: 1 }))).toBeInTheDocument()

      await act(async () => {
        answerRefresh(pollPayload())
      })

      expect(screen.getByText(t('poll.votes', { count: 1 }))).toBeInTheDocument()
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('PollPage finalizing', () => {
  it('turns the picked option into an event with the creator token and PIN', async () => {
    const user = userEvent.setup()
    window.localStorage.setItem('ruin-poll-creator-tokens', JSON.stringify({ 'poll-1': 'creator-token' }))
    jest.mocked(getPollPayload).mockResolvedValue(pollPayload({ isCreator: true }))
    jest.mocked(finalizePoll).mockResolvedValue({ organizerPath: '/event/event-1/manage' })

    renderPoll('/poll/poll-1')

    await user.click((await screen.findAllByRole('button', { name: t('poll.pick') }))[1])
    await user.type(screen.getByLabelText(t('pin.label')), '1234')
    await user.click(screen.getByRole('button', { name: t('poll.finalize') }))

    expect(finalizePoll).toHaveBeenCalledWith('poll-1', 'creator-token', 2, '1234', '')
    expect(await screen.findByText('Správa akce')).toBeInTheDocument()
  })
})
