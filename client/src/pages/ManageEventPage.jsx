import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AddToCalendarButton from '../components/AddToCalendarButton.jsx'
import AttendeeList from '../components/AttendeeList.jsx'
import EventChat from '../components/EventChat.jsx'
import EventDateTimePicker from '../components/EventDateTimePicker.jsx'
import ModalOverlay from '../components/ModalOverlay.jsx'
import PageShell from '../components/PageShell.jsx'
import ShareInviteModal from '../components/ShareInviteModal.jsx'
import WeatherWidget from '../components/WeatherWidget.jsx'
import EventStops from '../components/EventStops.jsx'
import SignupBoard from '../components/SignupBoard.jsx'
import PhotoGallery from '../components/PhotoGallery.jsx'
import { deleteAttendee, getEvent, getEventPhotos, moderateAttendee, pingAttendee, removeEvent, unlockManageWithPin, updateEvent } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime, parseLocalDateTime, toDateTimeLocalValue } from '../lib/format.js'
import { clearSavedOrganizerToken, getSavedOrganizerToken, saveOrganizerToken } from '../lib/organizerLinkStorage.js'
import { supabase } from '../lib/supabase.js'

const AUTO_REFRESH_MS = 10000
const REFRESH_ERROR_TOAST_ID = 'manage-event-refresh-error'

async function fetchEventPayload(id, organizerToken) {
  return getEvent(id, organizerToken)
}

function parseOrganizerTokenFromPath(path) {
  if (typeof path !== 'string' || !path) {
    return ''
  }

  try {
    const parsedUrl = new URL(path, window.location.origin)
    return parsedUrl.searchParams.get('token') || ''
  } catch {
    return ''
  }
}

function isInvalidOrganizerTokenError(message) {
  if (typeof message !== 'string') {
    return false
  }

  return message.includes('Neplatný organizátorský odkaz')
}

function ManageEventPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlToken = searchParams.get('token') || ''
  const [, refreshStoredToken] = useReducer((value) => value + 1, 0)
  const [payload, setPayload] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [pingBusyId, setPingBusyId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showOverviewModal, setShowOverviewModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showPingComposerModal, setShowPingComposerModal] = useState(false)
  const [pingTargetId, setPingTargetId] = useState(null)
  const [pingMessageInput, setPingMessageInput] = useState('')
  const [showEditEventModal, setShowEditEventModal] = useState(false)
  const [eventForm, setEventForm] = useState({ name: '', location: '', datetime: '' })
  const [isSavingEvent, setIsSavingEvent] = useState(false)
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [unlockHint, setUnlockHint] = useState('')
  const [managePin, setManagePin] = useState('')
  const [isUnlockingManage, setIsUnlockingManage] = useState(false)

  const inviteUrl = useMemo(() => buildAbsoluteUrl(`/event/${id}`), [id])
  const activeToken = urlToken || getSavedOrganizerToken(id)

  const hasLoadedOnceRef = useRef(false)
  const latestRequestIdRef = useRef(0)

  const loadEvent = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current

    try {
      const nextPayload = await fetchEventPayload(id, activeToken)

      if (requestId !== latestRequestIdRef.current) {
        return
      }

      setPayload(nextPayload)
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
  }, [id, activeToken])

  useEffect(() => {
    let cancelled = false

    async function hydrateEvent() {
      if (!activeToken) {
        if (!cancelled) {
          setUnlockHint('Pro vstup do správy akce zadej 4místný správcovský PIN.')
          setShowUnlockModal(true)
          setIsLoading(false)
        }

        return
      }

      const requestId = ++latestRequestIdRef.current

      try {
        const nextPayload = await fetchEventPayload(id, activeToken)

        if (cancelled || requestId !== latestRequestIdRef.current) {
          return
        }

        setPayload(nextPayload)
        hasLoadedOnceRef.current = true
        setError('')
        setShowUnlockModal(false)

        if (urlToken) {
          saveOrganizerToken(id, urlToken)
          navigate(`/event/${id}/manage`, { replace: true })
        }
      } catch (loadError) {
        if (cancelled || requestId !== latestRequestIdRef.current) {
          return
        }

        if (isInvalidOrganizerTokenError(loadError.message)) {
          clearSavedOrganizerToken(id)
          refreshStoredToken()
          setShowUnlockModal(true)
          setUnlockHint('Správa vyžaduje nové odemčení PINem.')
          return
        }

        if (hasLoadedOnceRef.current) {
          toast.error(loadError.message, { id: REFRESH_ERROR_TOAST_ID })
        } else {
          setError(loadError.message)
        }
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
  }, [activeToken, id, navigate, urlToken])

  useEffect(() => {
    if (!activeToken) {
      return undefined
    }

    let cancelled = false
    let inFlight = false

    async function refreshEvent() {
      if (inFlight || document.visibilityState !== 'visible') {
        return
      }

      inFlight = true
      const requestId = ++latestRequestIdRef.current

      try {
        const nextPayload = await fetchEventPayload(id, activeToken)

        if (cancelled || requestId !== latestRequestIdRef.current) {
          return
        }

        setPayload(nextPayload)
        hasLoadedOnceRef.current = true
        setError('')
      } catch (refreshError) {
        if (!cancelled && requestId === latestRequestIdRef.current) {
          if (hasLoadedOnceRef.current) {
            toast.error(refreshError.message, { id: REFRESH_ERROR_TOAST_ID })
          } else {
            setError(refreshError.message)
          }
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
  }, [activeToken, id])

  useEffect(() => {
    if (!activeToken) {
      return undefined
    }

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
      .channel(`manage-live:${id}`)
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
  }, [activeToken, id, loadEvent])

  async function handleModeration(attendeeId, status) {
    if (!activeToken) {
      setShowUnlockModal(true)
      toast.error('Správa vyžaduje odemčení PINem.')
      return
    }

    setBusyId(attendeeId)

    try {
      await moderateAttendee(id, attendeeId, { token: activeToken, status })
      toast.success(status === 'excused_accepted' ? 'Omluvenka schválená.' : 'Omluvenka zamítnutá.')
      await loadEvent()
    } catch (actionError) {
      toast.error(actionError.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete() {
    if (!activeToken) {
      setShowUnlockModal(true)
      toast.error('Správa vyžaduje odemčení PINem.')
      return
    }

    const confirmed = window.confirm('Opravdu chceš tuhle akci smazat? Tohle nejde vrátit zpět.')

    if (!confirmed) {
      return
    }

    setIsDeleting(true)

    try {
      const photos = await getEventPhotos(id).catch(() => [])

      if (photos.length > 0) {
        const { error: storageError } = await supabase.storage
          .from('event-photos')
          .remove(photos.map((photo) => photo.storage_path))

        if (storageError) {
          toast.warning('Fotky se nepodařilo smazat z úložiště, akce ale zmizí.')
        }
      }

      await removeEvent(id, activeToken)
      clearSavedOrganizerToken(id)
      toast.success('Akce byla smazaná.')
      navigate('/')
    } catch (actionError) {
      toast.error(actionError.message)
    } finally {
      setIsDeleting(false)
    }
  }

  function openEditEventModal() {
    if (!payload?.event) {
      return
    }

    const parsedDatetime = parseLocalDateTime(payload.event.datetime)

    setEventForm({
      name: payload.event.name || '',
      location: payload.event.location || '',
      datetime: parsedDatetime ? toDateTimeLocalValue(parsedDatetime) : '',
    })
    setShowEditEventModal(true)
  }

  function closeEditEventModal() {
    if (isSavingEvent) {
      return
    }

    setShowEditEventModal(false)
  }

  async function handleSubmitEventEdit(event) {
    event.preventDefault()

    if (!activeToken) {
      setShowEditEventModal(false)
      setShowUnlockModal(true)
      toast.error('Správa vyžaduje odemčení PINem.')
      return
    }

    if (!eventForm.datetime) {
      toast.error('Vyber datum a čas akce.')
      return
    }

    setIsSavingEvent(true)

    try {
      await updateEvent(id, {
        token: activeToken,
        name: eventForm.name,
        location: eventForm.location,
        datetime: eventForm.datetime,
      })
      toast.success('Detaily akce jsou upravené.')
      setShowEditEventModal(false)
      await loadEvent()
    } catch (updateError) {
      toast.error(updateError.message)
    } finally {
      setIsSavingEvent(false)
    }
  }

  async function handleDeleteAttendee(attendeeId, attendeeName) {
    if (!activeToken) {
      setShowUnlockModal(true)
      toast.error('Správa vyžaduje odemčení PINem.')
      return
    }

    const confirmed = window.confirm(`Opravdu chceš smazat účastníka ${attendeeName}?`)

    if (!confirmed) {
      return
    }

    setDeleteBusyId(attendeeId)

    try {
      await deleteAttendee(id, attendeeId, activeToken)
      toast.success('Účastník byl smazaný.')
      await loadEvent()
    } catch (deleteError) {
      toast.error(deleteError.message)
    } finally {
      setDeleteBusyId(null)
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
      await pingAttendee(id, pingTargetId, organizerName, pingMessageInput)
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

  function closeUnlockModal() {
    if (isUnlockingManage) {
      return
    }

    setShowUnlockModal(false)
    setManagePin('')
  }

  async function handleUnlockManage(event) {
    event.preventDefault()
    setIsUnlockingManage(true)

    try {
      const response = await unlockManageWithPin(id, managePin)
      const nextToken = parseOrganizerTokenFromPath(response.organizerPath)

      if (!nextToken) {
        throw new Error('Nepodařilo se uložit přihlášení organizátora.')
      }

      saveOrganizerToken(id, nextToken)
      refreshStoredToken()
      setShowUnlockModal(false)
      setManagePin('')
      setError('')
      setUnlockHint('')
      toast.success('Správa odemčená. Přihlášení je uložené pro příště.')
      await loadEvent()
    } catch (unlockError) {
      toast.error(unlockError.message)
    } finally {
      setIsUnlockingManage(false)
    }
  }

  if (isLoading) {
    return (
      <PageShell eyebrow="Organizátor" title="Načítám přehled akce…" subtitle="Chvilka, sbírám všechna RSVP na jedno místo." />
    )
  }

  if (showUnlockModal && !payload) {
    return (
      <PageShell
        eyebrow="Organizátor"
        title="Zadej PIN pro správu akce"
        subtitle={unlockHint || 'Pro vstup do správy akce zadej 4místný správcovský PIN.'}
      >
        <main className="grid gap-6">
          <section className="panel mx-auto w-full max-w-md">
            <form className="space-y-4" onSubmit={handleUnlockManage}>
              <div>
                <label
                  htmlFor="manage-pin-standalone"
                  className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  Správcovský PIN
                </label>
                <input
                  id="manage-pin-standalone"
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
              <button type="submit" className="primary-button w-full" disabled={isUnlockingManage}>
                {isUnlockingManage ? 'Ověřuji…' : 'Vstoupit'}
              </button>
            </form>
          </section>
        </main>
      </PageShell>
    )
  }

  if (error || !payload) {
    return (
      <PageShell eyebrow="Organizátor" title="Správa akce není dostupná" subtitle={error || 'Akce nebo odkaz už neexistuje.'} />
    )
  }

  const { event, attendees, summary } = payload
  const organizerName = event.organizerName || ''

  return (
    <PageShell
      eyebrow="host control room"
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <>
          <WeatherWidget location={event.location} datetime={event.datetime} compact />
          <AddToCalendarButton eventData={event} />
        </>
      }
    >
      <main className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <section className="panel order-0 xl:hidden">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Řídicí panel</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="stat-tile p-3 text-slate-900 dark:text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">Potvrzeno</div>
              <div className="mt-1 text-2xl font-black tracking-[-0.03em]">{summary.confirmed}</div>
            </div>
            <div className="stat-tile p-3 text-slate-900 dark:text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">Čeká / oml.</div>
              <div className="mt-1 text-2xl font-black tracking-[-0.03em]">{summary.excused}</div>
            </div>
            <div className="stat-tile p-3 text-slate-900 dark:text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">Zamítnuto</div>
              <div className="mt-1 text-2xl font-black tracking-[-0.03em]">{summary.rejected}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              className="secondary-button w-full justify-center"
              onClick={openEditEventModal}
            >
              Upravit akci
            </button>
            <button
              type="button"
              className="secondary-button w-full justify-center"
              onClick={() => setShowOverviewModal(true)}
            >
              Přehled
            </button>
            <button type="button" className="secondary-button w-full justify-center" onClick={() => setShowShareModal(true)}>
              Pozvánka
            </button>
            <button
              type="button"
              className="secondary-button w-full justify-center border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? 'Mažu akci…' : 'Smazat akci'}
            </button>
          </div>
        </section>

        <aside className="order-1 hidden space-y-6 xl:order-2 xl:block">
          <section className="panel">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
              Controls
            </p>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                className="secondary-button w-full justify-center"
                onClick={openEditEventModal}
              >
                Upravit akci
              </button>
              <button
                type="button"
                className="secondary-button w-full justify-center"
                onClick={() => setShowOverviewModal(true)}
              >
                Přehled
              </button>
              <button type="button" className="secondary-button w-full justify-center" onClick={() => setShowShareModal(true)}>
                Pozvánka
              </button>
              <button
                type="button"
                className="secondary-button w-full justify-center border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Mažu akci…' : 'Smazat akci'}
              </button>
            </div>
          </section>
        </aside>

        <div className="order-2 xl:order-3 xl:col-span-2">
          <AttendeeList
            attendees={attendees}
            summary={summary}
            showModeration
            onModerate={handleModeration}
            busyId={busyId}
            showPing
            onPing={handlePing}
            pingBusyId={pingBusyId}
            canPing={Boolean(organizerName.trim())}
            currentName={organizerName}
            showDelete
            onDelete={handleDeleteAttendee}
            deleteBusyId={deleteBusyId}
            showPhone={Boolean(payload?.event?.requirePhone)}
          />
        </div>

        <div className="order-3 xl:order-4 xl:col-span-2">
          <EventChat
            eventId={id}
            currentName={organizerName}
            canSend={Boolean(organizerName.trim())}
          />
        </div>

        <div className="order-9 xl:order-5 xl:col-span-2">
          <EventStops eventId={id} isOrganizer organizerToken={activeToken} />
        </div>

        <div className="order-10 xl:order-6 xl:col-span-2">
          <SignupBoard eventId={id} category="bring" currentName={organizerName} canInteract={Boolean(organizerName.trim())} isOrganizer organizerToken={activeToken} />
        </div>

        <div className="order-11 xl:order-7 xl:col-span-2">
          <SignupBoard eventId={id} category="ride" currentName={organizerName} canInteract={Boolean(organizerName.trim())} isOrganizer organizerToken={activeToken} />
        </div>

        <div className="order-12 xl:order-8 xl:col-span-2">
          <PhotoGallery eventId={id} currentName={organizerName} isOrganizer organizerToken={activeToken} />
        </div>

        <section className="panel order-5 xl:order-2 xl:col-start-2">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Soukromý odkaz</p>
          <p className="mt-3 break-all text-sm leading-6 text-slate-700 dark:text-slate-300">
            {buildAbsoluteUrl(`/event/${id}/manage${activeToken ? `?token=${activeToken}` : ''}`)}
          </p>
          <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
            Tenhle link si nech pro sebe. Právě on dovoluje schvalovat omluvenky a mazat akci.
          </p>
          <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
            Veřejná pozvánka: <Link className="font-medium text-slate-900 underline dark:text-slate-50" to={`/event/${id}`}>otevřít RSVP stránku</Link>
          </div>
        </section>

        <ShareInviteModal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          inviteUrl={inviteUrl}
          eventId={id}
          eventName={event.name}
          datetime={event.datetime}
        />

        <ModalOverlay open={showPingComposerModal} onClose={closePingComposerModal} labelledBy="manage-ping-composer-title">
          <div className="h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Šťouchnout účastníka</p>
            <h3 id="manage-ping-composer-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Přidej zprávu</h3>
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
        </ModalOverlay>

        <ModalOverlay open={showEditEventModal} onClose={closeEditEventModal} labelledBy="manage-edit-event-title">
          <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[1.75rem] sm:p-6">
            <div className="mb-5">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Upravit akci</p>
              <h3 id="manage-edit-event-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Změň základní údaje</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Můžeš přepsat název, místo i termín. Změna se hned promítne do pozvánky.</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmitEventEdit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Název akce</label>
                <input
                  className="field"
                  value={eventForm.name}
                  onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Např. Letní gril"
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Místo</label>
                <input
                  className="field"
                  value={eventForm.location}
                  onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                  placeholder="Např. Stromovka"
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Datum a čas</label>
                <EventDateTimePicker
                  value={eventForm.datetime}
                  onChange={(nextValue) => setEventForm((current) => ({ ...current, datetime: nextValue }))}
                />
              </div>

              <div className="flex gap-3">
                <button type="button" className="secondary-button flex-1 justify-center" onClick={closeEditEventModal}>
                  Zrušit
                </button>
                <button type="submit" className="primary-button flex-1" disabled={isSavingEvent}>
                  {isSavingEvent ? 'Ukládám…' : 'Uložit změny'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>

        <ModalOverlay open={showUnlockModal} onClose={closeUnlockModal} labelledBy="manage-unlock-title">
          <div className="h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
            <div className="mb-5">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Správa akce</p>
              <h3 id="manage-unlock-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Zadej PIN</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">PIN zadáš jednou. Přihlášení se uloží na tomto zařízení.</p>
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
                <button type="button" className="secondary-button flex-1 justify-center" onClick={closeUnlockModal}>
                  Zrušit
                </button>
                <button type="submit" className="primary-button flex-1" disabled={isUnlockingManage}>
                  {isUnlockingManage ? 'Ověřuji…' : 'Vstoupit'}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>

        <ModalOverlay open={showOverviewModal} onClose={() => setShowOverviewModal(false)} labelledBy="manage-overview-title">
          <div className="h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[1.75rem] sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Přehled</p>
                <h3 id="manage-overview-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">{event.name}</h3>
              </div>
              <button
                type="button"
                className="secondary-button shrink-0"
                onClick={() => setShowOverviewModal(false)}
              >
                Zavřít
              </button>
            </div>

            <div className="max-h-[60vh] space-y-5 overflow-y-auto">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Poznámka akce</p>
                <p className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                  {event.description || 'Bez poznámky.'}
                </p>
              </div>
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
                        <li
                          key={a.id}
                          className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                            {event.requirePhone && a.phone ? (
                              <a
                                href={`tel:${a.phone}`}
                                className="text-sm font-medium text-fuchsia-700 underline underline-offset-2 dark:text-fuchsia-300"
                              >
                                {a.phone}
                              </a>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        </ModalOverlay>
      </main>
    </PageShell>
  )
}

export default ManageEventPage