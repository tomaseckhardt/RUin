import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate, useParams } from 'react-router-dom'
import AttendeeList from '../components/AttendeeList.jsx'
import PageShell from '../components/PageShell.jsx'
import { getEvent, submitRsvp, unlockManageWithPin } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'

async function fetchEventPayload(id) {
  return getEvent(id)
}

function EventPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [payload, setPayload] = useState(null)
  const [name, setName] = useState('')
  const [excuseReason, setExcuseReason] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('confirmed')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isUnlockingManage, setIsUnlockingManage] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [managePin, setManagePin] = useState('')
  const [error, setError] = useState('')

  async function loadEvent() {
    try {
      const nextPayload = await fetchEventPayload(id)
      setPayload(nextPayload)
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function hydrateEvent() {
      try {
        const nextPayload = await fetchEventPayload(id)

        if (cancelled) {
          return
        }

        setPayload(nextPayload)
        setError('')
      } catch (loadError) {
        if (cancelled) {
          return
        }

        setError(loadError.message)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    hydrateEvent()

    return () => {
      cancelled = true
    }
  }, [id])

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      await submitRsvp(id, {
        name,
        status: selectedStatus,
        excuseReason,
      })

      toast.success(
        selectedStatus === 'confirmed'
          ? 'Máš potvrzeno. Těšíme se na tebe.'
          : 'Omluvenka byla odeslaná.',
      )
      setExcuseReason('')
      await loadEvent()
    } catch (submitError) {
      toast.error(submitError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  async function copyInviteLink() {
    await navigator.clipboard.writeText(buildAbsoluteUrl(`/event/${id}`))
    toast.success('Pozvánka zkopírovaná do schránky.')
  }

  function openManageModal() {
    setManagePin('')
    setShowManageModal(true)
  }

  function closeManageModal() {
    if (isUnlockingManage) {
      return
    }

    setShowManageModal(false)
    setManagePin('')
  }

  async function handleUnlockManage(event) {
    event.preventDefault()
    setIsUnlockingManage(true)

    try {
      const payload = await unlockManageWithPin(id, managePin)
      toast.success('Správa odemčená.')
      setShowManageModal(false)
      setManagePin('')
      navigate(payload.organizerPath)
    } catch (unlockError) {
      toast.error(unlockError.message)
    } finally {
      setIsUnlockingManage(false)
    }
  }

  if (isLoading) {
    return (
      <PageShell eyebrow="Veřejná pozvánka" title="Načítám akci…" subtitle="Chvilka, lovím data z databáze." />
    )
  }

  if (error || !payload) {
    return (
      <PageShell eyebrow="Veřejná pozvánka" title="Akci se nepodařilo najít" subtitle={error || 'Tenhle odkaz už nic nevrací.'} />
    )
  }

  const { event, attendees, summary } = payload

  return (
    <PageShell
      eyebrow="live invite page"
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <>
          <button type="button" className="secondary-button" onClick={copyInviteLink}>
            Sdílet pozvánku
          </button>
          <button type="button" className="secondary-button" onClick={openManageModal}>
            Spravovat akci
          </button>
        </>
      }
    >
      <main className="space-y-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
          <article className="panel relative overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(135deg,rgba(122,28,63,0.14),rgba(111,76,255,0.1))] dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.26),rgba(111,76,255,0.16))]" />
            <div className="relative">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.25em]">Co se chystá</p>
              <p className="mt-3 max-w-3xl text-lg leading-8 text-slate-700 dark:text-slate-300">{event.description}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="surface-subtle">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Rychlá odpověď</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Stačí jméno a jeden klik.</p>
                </div>
                <div className="surface-subtle">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Všechno přehledně</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Potvrzení i omluvenky jsou na jednom místě.</p>
                </div>
                <div className="surface-subtle sm:col-span-2 xl:col-span-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Žádný login</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Lidi nepřemýšlí, jen kliknou a odešlou.</p>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="stat-tile">
                  <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">Dorazí</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">{summary.confirmed}</div>
                </div>
                <div className="stat-tile">
                  <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">Omluvenky</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">{summary.excused}</div>
                </div>
                <div className="stat-tile">
                  <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">Rejected</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">{summary.rejected}</div>
                </div>
              </div>
            </div>
          </article>

          <aside className="panel h-fit xl:sticky xl:top-6">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
              Odpověz organizátorovi
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">Přijdeš, nebo ghostíš?</h2>
            <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Tvoje jméno</label>
              <input
                className="field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Třeba Viki"
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                className={`rounded-[1.75rem] border px-4 py-4 text-left transition ${selectedStatus === 'confirmed' ? 'border-fuchsia-300 bg-[linear-gradient(135deg,rgba(122,28,63,0.12),rgba(111,76,255,0.08))] text-slate-950 dark:border-fuchsia-500/60 dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.32),rgba(111,76,255,0.28))] dark:text-slate-50' : 'border-slate-200 bg-white/60 text-slate-700 hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300'}`}
                onClick={() => setSelectedStatus('confirmed')}
              >
                <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-100">
                  Potvrzuji účast
                </span>
                <span className="mt-2 block text-sm text-slate-500 dark:text-slate-200">Jdeš a chceš být v line-upu potvrzených.</span>
              </button>
              <button
                type="button"
                className={`rounded-[1.75rem] border px-4 py-4 text-left transition ${selectedStatus === 'excused' ? 'border-fuchsia-300 bg-[linear-gradient(135deg,rgba(122,28,63,0.12),rgba(111,76,255,0.08))] text-slate-950 dark:border-fuchsia-500/60 dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.32),rgba(111,76,255,0.28))] dark:text-slate-50' : 'border-slate-200 bg-white/60 text-slate-700 hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300'}`}
                onClick={() => setSelectedStatus('excused')}
              >
                <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-100">
                  Omlouvám se
                </span>
                <span className="mt-2 block text-sm text-slate-500 dark:text-slate-200">Můžeš přihodit důvod, pokud chceš znít důvěryhodně.</span>
              </button>
            </div>

            {selectedStatus === 'excused' ? (
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Důvod omluvy</label>
                <textarea
                  className="field min-h-28"
                  value={excuseReason}
                  onChange={(event) => setExcuseReason(event.target.value)}
                  placeholder="Nepovinné, ale často zábavné."
                />
              </div>
            ) : null}

            <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Odesílám odpověď…' : selectedStatus === 'confirmed' ? 'Potvrzuji účast' : 'Poslat omluvenku'}
            </button>
            </form>
          </aside>
        </section>

        <AttendeeList attendees={attendees} summary={summary} />

        {showManageModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-5">
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Správa akce</p>
                <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Zadej PIN</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                  Pro vstup do správy akce zadej 4místný správcovský PIN.
                </p>
              </div>

              <form className="space-y-4" onSubmit={handleUnlockManage}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Správcovský PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    className="field"
                    value={managePin}
                    onChange={(event) => setManagePin(event.target.value)}
                    placeholder="1234"
                    required
                    autoFocus
                  />
                </div>

                <div className="flex gap-3">
                  <button type="button" className="secondary-button flex-1 justify-center" onClick={closeManageModal}>
                    Zrušit
                  </button>
                  <button type="submit" className="primary-button flex-1" disabled={isUnlockingManage}>
                    {isUnlockingManage ? 'Ověřuji…' : 'Vstoupit'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}
      </main>
    </PageShell>
  )
}

export default EventPage