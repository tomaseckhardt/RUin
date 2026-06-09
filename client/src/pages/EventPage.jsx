import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate, useParams } from 'react-router-dom'
import AttendeeList from '../components/AttendeeList.jsx'
import AddToCalendarButton from '../components/AddToCalendarButton.jsx'
import EventChat from '../components/EventChat.jsx'
import PageShell from '../components/PageShell.jsx'
import { getEvent, pingAttendee, submitRsvp, unlockManageWithPin } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'
import { supabase } from '../lib/supabase.js'

const AUTO_REFRESH_MS = 10000
const IDENTITY_STORAGE_PREFIX = 'ruin-event-identity'
const PING_SEEN_STORAGE_PREFIX = 'ruin-event-last-seen-ping'

function normalizeName(value) {
  return value.trim().toLocaleLowerCase('cs-CZ')
}

function identityStorageKey(eventId) {
  return `${IDENTITY_STORAGE_PREFIX}:${eventId}`
}

function pingSeenStorageKey(eventId, attendeeName) {
  return `${PING_SEEN_STORAGE_PREFIX}:${eventId}:${normalizeName(attendeeName)}`
}

function statusLabel(status) {
  if (status === 'confirmed') {
    return 'Potvrzeno'
  }

  if (status === 'excused') {
    return 'Omluveno (čeká na posouzení)'
  }

  if (status === 'excused_accepted') {
    return 'Omluvenka přijatá'
  }

  if (status === 'excused_rejected') {
    return 'Omluvenka zamítnutá'
  }

  return 'Neznámý stav'
}

async function fetchEventPayload(id) {
  return getEvent(id)
}

function EventPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const initialIdentity = typeof window === 'undefined'
    ? ''
    : window.localStorage.getItem(identityStorageKey(id)) || ''
  const [payload, setPayload] = useState(null)
  const [name, setName] = useState(initialIdentity)
  const [phone, setPhone] = useState('')
  const [excuseReason, setExcuseReason] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('confirmed')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [sessionName, setSessionName] = useState(initialIdentity)
  const [isIdentityLocked, setIsIdentityLocked] = useState(Boolean(initialIdentity))
  const [pingBusyId, setPingBusyId] = useState(null)
  const [incomingPing, setIncomingPing] = useState(null)
  const [isUnlockingManage, setIsUnlockingManage] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [showOverviewModal, setShowOverviewModal] = useState(false)
  const [showPingModal, setShowPingModal] = useState(false)
  const [showPingComposerModal, setShowPingComposerModal] = useState(false)
  const [pingTargetId, setPingTargetId] = useState(null)
  const [pingMessageInput, setPingMessageInput] = useState('')
  const [managePin, setManagePin] = useState('')
  const [error, setError] = useState('')

  const maybeShowIncomingPing = useCallback((nextPayload, forcedSessionName = null) => {
    if (typeof window === 'undefined' || !nextPayload) {
      return
    }

    const activeName = forcedSessionName || (isIdentityLocked ? sessionName : '')

    if (!activeName) {
      return
    }

    const attendee = nextPayload.attendees.find(
      (item) => normalizeName(item.name) === normalizeName(activeName),
    )

    if (!attendee) {
      return
    }

    const lastPingAt = attendee.ping_last_created_at
    const lastPingSource = attendee.ping_last_source_name

    if (!lastPingAt || !lastPingSource) {
      return
    }

    const key = pingSeenStorageKey(id, activeName)
    const seenPingAt = window.localStorage.getItem(key)

    if (seenPingAt && new Date(lastPingAt).getTime() <= new Date(seenPingAt).getTime()) {
      return
    }

    setIncomingPing({
      sourceName: lastPingSource,
      message: attendee.ping_last_message,
    })
    setShowPingModal(true)
    window.localStorage.setItem(key, lastPingAt)
  }, [id, isIdentityLocked, sessionName])

  const loadEvent = useCallback(async (forcedSessionName = null) => {
    try {
      const nextPayload = await fetchEventPayload(id)
      setPayload(nextPayload)
      maybeShowIncomingPing(nextPayload, forcedSessionName)
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }, [id, maybeShowIncomingPing])

  useEffect(() => {
    let cancelled = false

    async function hydrateEvent() {
      try {
        const nextPayload = await fetchEventPayload(id)

        if (cancelled) {
          return
        }

        setPayload(nextPayload)
        maybeShowIncomingPing(nextPayload)
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
  }, [id, maybeShowIncomingPing])

  useEffect(() => {
    let refreshTimeout = null

    function scheduleRealtimeRefresh() {
      if (refreshTimeout) {
        return
      }

      refreshTimeout = setTimeout(() => {
        refreshTimeout = null
        loadEvent()
      }, 120)
    }

    const channel = supabase
      .channel(`event-live:${id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendee_pings',
          filter: `event_id=eq.${id}`,
        },
        scheduleRealtimeRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_realtime_ticks',
          filter: `event_id=eq.${id}`,
        },
        scheduleRealtimeRefresh,
      )
      .subscribe()

    return () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout)
      }

      supabase.removeChannel(channel)
    }
  }, [id, loadEvent])

  useEffect(() => {
    let cancelled = false
    let inFlight = false

    async function refreshEvent() {
      if (inFlight || document.visibilityState !== 'visible') {
        return
      }

      inFlight = true

      try {
        const nextPayload = await fetchEventPayload(id)

        if (cancelled) {
          return
        }

        setPayload(nextPayload)
        maybeShowIncomingPing(nextPayload)
        setError('')
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError.message)
        }
      } finally {
        inFlight = false
      }
    }

    const intervalId = setInterval(refreshEvent, AUTO_REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [id, maybeShowIncomingPing])

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      await submitRsvp(id, {
        name,
        status: selectedStatus,
        excuseReason,
        phone: phone.trim() || null,
      })

      toast.success(
        selectedStatus === 'confirmed'
          ? 'Máš potvrzeno. Těšíme se na tebe.'
          : 'Omluvenka byla odeslaná.',
      )

      const normalizedName = name.trim()
      window.localStorage.setItem(identityStorageKey(id), normalizedName)
      setSessionName(normalizedName)
      setName(normalizedName)
      setIsIdentityLocked(true)
      setExcuseReason('')
      setPhone('')
      await loadEvent(normalizedName)
    } catch (submitError) {
      toast.error(submitError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handlePing(attendeeId) {
    setPingTargetId(attendeeId)
    setPingMessageInput('')
    setShowPingComposerModal(true)
  }

  function closePingComposerModal() {
    if (pingBusyId !== null) {
      return
    }

    setShowPingComposerModal(false)
    setPingTargetId(null)
    setPingMessageInput('')
  }

  async function handleSubmitPing(event) {
    event.preventDefault()

    if (pingTargetId === null) {
      return
    }

    setPingBusyId(pingTargetId)

    try {
      await pingAttendee(id, pingTargetId, sessionName || name, pingMessageInput)
      toast.success('Šťouchnutí odeslané.')
      setShowPingComposerModal(false)
      setPingTargetId(null)
      setPingMessageInput('')
      await loadEvent()
    } catch (pingError) {
      toast.error(pingError.message)
    } finally {
      setPingBusyId(null)
    }
  }

  function handleResetIdentity() {
    if (typeof window !== 'undefined' && sessionName) {
      window.localStorage.removeItem(identityStorageKey(id))
      window.localStorage.removeItem(pingSeenStorageKey(id, sessionName))
    }

    setIsIdentityLocked(false)
    setSessionName('')
    setName('')
    setSelectedStatus('confirmed')
    setExcuseReason('')
  }

  function closePingModal() {
    setShowPingModal(false)
    setIncomingPing(null)
  }

  async function copyInviteLink() {
    const url = buildAbsoluteUrl(`/event/${id}`)

    if (navigator.share) {
      try {
        await navigator.share({
          title: payload?.event?.name || 'R U in?',
          text: `Jsi na akci? ${payload?.event?.name || ''}`,
          url,
        })
        return
      } catch (shareError) {
        if (shareError?.name === 'AbortError') {
          return
        }
      }
    }

    await navigator.clipboard.writeText(url)
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
      const response = await unlockManageWithPin(id, managePin)
      toast.success('Správa odemčená.')
      setShowManageModal(false)
      setManagePin('')
      navigate(response.organizerPath)
    } catch (unlockError) {
      toast.error(unlockError.message)
    } finally {
      setIsUnlockingManage(false)
    }
  }

  const sessionAttendee = isIdentityLocked && payload
    ? payload.attendees.find((attendee) => normalizeName(attendee.name) === normalizeName(sessionName))
    : null

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
          <AddToCalendarButton eventData={event} />
          <button type="button" className="secondary-button" onClick={() => setShowOverviewModal(true)}>
            Přehled
          </button>
          <button type="button" className="secondary-button" onClick={copyInviteLink}>
            Sdílet pozvánku
          </button>
          <button type="button" className="secondary-button" onClick={openManageModal}>
            Spravovat akci
          </button>
        </>
      }
    >
      <main className="grid gap-6">
        <section className="panel relative order-1 overflow-hidden">
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
        </section>

        <section className="panel order-2 lg:order-4">
          {!isIdentityLocked ? (
            <>
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

                {event.requirePhone ? (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Telefonní číslo</label>
                    <input
                      type="tel"
                      className="field"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+420 123 456 789"
                      required
                    />
                  </div>
                ) : null}

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
            </>
          ) : (
            <>
              <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Jsi přihlášený</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">{sessionName}</h2>
              <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                Docházka je navázaná na tvoje jméno v této session.
                {sessionAttendee ? ` Aktuální stav: ${statusLabel(sessionAttendee.status)}.` : ' Načítám tvůj aktuální stav…'}
              </p>
              <button type="button" className="secondary-button mt-5 w-full" onClick={handleResetIdentity}>
                Nejsem to já
              </button>
            </>
          )}
        </section>

        <div className="order-3 lg:order-2">
          <AttendeeList
            attendees={attendees}
            summary={summary}
            showPing
            onPing={handlePing}
            pingBusyId={pingBusyId}
            canPing={Boolean(name.trim())}
            currentName={sessionName || name}
          />
        </div>

        <div className="order-4 lg:order-3">
          <EventChat
            eventId={id}
            currentName={sessionName}
            canSend={isIdentityLocked && Boolean(sessionName.trim())}
          />
        </div>

        {showManageModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
              <div className="mb-5">
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Správa akce</p>
                <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Zadej PIN</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Pro vstup do správy akce zadej 4místný správcovský PIN.</p>
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

        {showPingModal && incomingPing ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Někdo tě šťouchl</p>
              <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
                {incomingPing.sourceName}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {incomingPing.message ? `Vzkaz: ${incomingPing.message}` : 'Poslal ti šťouchnutí bez zprávy.'}
              </p>
              <button type="button" className="primary-button mt-6 w-full" onClick={closePingModal}>
                Rozumím
              </button>
            </div>
          </section>
        ) : null}

        {showPingComposerModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Šťouchnout účastníka</p>
              <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Přidej zprávu</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Nepovinné. Když nic nenapíšeš, odešle se jen šťouchnutí.</p>

              <form className="mt-4 space-y-4" onSubmit={handleSubmitPing}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Zpráva</label>
                  <textarea
                    className="field min-h-24"
                    value={pingMessageInput}
                    onChange={(event) => setPingMessageInput(event.target.value.slice(0, 280))}
                    placeholder="Hej, pojď s náma!"
                    disabled={pingBusyId !== null}
                    autoFocus
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Zbývá {280 - pingMessageInput.length} znaků</p>
                </div>

                <div className="flex gap-3">
                  <button type="button" className="secondary-button flex-1 justify-center" onClick={closePingComposerModal}>
                    Zrušit
                  </button>
                  <button type="submit" className="primary-button flex-1" disabled={pingBusyId !== null}>
                    {pingBusyId !== null ? 'Šťouchám…' : 'Odeslat'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {showOverviewModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-lg sm:rounded-[1.75rem] sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Přehled</p>
                  <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">{event.name}</h3>
                </div>
                <button
                  type="button"
                  className="secondary-button shrink-0"
                  onClick={() => setShowOverviewModal(false)}
                >
                  Zavřít
                </button>
              </div>

              <div className="space-y-5 max-h-[60vh] overflow-y-auto">
                {['confirmed', 'excused', 'excused_accepted', 'excused_rejected'].map((statusGroup) => {
                  const group = attendees.filter((a) => a.status === statusGroup)
                  if (group.length === 0) return null
                  const labels = {
                    confirmed: '✅ Přijdou',
                    excused: '⏳ Omluvenky (čeká)',
                    excused_accepted: '❌ Omluvenka přijatá',
                    excused_rejected: '⚪ Omluvenka zamítnutá',
                  }
                  return (
                    <div key={statusGroup}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        {labels[statusGroup]} ({group.length})
                      </p>
                      <ul className="space-y-2">
                        {group.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </PageShell>
  )
}

export default EventPage