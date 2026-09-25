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
import InvitePeopleModal from '../components/InvitePeopleModal.jsx'
import SignupBoard from '../components/SignupBoard.jsx'
import PhotoGallery from '../components/PhotoGallery.jsx'
import { deleteAttendee, getEvent, getEventPhotos, moderateAttendee, pingAttendee, removeEvent, unlockManageWithPin, updateEvent } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime, parseLocalDateTime, toDateTimeLocalValue } from '../lib/format.js'
import { useI18n } from '../lib/i18n.js'
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

// Matched against the database's original text, not the (possibly
// translated) error.message - see toRequestError in lib/api.js.
function isInvalidOrganizerTokenError(error) {
  if (typeof error?.serverMessage !== 'string') {
    return false
  }

  return error.serverMessage.includes('Neplatný organizátorský odkaz')
}

function ManageEventPage() {
  const { t } = useI18n()
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
  const [showInvitePeopleModal, setShowInvitePeopleModal] = useState(false)
  const [showPingComposerModal, setShowPingComposerModal] = useState(false)
  const [pingTargetId, setPingTargetId] = useState(null)
  const [pingMessageInput, setPingMessageInput] = useState('')
  const [showEditEventModal, setShowEditEventModal] = useState(false)
  const [eventForm, setEventForm] = useState({
    name: '',
    location: '',
    datetime: '',
    description: '',
    requirePhone: false,
    enableBringList: true,
    enableCarpool: true,
    enableStops: true,
  })
  const [isSavingEvent, setIsSavingEvent] = useState(false)
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  // A dictionary key rather than text, so the hint follows a language switch.
  const [unlockHintKey, setUnlockHintKey] = useState('')
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
          setUnlockHintKey('pin.hint')
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

        if (isInvalidOrganizerTokenError(loadError)) {
          clearSavedOrganizerToken(id)
          refreshStoredToken()
          setShowUnlockModal(true)
          setUnlockHintKey('manage.unlockAgain')
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
      toast.error(t('manage.unlockRequired'))
      return
    }

    setBusyId(attendeeId)

    try {
      await moderateAttendee(id, attendeeId, { token: activeToken, status })
      toast.success(status === 'excused_accepted' ? t('manage.excuseAccepted') : t('manage.excuseRejected'))
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
      toast.error(t('manage.unlockRequired'))
      return
    }

    const confirmed = window.confirm(t('manage.confirmDeleteEvent'))

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
          toast.warning(t('manage.photosNotDeleted'))
        }
      }

      await removeEvent(id, activeToken)
      clearSavedOrganizerToken(id)
      toast.success(t('manage.eventDeleted'))
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
      description: payload.event.description || '',
      requirePhone: Boolean(payload.event.requirePhone),
      enableBringList: payload.event.enableBringList ?? true,
      enableCarpool: payload.event.enableCarpool ?? true,
      enableStops: payload.event.enableStops ?? true,
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
      toast.error(t('manage.unlockRequired'))
      return
    }

    if (!eventForm.datetime) {
      toast.error(t('eventForm.pickDateTime'))
      return
    }

    setIsSavingEvent(true)

    try {
      await updateEvent(id, {
        token: activeToken,
        name: eventForm.name,
        location: eventForm.location,
        datetime: eventForm.datetime,
        description: eventForm.description,
        requirePhone: eventForm.requirePhone,
        enableBringList: eventForm.enableBringList,
        enableCarpool: eventForm.enableCarpool,
        enableStops: eventForm.enableStops,
      })
      toast.success(t('manage.eventUpdated'))
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
      toast.error(t('manage.unlockRequired'))
      return
    }

    const confirmed = window.confirm(t('manage.confirmDeleteAttendee', { name: attendeeName }))

    if (!confirmed) {
      return
    }

    setDeleteBusyId(attendeeId)

    try {
      await deleteAttendee(id, attendeeId, activeToken)
      toast.success(t('manage.attendeeDeleted'))
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
      toast.success(t('ping.sent'))
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
        throw new Error(t('manage.loginSaveFailed'))
      }

      saveOrganizerToken(id, nextToken)
      refreshStoredToken()
      setShowUnlockModal(false)
      setManagePin('')
      setError('')
      setUnlockHintKey('')
      toast.success(t('manage.unlockedAndSaved'))
      await loadEvent()
    } catch (unlockError) {
      toast.error(unlockError.message)
    } finally {
      setIsUnlockingManage(false)
    }
  }

  if (isLoading) {
    return (
      <PageShell eyebrow={t('common.organizer')} title={t('manage.loadingTitle')} subtitle={t('manage.loadingSubtitle')} />
    )
  }

  if (showUnlockModal && !payload) {
    return (
      <PageShell
        eyebrow={t('common.organizer')}
        title={t('manage.unlockTitle')}
        subtitle={t(unlockHintKey || 'pin.hint')}
      >
        <main className="grid gap-6">
          <section className="panel mx-auto w-full max-w-md">
            <form className="space-y-4" onSubmit={handleUnlockManage}>
              <div>
                <label
                  htmlFor="manage-pin-standalone"
                  className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300"
                >
                  {t('pin.label')}
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
                {isUnlockingManage ? t('common.verifying') : t('pin.enter')}
              </button>
              <Link
                to={`/event/${id}`}
                className="block text-center text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {t('manage.continueAsGuest')}
              </Link>
            </form>
          </section>
        </main>
      </PageShell>
    )
  }

  if (error || !payload) {
    return (
      <PageShell eyebrow={t('common.organizer')} title={t('manage.unavailableTitle')} subtitle={error || t('manage.unavailableSubtitle')} />
    )
  }

  const { event, attendees, summary } = payload
  const organizerName = event.organizerName || ''

  return (
    <PageShell
      eyebrow={t('manage.eyebrow')}
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <>
          <WeatherWidget location={event.location} datetime={event.datetime} compact />
          <AddToCalendarButton eventData={event} />
        </>
      }
    >
      <main className="grid gap-6 xl:flex xl:items-start">
        <section className="panel order-0 xl:hidden">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">{t('manage.controlPanel')}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div className="stat-tile p-3 text-slate-900 dark:text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">{t('manage.statConfirmed')}</div>
              <div className="mt-1 text-2xl font-black tracking-[-0.03em]">{summary.confirmed}</div>
            </div>
            <div className="stat-tile p-3 text-slate-900 dark:text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">{t('manage.statPending')}</div>
              <div className="mt-1 text-2xl font-black tracking-[-0.03em]">{summary.excused}</div>
            </div>
            <div className="stat-tile p-3 text-slate-900 dark:text-slate-100">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">{t('manage.statRejected')}</div>
              <div className="mt-1 text-2xl font-black tracking-[-0.03em]">{summary.rejected}</div>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <button
              type="button"
              className="secondary-button w-full justify-center"
              onClick={openEditEventModal}
            >
              {t('manage.editEvent')}
            </button>
            <button
              type="button"
              className="secondary-button w-full justify-center"
              onClick={() => setShowOverviewModal(true)}
            >
              {t('overview.title')}
            </button>
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-bold text-white shadow-[0_10px_28px_-6px_rgba(111,76,255,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-6px_rgba(111,76,255,0.8)]"
              style={{ background: 'linear-gradient(135deg, #7a1c3f, #6f4cff)' }}
              onClick={() => setShowShareModal(true)}
            >
              {t('manage.invite')}
            </button>
            <button type="button" className="secondary-button w-full justify-center" onClick={() => setShowInvitePeopleModal(true)}>
              {t('manage.whoShouldCome')}
            </button>
            <button
              type="button"
              className="secondary-button w-full justify-center border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting ? t('manage.deleting') : t('manage.deleteEvent')}
            </button>
          </div>
        </section>

        <div className="order-2 flex flex-col gap-6 xl:order-1 xl:min-w-0 xl:flex-1">
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

          <EventChat
            eventId={id}
            currentName={organizerName}
            canSend={Boolean(organizerName.trim())}
          />

          {event.enableStops ? <EventStops eventId={id} isOrganizer organizerToken={activeToken} /> : null}

          {event.enableBringList ? (
            <SignupBoard eventId={id} category="bring" currentName={organizerName} canInteract={Boolean(organizerName.trim())} isOrganizer organizerToken={activeToken} />
          ) : null}

          {event.enableCarpool ? (
            <SignupBoard eventId={id} category="ride" currentName={organizerName} canInteract={Boolean(organizerName.trim())} isOrganizer organizerToken={activeToken} />
          ) : null}

          <PhotoGallery eventId={id} currentName={organizerName} isOrganizer organizerToken={activeToken} />
        </div>

        <aside className="order-1 hidden xl:order-2 xl:block xl:w-80 xl:shrink-0 xl:sticky xl:top-6">
          <section className="panel">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
              {t('manage.controls')}
            </p>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                className="secondary-button w-full justify-center"
                onClick={openEditEventModal}
              >
                {t('manage.editEvent')}
              </button>
              <button
                type="button"
                className="secondary-button w-full justify-center"
                onClick={() => setShowOverviewModal(true)}
              >
                {t('overview.title')}
              </button>
              <button
                type="button"
                className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-bold text-white shadow-[0_10px_28px_-6px_rgba(111,76,255,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-6px_rgba(111,76,255,0.8)]"
                style={{ background: 'linear-gradient(135deg, #7a1c3f, #6f4cff)' }}
                onClick={() => setShowShareModal(true)}
              >
                {t('manage.invite')}
              </button>
              <button type="button" className="secondary-button w-full justify-center" onClick={() => setShowInvitePeopleModal(true)}>
                {t('manage.whoShouldCome')}
              </button>
              <button
                type="button"
                className="secondary-button w-full justify-center border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? t('manage.deleting') : t('manage.deleteEvent')}
              </button>
            </div>
          </section>
        </aside>

        <ShareInviteModal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          inviteUrl={inviteUrl}
          eventId={id}
          eventName={event.name}
          datetime={event.datetime}
        />

        <InvitePeopleModal
          open={showInvitePeopleModal}
          onClose={() => setShowInvitePeopleModal(false)}
          eventId={id}
          token={activeToken}
          onInvited={loadEvent}
        />

        <ModalOverlay open={showPingComposerModal} onClose={closePingComposerModal} labelledBy="manage-ping-composer-title">
          <div className="h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('ping.composerEyebrow')}</p>
            <h3 id="manage-ping-composer-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">{t('ping.composerTitle')}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('ping.composerHint')}</p>

            <form className="mt-4 space-y-4" onSubmit={handleSubmitPing}>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('ping.messageLabel')}</label>
                <textarea
                  className="field min-h-24"
                  value={pingMessageInput}
                  onChange={(event) => setPingMessageInput(event.target.value.slice(0, 280))}
                  placeholder={t('ping.messagePlaceholder')}
                  disabled={pingBusyId !== null}
                  autoFocus
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('common.charactersLeft', { count: 280 - pingMessageInput.length })}</p>
              </div>

              <div className="flex gap-3">
                <button type="button" className="secondary-button flex-1 justify-center" onClick={closePingComposerModal}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="primary-button flex-1" disabled={pingBusyId !== null}>
                  {pingBusyId !== null ? t('ping.sending') : t('common.send')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>

        <ModalOverlay open={showEditEventModal} onClose={closeEditEventModal} labelledBy="manage-edit-event-title">
          <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[1.75rem] sm:p-6">
            <div className="mb-5">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('manage.editEvent')}</p>
              <h3 id="manage-edit-event-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">{t('manage.editTitle')}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('manage.editHint')}</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmitEventEdit}>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('eventForm.name')}</label>
                <input
                  className="field"
                  value={eventForm.name}
                  onChange={(event) => setEventForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder={t('manage.editNamePlaceholder')}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('eventForm.location')}</label>
                <input
                  className="field"
                  value={eventForm.location}
                  onChange={(event) => setEventForm((current) => ({ ...current, location: event.target.value }))}
                  placeholder={t('manage.editLocationPlaceholder')}
                  required
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('eventForm.dateTime')}</label>
                <EventDateTimePicker
                  value={eventForm.datetime}
                  onChange={(nextValue) => setEventForm((current) => ({ ...current, datetime: nextValue }))}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('eventForm.description')}</label>
                <textarea
                  className="field min-h-32"
                  value={eventForm.description}
                  onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder={t('eventForm.descriptionPlaceholder')}
                  required
                />
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                  checked={eventForm.requirePhone}
                  onChange={(event) => setEventForm((current) => ({ ...current, requirePhone: event.target.checked }))}
                />
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.requirePhone')}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('eventForm.requirePhoneHint')}</p>
                </div>
              </label>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                    checked={eventForm.enableBringList}
                    onChange={(event) => setEventForm((current) => ({ ...current, enableBringList: event.target.checked }))}
                  />
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.bringList')}</p>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                    checked={eventForm.enableCarpool}
                    onChange={(event) => setEventForm((current) => ({ ...current, enableCarpool: event.target.checked }))}
                  />
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.carpool')}</p>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                    checked={eventForm.enableStops}
                    onChange={(event) => setEventForm((current) => ({ ...current, enableStops: event.target.checked }))}
                  />
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.stops')}</p>
                </label>
              </div>

              <div className="flex gap-3">
                <button type="button" className="secondary-button flex-1 justify-center" onClick={closeEditEventModal}>
                  {t('common.cancel')}
                </button>
                <button type="submit" className="primary-button flex-1" disabled={isSavingEvent}>
                  {isSavingEvent ? t('common.saving') : t('manage.saveChanges')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>

        <ModalOverlay open={showUnlockModal} onClose={closeUnlockModal} labelledBy="manage-unlock-title">
          <div className="h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
            <div className="mb-5">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('pin.eyebrow')}</p>
              <h3 id="manage-unlock-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">{t('pin.title')}</h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('manage.unlockModalHint')}</p>
            </div>

            <form className="space-y-4" onSubmit={handleUnlockManage}>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('pin.label')}</label>
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
                  {t('common.cancel')}
                </button>
                <button type="submit" className="primary-button flex-1" disabled={isUnlockingManage}>
                  {isUnlockingManage ? t('common.verifying') : t('pin.enter')}
                </button>
              </div>
            </form>
          </div>
        </ModalOverlay>

        <ModalOverlay open={showOverviewModal} onClose={() => setShowOverviewModal(false)} labelledBy="manage-overview-title">
          <div className="h-[100dvh] w-full max-w-none overflow-y-auto rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[1.75rem] sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('overview.title')}</p>
                <h3 id="manage-overview-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">{event.name}</h3>
              </div>
              <button
                type="button"
                className="secondary-button shrink-0"
                onClick={() => setShowOverviewModal(false)}
              >
                {t('common.close')}
              </button>
            </div>

            <div className="max-h-[60vh] space-y-5 overflow-y-auto">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t('overview.note')}</p>
                <p className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
                  {event.description || t('overview.noNote')}
                </p>
              </div>
              {['invited', 'confirmed', 'excused', 'excused_accepted', 'excused_rejected'].map((statusGroup) => {
                const group = attendees.filter((a) => a.status === statusGroup)
                if (group.length === 0) return null

                return (
                  <div key={statusGroup}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                      {t(`overview.groups.${statusGroup}`)} ({group.length})
                    </p>
                    <ul className="space-y-2">
                      {group.map((a) => (
                        <li
                          key={a.id}
                          className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                            {(event.requirePhone || a.status === 'invited') && a.phone ? (
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