import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import PageShell from '../components/PageShell.jsx'
import { finalizePoll, getPollPayload, votePoll } from '../lib/api.js'
import { formatDateTime } from '../lib/format.js'

function PollPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const [payload, setPayload] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [voterName, setVoterName] = useState('')
  const [selectedOptionId, setSelectedOptionId] = useState(null)
  const [isVoting, setIsVoting] = useState(false)
  const [finalizingOptionId, setFinalizingOptionId] = useState(null)
  const [organizerPin, setOrganizerPin] = useState('')
  const [isFinalizing, setIsFinalizing] = useState(false)

  async function loadPoll() {
    try {
      const data = await getPollPayload(id, token)
      setPayload(data)
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadPoll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token])

  async function handleVote(event) {
    event.preventDefault()

    if (!voterName.trim() || !selectedOptionId) {
      toast.error('Napiš jméno a vyber možnost.')
      return
    }

    setIsVoting(true)

    try {
      await votePoll(id, selectedOptionId, voterName)
      toast.success('Hlas uložen.')
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
      toast.success('Akce založena z ankety!')
      navigate(result.organizerPath)
    } catch (finalizeError) {
      toast.error(finalizeError.message)
    } finally {
      setIsFinalizing(false)
    }
  }

  if (isLoading) {
    return <PageShell eyebrow="Anketa" title="Načítám anketu…" subtitle="Chvilka." />
  }

  if (error || !payload) {
    return <PageShell eyebrow="Anketa" title="Anketu se nepodařilo najít" subtitle={error || 'Tenhle odkaz už nic nevrací.'} />
  }

  const { poll, options, isCreator } = payload

  if (poll.finalizedEventId) {
    return (
      <PageShell eyebrow="Anketa" title={poll.name} subtitle="Anketa už byla vyhodnocená.">
        <main className="grid gap-6">
          <section className="panel">
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              Termín byl vybraný a akce je založená.
            </p>
            <a className="primary-button mt-4 inline-flex" href={`#/event/${poll.finalizedEventId}`}>
              Otevřít pozvánku
            </a>
          </section>
        </main>
      </PageShell>
    )
  }

  return (
    <PageShell eyebrow={isCreator ? 'anketa · vyhodnocení' : 'anketa · hlasování'} title={poll.name} subtitle={poll.description || `Založil/a ${poll.creatorName}`}>
      <main className="grid gap-6">
        <section className="panel">
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Možnosti</p>
          <div className="mt-4 space-y-3">
            {options.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer flex-col gap-2 rounded-2xl border p-4 transition sm:flex-row sm:items-center sm:justify-between ${selectedOptionId === option.id ? 'border-fuchsia-300 bg-fuchsia-50/60 dark:border-fuchsia-500/60 dark:bg-fuchsia-950/20' : 'border-slate-200 dark:border-slate-700'}`}
              >
                <div className="flex items-center gap-3">
                  {!isCreator ? (
                    <input
                      type="radio"
                      name="poll-option"
                      className="h-4 w-4 accent-fuchsia-600"
                      checked={selectedOptionId === option.id}
                      onChange={() => setSelectedOptionId(option.id)}
                    />
                  ) : null}
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{formatDateTime(option.datetime)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{option.location}{option.note ? ` · ${option.note}` : ''}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="status-chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {option.votes.length} {option.votes.length === 1 ? 'hlas' : 'hlasů'}
                  </span>
                  {option.votes.length > 0 ? (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{option.votes.join(', ')}</span>
                  ) : null}
                  {isCreator ? (
                    <button
                      type="button"
                      className="secondary-button px-3 py-1.5 text-xs"
                      onClick={() => setFinalizingOptionId(option.id)}
                    >
                      Vybrat
                    </button>
                  ) : null}
                </div>
              </label>
            ))}
          </div>
        </section>

        {!isCreator ? (
          <form className="panel space-y-4" onSubmit={handleVote}>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Tvoje jméno</label>
              <input className="field" value={voterName} onChange={(event) => setVoterName(event.target.value)} placeholder="Třeba Viki" required />
            </div>
            <button type="submit" className="primary-button w-full" disabled={isVoting}>
              {isVoting ? 'Ukládám hlas…' : 'Hlasovat'}
            </button>
          </form>
        ) : null}

        {isCreator && finalizingOptionId ? (
          <form className="panel space-y-4" onSubmit={handleFinalize}>
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Vyhodnotit anketu</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Tohle vytvoří ostrou akci z vybrané možnosti a anketu uzavře. Nastav správcovský PIN pro tu novou akci.
            </p>
            <input
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
              {isFinalizing ? 'Zakládám akci…' : 'Finalizovat a založit akci'}
            </button>
          </form>
        ) : null}
      </main>
    </PageShell>
  )
}

export default PollPage
