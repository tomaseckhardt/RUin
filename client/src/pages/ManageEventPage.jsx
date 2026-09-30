import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AddToCalendarButton from '../components/AddToCalendarButton.jsx'
import AttendeeList from '../components/AttendeeList.jsx'
import EventChat from '../components/EventChat.jsx'
import EventFormFields from '../components/EventFormFields.jsx'
import EventOverviewModal from '../components/EventOverviewModal.jsx'
import ModalOverlay from '../components/ModalOverlay.jsx'
import PageShell from '../components/PageShell.jsx'
import PingComposerModal from '../components/PingComposerModal.jsx'
import PinUnlockForm, { PinUnlockModal } from '../components/PinUnlockForm.jsx'
import ShareInviteModal from '../components/ShareInviteModal.jsx'
import WeatherWidget from '../components/WeatherWidget.jsx'
import EventStops from '../components/EventStops.jsx'
import InvitePeopleModal from '../components/InvitePeopleModal.jsx'
import SignupBoard from '../components/SignupBoard.jsx'
import PhotoGallery from '../components/PhotoGallery.jsx'
import { deleteAttendee, getEvent, moderateAttendee, pingAttendee, removeEvent, unlockManageWithPin, updateEvent } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime, parseLocalDateTime, parseOrganizerToken, toDateTimeLocalValue } from '../lib/format.js'
import { useI18n } from '../lib/i18n.js'
import { clearSavedOrganizerToken, getSavedOrganizerToken, saveOrganizerToken } from '../lib/organizerLinkStorage.js'
import { subscribeToEventTicks } from '../lib/realtimeTick.js'

