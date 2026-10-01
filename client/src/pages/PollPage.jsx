import { useEffect, useId, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PageShell from '../components/PageShell.jsx'
import { finalizePoll, getPollPayload, votePoll } from '../lib/api.js'
import { readStoredValue, writeStoredValue } from '../lib/browserStorage.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'
import { useI18n } from '../lib/i18n.js'
import { normalizeName } from '../lib/normalizeName.js'
import { getSavedPollCreatorToken, savePollCreatorToken } from '../lib/pollCreatorStorage.js'

const VOTER_STORAGE_PREFIX = 'ruin-poll-voter'
// Keeps the counts fresh while the creator decides.
const AUTO_REFRESH_MS = 10000
const REFRESH_ERROR_TOAST_ID = 'poll-refresh-error'

function voterStorageKey(pollId) {
  return `${VOTER_STORAGE_PREFIX}:${pollId}`
}

function PollPage() {
  const { t } = useI18n()
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlToken = searchParams.get('token') || ''
  // A creator link's token is saved and dropped from the address bar (see
  // the effect below loadPoll), so the poll's URL can be shared with voters as-is.
  const token = urlToken || getSavedPollCreatorToken(id) || null
  const fieldId = useId()
  const hasLoadedOnceRef = useRef(false)
  const latestRequestIdRef = useRef(0)
  const [payload, setPayload] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [voterName, setVoterName] = useState(() => readStoredValue(voterStorageKey(id)) || '')
  const [pickedOptionId, setPickedOptionId] = useState(null)
  const [isVoting, setIsVoting] = useState(false)
  const [finalizingOptionId, setFinalizingOptionId] = useState(null)
  const [organizerPin, setOrganizerPin] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)

  async function loadPoll() {
    // A refresh that answers after a newer load (the one after a vote) is dropped.
    const requestId = ++latestRequestIdRef.current

    try {
      const data = await getPollPayload(id, token)

      if (requestId !== latestRequestIdRef.current) {
        return
      }

      setPayload(data)
      hasLoadedOnceRef.current = true
      setError('')
    } catch (loadError) {
      if (requestId !== latestRequestIdRef.current) {
        return
      }

      if (hasLoadedOnceRef.current) {
        toast.error(loadError.message, { id: REFRESH_ERROR_TOAST_ID })
      } else {
        setError(loadError.message)
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Fetch on mount and id/token change, then poll - there are no realtime
    // ticks for polls.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPoll()
    const intervalId = setInterval(() => document.visibilityState === 'visible' && loadPoll(), AUTO_REFRESH_MS)
    return () => clearInterval(intervalId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token])

  // Once the first payload says whose token it is, save a creator's and drop
  // it from the URL. Its own effect: the refresh interval above keeps the
  // first render's loadPoll, which would still see the URL token.
  useEffect(() => {
    if (!urlToken || !payload) {
      return
    }

    if (payload.isCreator) {
      savePollCreatorToken(id, urlToken)
    }

    navigate(`/poll/${id}`, { replace: true })
  }, [id, urlToken, payload, navigate])

  async function handleCopyVoteLink() {
    try {
      await navigator.clipboard.writeText(buildAbsoluteUrl(`/poll/${id}`))
      toast.success(t('poll.voteLinkCopied'))
    } catch {
      toast.error(t('share.copyFailed'))
    }
  }

  const normalizedVoterName = voterName.trim() ? normalizeName(voterName) : ''
  const myExistingVoteOption =
    payload && normalizedVoterName
      ? payload.options.find((option) => option.votes.some((voterEntry) => normalizeName(voterEntry) === normalizedVoterName))
      : null

  // Until the voter picks an option, their existing vote is preselected.
  const chosenId = pickedOptionId ?? myExistingVoteOption?.id ?? null

  async function handleVote(event) {
    event.preventDefault()

    if (!voterName.trim() || !chosenId) {
      toast.error(t('poll.nameAndOptionRequired'))
      return
    }

    setIsVoting(true)

    try {
      await votePoll(id, chosenId, voterName)
      writeStoredValue(voterStorageKey(id), voterName.trim())
      toast.success(t('poll.voteSaved'))
      await loadPoll()
    } catch (voteError) {
      toast.error(voteError.message)
    } finally {
      setIsVoting(false)
    }
  }

  async function handleFinalize(event) {
    event.preventDefault()

    if (!finalizingOptionId) {
      return
    }

    setIsFinalizing(true)

    try {
      const result = await finalizePoll(id, token, finalizingOptionId, organizerPin, payload?.poll?.description)
      toast.success(t('poll.eventCreated'))
      navigate(result.organizerPath)
    } catch (finalizeError) {
      toast.error(finalizeError.message)
    } finally {
      setIsFinalizing(false)
    }
  }

  if (isLoading) {
    return <PageShell eyebrow={t('poll.eyebrow')} title={t('poll.loadingTitle')} subtitle={t('poll.loadingSubtitle')} />
  }

  if (error || !payload) {
    return <PageShell eyebrow={t('poll.eyebrow')} title={t('poll.notFoundTitle')} subtitle={error || t('common.linkGone')} />
  }

  const { poll, options, isCreator } = payload
  const chosenOption = finalizingOptionId ? options.find((option) => option.id === finalizingOptionId) : null

  if (poll.finalizedEventId) {
    return (
      <PageShell eyebrow={t('poll.eyebrow')} title={poll.name} subtitle={t('poll.finalizedSubtitle')}>
        <main className="grid gap-6">
          <section className="panel">
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t('poll.finalizedText')}</p>
            <a className="primary-button mt-4 inline-flex" href={`#/event/${poll.finalizedEventId}`}>
              {t('common.openInvite')}
            </a>
          </section>
        </main>
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow={isCreator ? t('poll.creatorEyebrow') : t('poll.voterEyebrow')}
      title={poll.name}
      subtitle={poll.description || t('poll.createdBy', { name: poll.creatorName })}>
      <main className="grid gap-6">
        {isCreator ? (
          <section className="panel">
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">{t('poll.shareHint')}</p>
            <button type="button" className="primary-button mt-4 w-full" onClick={handleCopyVoteLink}>
              {t('poll.copyVoteLink')}
            </button>
          </section>
        ) : null}

        <section className="panel">
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('poll.options')}</p>
          <div className="mt-4 space-y-3">
            {options.map((option) => {
              const isHighlighted = isCreator ? finalizingOptionId === option.id : chosenId === option.id
              // A voter's option labels its radio. The creator's has a button
              // instead, which a <label> would name after the whole card.
              const OptionCard = isCreator ? 'div' : 'label'

              return (
                <OptionCard
                  key={option.id}
                  className={`flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition sm:flex-row sm:items-center sm:justify-between ${isHighlighted ? 'border-fuchsia-300 bg-fuchsia-50/60 dark:border-fuchsia-500/60 dark:bg-fuchsia-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
                  <div className="flex items-center gap-3">
                    {!isCreator ? (
                      <input
                        type="radio"
                        name="poll-option"
                        className="h-4 w-4 accent-fuchsia-600"
                        checked={chosenId === option.id}
                        onChange={() => setPickedOptionId(option.id)}
                      />
                    ) : null}
                    <div>
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formatDateTime(option.datetime)}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {option.location}
                        {option.note ? ` · ${option.note}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="status-chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {t('poll.votes', { count: option.votes.length })}
                    </span>
                    {option.votes.length > 0 ? <span className="text-xs text-slate-500 dark:text-slate-400">{option.votes.join(', ')}</span> : null}
                    {isCreator ? (
                      <button type="button" className="secondary-button px-3 py-1.5 text-xs" onClick={() => setFinalizingOptionId(option.id)}>
                        {t('poll.pick')}
                      </button>
                    ) : null}
                  </div>
                </OptionCard>
              )
            })}
          </div>
        </section>

        {!isCreator ? (
          <form className="panel space-y-4" onSubmit={handleVote}>
            <div>
              <label htmlFor={`${fieldId}-voter-name`} className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                {t('common.yourName')}
              </label>
              <input
                id={`${fieldId}-voter-name`}
                className="field"
                value={voterName}
                onChange={(event) => setVoterName(event.target.value)}
                placeholder={t('common.guestNamePlaceholder')}
                required
              />
            </div>
            {myExistingVoteOption ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('poll.currentVote', {
                  option: (
                    <strong>
                      {formatDateTime(myExistingVoteOption.datetime)} · {myExistingVoteOption.location}
                    </strong>
                  ),
                })}
              </p>
            ) : null}
            <button type="submit" className="primary-button w-full" disabled={isVoting}>
              {isVoting ? t('poll.savingVote') : myExistingVoteOption ? t('poll.changeVote') : t('poll.vote')}
            </button>
          </form>
        ) : null}

        {isCreator && finalizingOptionId ? (
          <form className="panel space-y-4" onSubmit={handleFinalize}>
            <div className="flex items-start justify-between gap-4">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('poll.finalizeTitle')}</p>
              <button
                type="button"
                className="text-xs text-slate-500 hover:underline dark:text-slate-400"
                onClick={() => setFinalizingOptionId(null)}>
                {t('poll.clearSelection')}
              </button>
            </div>
            {chosenOption ? (
              <div className="rounded-2xl border border-fuchsia-200 bg-fuchsia-50/60 p-3 text-sm dark:border-fuchsia-500/50 dark:bg-fuchsia-950/20">
                {t('poll.creatingFor', {
                  option: (
                    <strong>
                      {formatDateTime(chosenOption.datetime)} · {chosenOption.location}
                    </strong>
                  ),
                })}
              </div>
            ) : null}
            <p id={`${fieldId}-pin-hint`} className="text-sm text-slate-600 dark:text-slate-300">
              {t('poll.finalizeHint')}
            </p>
            <input
              aria-label={t('pin.label')}
              aria-describedby={`${fieldId}-pin-hint`}
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              className="field"
              value={organizerPin}
              onChange={(event) => setOrganizerPin(event.target.value)}
              placeholder="1234"
              required
            />
            <button type="submit" className="primary-button w-full" disabled={isFinalizing}>
              {isFinalizing ? t('createEvent.submitting') : t('poll.finalize')}
            </button>
          </form>
        ) : null}
      </main>
    </PageShell>
  )
}

export default PollPage