// Realtime ticks are the primary refresh; this is the safety net.
const AUTO_REFRESH_MS = 10000
const REFRESH_ERROR_TOAST_ID = 'manage-event-refresh-error'

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
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [pingBusyId, setPingBusyId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showOverviewModal, setShowOverviewModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [showInvitePeopleModal, setShowInvitePeopleModal] = useState(false)
  const [pingTargetId, setPingTargetId] = useState(null)
  // The edit modal's draft; null while the modal is closed.
  const [eventForm, setEventForm] = useState(null)
  const [isSavingEvent, setIsSavingEvent] = useState(false)
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  // A dictionary key rather than text, so the hint follows a language switch.
  const [unlockHintKey, setUnlockHintKey] = useState('pin.hint')
  const [isUnlockingManage, setIsUnlockingManage] = useState(false)

  const activeToken = urlToken || getSavedOrganizerToken(id)

  const hasLoadedOnceRef = useRef(false)
  const latestRequestIdRef = useRef(0)

  const loadEvent = useCallback(async () => {
    const requestId = ++latestRequestIdRef.current

    try {
      const nextPayload = await getEvent(id, activeToken)

      if (requestId !== latestRequestIdRef.current) {
        return
      }

      setPayload(nextPayload)
      hasLoadedOnceRef.current = true
      setError('')

      // A token from the link is saved and dropped from the address bar.
      if (urlToken) {
        saveOrganizerToken(id, urlToken)
        navigate(`/event/${id}/manage`, { replace: true })
      }
    } catch (loadError) {
      if (requestId !== latestRequestIdRef.current) {
        return
      }

      if (isInvalidOrganizerTokenError(loadError)) {
        // Hide the organizer data (phones included) loaded with the old token.
        setPayload(null)
        hasLoadedOnceRef.current = false

        // A wrong link token doesn't cost this browser its own saved one.
        const savedToken = getSavedOrganizerToken(id)

        if (urlToken && savedToken && savedToken !== urlToken) {
          navigate(`/event/${id}/manage`, { replace: true })
          return
        }

        // Forget the token (the link's one too) and ask for the PIN again.
        clearSavedOrganizerToken(id)
        setUnlockHintKey('manage.unlockAgain')
        setShowUnlockModal(true)

        if (urlToken) {
          navigate(`/event/${id}/manage`, { replace: true })
        } else {
          refreshStoredToken()
        }

        return
      }

      if (hasLoadedOnceRef.current) {
        toast.error(loadError.message, { id: REFRESH_ERROR_TOAST_ID })
      } else {
        setError(loadError.message)
      }
    }
  }, [id, activeToken, urlToken, navigate])

  useEffect(() => {
    if (!activeToken) {
      return undefined
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEvent()
    const intervalId = setInterval(() => document.visibilityState === 'visible' && loadEvent(), AUTO_REFRESH_MS)
    const unsubscribe = subscribeToEventTicks(id, ['event', 'attendee', 'ping'], loadEvent)

    return () => {
      clearInterval(intervalId)
      unsubscribe()
    }
  }, [id, activeToken, loadEvent])

  // Organizer actions need the token; without it, ask for the PIN first.
  function requireToken() {
    if (activeToken) {
      return true
    }

    setShowUnlockModal(true)
    toast.error(t('manage.unlockRequired'))
    return false
  }

  async function handleModeration(attendeeId, status) {
    if (!requireToken()) {
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
    if (!requireToken() || !window.confirm(t('manage.confirmDeleteEvent'))) {
      return
    }

    setIsDeleting(true)

    try {
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
    const { event } = payload
    const parsedDatetime = parseLocalDateTime(event.datetime)

    setEventForm({
      name: event.name || '',
      location: event.location || '',
      datetime: parsedDatetime ? toDateTimeLocalValue(parsedDatetime) : '',
      description: event.description || '',
      requirePhone: Boolean(event.requirePhone),
      enableBringList: event.enableBringList ?? true,
      enableCarpool: event.enableCarpool ?? true,
      enableStops: event.enableStops ?? true,
    })
  }

  function closeEditEventModal() {
    if (!isSavingEvent) {
      setEventForm(null)
    }
  }

  async function handleSubmitEventEdit(event) {
    event.preventDefault()

    if (!requireToken()) {
      setEventForm(null)
      return
    }

    if (!eventForm.datetime) {
      toast.error(t('eventForm.pickDateTime'))
      return
    }

    setIsSavingEvent(true)

    try {
      await updateEvent(id, { token: activeToken, ...eventForm })
      toast.success(t('manage.eventUpdated'))
      setEventForm(null)
      await loadEvent()
    } catch (updateError) {
      toast.error(updateError.message)
    } finally {
      setIsSavingEvent(false)
    }
  }

  async function handleDeleteAttendee(attendeeId, attendeeName) {
    if (!requireToken() || !window.confirm(t('manage.confirmDeleteAttendee', { name: attendeeName }))) {
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

  function closePingComposerModal() {
    if (pingBusyId === null) {
      setPingTargetId(null)
    }
  }

  async function handleSubmitPing(message) {
    setPingBusyId(pingTargetId)

    try {
      await pingAttendee(id, pingTargetId, organizerName, message)
      toast.success(t('ping.sent'))
      setPingTargetId(null)
      await loadEvent()
    } catch (pingError) {
      toast.error(pingError.message)
    } finally {
      setPingBusyId(null)
    }
  }

  function closeUnlockModal() {
    if (!isUnlockingManage) {
      setShowUnlockModal(false)
    }
  }

  // The new token changes activeToken, and the effect above reloads with it.
  async function handleUnlockManage(pin) {
    setIsUnlockingManage(true)

    try {
      const response = await unlockManageWithPin(id, pin)
      const nextToken = parseOrganizerToken(response.organizerPath)

      if (!nextToken) {
        throw new Error(t('manage.loginSaveFailed'))
      }

      saveOrganizerToken(id, nextToken)
      refreshStoredToken()
      setShowUnlockModal(false)
      setError('')
      toast.success(t('manage.unlockedAndSaved'))
    } catch (unlockError) {
      toast.error(unlockError.message)
    } finally {
      setIsUnlockingManage(false)
    }
  }

  if (!payload && !activeToken) {
    return (
      <PageShell eyebrow={t('common.organizer')} title={t('manage.unlockTitle')} subtitle={t(unlockHintKey)}>
        <main className="grid gap-6">
          <section className="panel mx-auto w-full max-w-md">
            <PinUnlockForm onSubmit={handleUnlockManage} isUnlocking={isUnlockingManage}>
              <Link
                to={`/event/${id}`}
                className="block text-center text-sm font-medium text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
                {t('manage.continueAsGuest')}
              </Link>
            </PinUnlockForm>
          </section>
        </main>
      </PageShell>
    )
  }

  if (!payload) {
    return error ? (
      <PageShell eyebrow={t('common.organizer')} title={t('manage.unavailableTitle')} subtitle={error} />
    ) : (
      <PageShell eyebrow={t('common.organizer')} title={t('manage.loadingTitle')} subtitle={t('manage.loadingSubtitle')} />
    )
  }

  const { event, attendees, summary } = payload
  const organizerName = event.organizerName || ''
  const controls = (
    <div className="mt-4 space-y-3">
      <button type="button" className="secondary-button w-full justify-center" onClick={openEditEventModal}>
        {t('manage.editEvent')}
      </button>
      <button type="button" className="secondary-button w-full justify-center" onClick={() => setShowOverviewModal(true)}>
        {t('overview.title')}
      </button>
      <button
        type="button"
        className="inline-flex w-full items-center justify-center gap-2 rounded-full px-5 py-3 font-bold text-white shadow-[0_10px_28px_-6px_rgba(111,76,255,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-6px_rgba(111,76,255,0.8)]"
        style={{ background: 'linear-gradient(135deg, #7a1c3f, #6f4cff)' }}
        onClick={() => setShowShareModal(true)}>
        {t('manage.invite')}
      </button>
      <button type="button" className="secondary-button w-full justify-center" onClick={() => setShowInvitePeopleModal(true)}>
        {t('manage.whoShouldCome')}
      </button>
      <button type="button" className="secondary-button danger-button w-full justify-center" onClick={handleDelete} disabled={isDeleting}>
        {isDeleting ? t('manage.deleting') : t('manage.deleteEvent')}
      </button>
    </div>
  )

  return (
    <PageShell
      eyebrow={t('manage.eyebrow')}
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <>
          <WeatherWidget location={event.location} datetime={event.datetime} />
          <AddToCalendarButton eventData={event} />
        </>
      }>
      <main className="grid gap-6 xl:flex xl:items-start">
        <section className="panel order-0 xl:hidden">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">{t('manage.controlPanel')}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {[
              ['statConfirmed', summary.confirmed],
              ['statPending', summary.excused],
              ['statRejected', summary.rejected],
            ].map(([key, count]) => (
              <div key={key} className="stat-tile p-3 text-slate-900 dark:text-slate-100">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em]">{t(`manage.${key}`)}</div>
                <div className="mt-1 text-2xl font-black tracking-[-0.03em]">{count}</div>
              </div>
            ))}
          </div>
          {controls}
        </section>

        <div className="order-2 flex flex-col gap-6 xl:order-1 xl:min-w-0 xl:flex-1">
          <AttendeeList
            attendees={attendees}
            summary={summary}
            showModeration
            onModerate={handleModeration}
            busyId={busyId}
            showPing
            onPing={setPingTargetId}
            pingBusyId={pingBusyId}
            canPing={Boolean(organizerName.trim())}
            currentName={organizerName}
            showDelete
            onDelete={handleDeleteAttendee}
            deleteBusyId={deleteBusyId}
            showPhone={Boolean(event.requirePhone)}
          />

          <EventChat eventId={id} currentName={organizerName} canSend={Boolean(organizerName.trim())} />

          {event.enableStops ? <EventStops eventId={id} isOrganizer organizerToken={activeToken} /> : null}

          {event.enableBringList ? (
            <SignupBoard
              eventId={id}
              category="bring"
              currentName={organizerName}
              canInteract={Boolean(organizerName.trim())}
              isOrganizer
              organizerToken={activeToken}
            />
          ) : null}

          {event.enableCarpool ? (
            <SignupBoard
              eventId={id}
              category="ride"
              currentName={organizerName}
              canInteract={Boolean(organizerName.trim())}
              isOrganizer
              organizerToken={activeToken}
            />
          ) : null}

          <PhotoGallery eventId={id} currentName={organizerName} isOrganizer organizerToken={activeToken} />
        </div>

        <aside className="order-1 hidden xl:order-2 xl:block xl:w-80 xl:shrink-0 xl:sticky xl:top-6">
          <section className="panel">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">{t('manage.controls')}</p>
            {controls}
          </section>
        </aside>

        <ShareInviteModal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          inviteUrl={buildAbsoluteUrl(`/event/${id}`)}
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

        <PingComposerModal
          open={pingTargetId !== null}
          onClose={closePingComposerModal}
          onSubmit={handleSubmitPing}
          isSending={pingBusyId !== null}
        />

        <ModalOverlay open={eventForm !== null} onClose={closeEditEventModal} labelledBy="manage-edit-event-title">
          <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[1.75rem] sm:p-6">
            <div className="mb-5">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('manage.editEvent')}</p>
              <h3 id="manage-edit-event-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
                {t('manage.editTitle')}
              </h3>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{t('manage.editHint')}</p>
            </div>

            <form className="space-y-4" onSubmit={handleSubmitEventEdit}>
              <EventFormFields form={eventForm} onChange={(patch) => setEventForm((current) => ({ ...current, ...patch }))} autoFocus />

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

        <PinUnlockModal
          open={showUnlockModal}
          onClose={closeUnlockModal}
          hint={t('manage.unlockModalHint')}
          onSubmit={handleUnlockManage}
          isUnlocking={isUnlockingManage}
        />

        <EventOverviewModal open={showOverviewModal} onClose={() => setShowOverviewModal(false)} event={event} attendees={attendees} forOrganizer />
      </main>
    </PageShell>
  )
}

export default ManageEventPage
