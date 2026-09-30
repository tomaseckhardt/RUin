import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate, useParams } from 'react-router-dom'
import AttendeeList from '../components/AttendeeList.jsx'
import AddToCalendarButton from '../components/AddToCalendarButton.jsx'
import EventChat from '../components/EventChat.jsx'
import EventOverviewModal from '../components/EventOverviewModal.jsx'
import ModalOverlay from '../components/ModalOverlay.jsx'
import PageShell from '../components/PageShell.jsx'
import PingComposerModal from '../components/PingComposerModal.jsx'
import { PinUnlockModal } from '../components/PinUnlockForm.jsx'
import { ConfirmCelebration, DeclineCelebration } from '../components/RsvpCelebration.jsx'
import ShareInviteModal from '../components/ShareInviteModal.jsx'
import WeatherWidget from '../components/WeatherWidget.jsx'
import EventStops from '../components/EventStops.jsx'
import SignupBoard from '../components/SignupBoard.jsx'
import PhotoGallery from '../components/PhotoGallery.jsx'
import {
  checkInAttendee,
  getEvent,
  isPushSubscribed,
  pingAttendee,
  registerPushSubscription,
  submitRsvp,
  unlockManageWithPin,
  unregisterPushSubscription,
} from '../lib/api.js'
import { readStoredValue, removeStoredValue, writeStoredValue } from '../lib/browserStorage.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'
import { useI18n } from '../lib/i18n.js'
import { getPushEndpoint, isReminderSupported, subscribeToEventReminders } from '../lib/push.js'
import { subscribeToEventTicks } from '../lib/realtimeTick.js'
import { normalizeName } from '../lib/normalizeName.js'

// Realtime (subscribeToEventTicks below) is the primary refresh mechanism.
// This is now just a low-frequency safety net for missed/dropped realtime
// events, not the primary refresh path.
const AUTO_REFRESH_MS = 60000
const IDENTITY_STORAGE_PREFIX = 'ruin-event-identity'
const PING_SEEN_STORAGE_PREFIX = 'ruin-event-last-seen-ping'
const PING_COOLDOWN_STORAGE_PREFIX = 'ruin-event-ping-cooldown'
const PING_COOLDOWN_MS = 10 * 60 * 1000
const REFRESH_ERROR_TOAST_ID = 'event-refresh-error'
const SUMMARY_STATUS_GROUPS = ['confirmed', 'excused', 'excused_accepted', 'excused_rejected']
// Form status -> key prefix of its option label and hint under event.
const RESPONSE_OPTIONS = [
  ['confirmed', 'confirm'],
  ['excused', 'excuse'],
]

function identityStorageKey(eventId) {
  return `${IDENTITY_STORAGE_PREFIX}:${eventId}`
}

function pingSeenStorageKey(eventId, attendeeName) {
  return `${PING_SEEN_STORAGE_PREFIX}:${eventId}:${normalizeName(attendeeName)}`
}

function pingCooldownStorageKey(eventId, targetAttendeeId) {
  return `${PING_COOLDOWN_STORAGE_PREFIX}:${eventId}:${targetAttendeeId}`
}

function readPingCooldownUntil(eventId, targetAttendeeId) {
  return Number(readStoredValue(pingCooldownStorageKey(eventId, targetAttendeeId))) || 0
}

function writePingCooldownUntil(eventId, targetAttendeeId, until) {
  writeStoredValue(pingCooldownStorageKey(eventId, targetAttendeeId), String(until))
}

function statusLabelKey(status) {
  return SUMMARY_STATUS_GROUPS.includes(status) ? `event.status.${status}` : 'event.status.unknown'
}

function attendeeStatusToFormStatus(status) {
  return status === 'confirmed' ? 'confirmed' : 'excused'
}

function EventPage() {
  const { t } = useI18n()
  const { id } = useParams()
  const navigate = useNavigate()
  const initialIdentity = readStoredValue(identityStorageKey(id)) || ''
  const [payload, setPayload] = useState(null)
  const [name, setName] = useState(initialIdentity)
  const [phone, setPhone] = useState('')
  const [excuseReason, setExcuseReason] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('confirmed')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // The name this browser answered as; the form's name field is locked to it.
  const [sessionName, setSessionName] = useState(initialIdentity)
  const isIdentityLocked = Boolean(sessionName)
  const [pingBusyId, setPingBusyId] = useState(null)
  const [incomingPing, setIncomingPing] = useState(null)
  const [isUnlockingManage, setIsUnlockingManage] = useState(false)
  const [showManageModal, setShowManageModal] = useState(false)
  const [showOverviewModal, setShowOverviewModal] = useState(false)
  const [showPingModal, setShowPingModal] = useState(false)
  const [pingTargetId, setPingTargetId] = useState(null)
  const [error, setError] = useState('')
  const [isEditingResponse, setIsEditingResponse] = useState(false)
  const [showConfirmCelebration, setShowConfirmCelebration] = useState(false)
  const [showDeclineCelebration, setShowDeclineCelebration] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [isReminderOn, setIsReminderOn] = useState(false)
  const [isTogglingReminder, setIsTogglingReminder] = useState(false)
  const [isCheckingIn, setIsCheckingIn] = useState(false)
  const [pingCooldownTick, setPingCooldownTick] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = setInterval(() => setPingCooldownTick(Date.now()), 1000)
    return () => clearInterval(intervalId)
  }, [])

  const hasLoadedOnceRef = useRef(false)
  const celebrationTimeoutRef = useRef(null)
  const latestRequestIdRef = useRef(0)
  const sessionNameRef = useRef(sessionName)

  useEffect(() => {
    sessionNameRef.current = sessionName
  }, [sessionName])

  useEffect(() => () => clearTimeout(celebrationTimeoutRef.current), [])

  useEffect(() => {
    if (!isReminderSupported()) {
      return undefined
    }

    // The browser's subscription is shared by all events; ask the server
    // whether it's registered for this one.
    let isCurrent = true

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => (subscription ? isPushSubscribed(id, subscription.endpoint) : false))
      .then((isSubscribed) => {
        if (isCurrent) {
          setIsReminderOn(Boolean(isSubscribed))
        }
      })
      .catch(() => {})

    return () => {
      isCurrent = false
    }
  }, [id])

  async function toggleReminder() {
    setIsTogglingReminder(true)

    try {
      if (isReminderOn) {
        const endpoint = await getPushEndpoint()

        if (endpoint) {
          await unregisterPushSubscription(endpoint, id)
        }

        setIsReminderOn(false)
        toast.success(t('event.reminderTurnedOff'))
      } else {
        const subscription = await subscribeToEventReminders(id)
        await registerPushSubscription(id, subscription)
        setIsReminderOn(true)
        toast.success(t('event.reminderTurnedOn'))
      }
    } catch (reminderError) {
      toast.error(reminderError.message)
    } finally {
      setIsTogglingReminder(false)
    }
  }

  async function handleCheckIn() {
    setIsCheckingIn(true)

    try {
      await checkInAttendee(id, sessionName)
      toast.success(t('event.checkInDone'))
      await loadEvent()
    } catch (checkInError) {
      toast.error(checkInError.message)
    } finally {
      setIsCheckingIn(false)
    }
  }

  const maybeShowIncomingPing = useCallback(
    (nextPayload, forcedSessionName = null) => {
      if (!nextPayload) {
        return
      }

      const activeName = forcedSessionName || sessionNameRef.current

      if (!activeName) {
        return
      }

      const attendee = nextPayload.attendees.find((item) => normalizeName(item.name) === normalizeName(activeName))

      if (!attendee) {
        return
      }

      const lastPingAt = attendee.ping_last_created_at
      const lastPingSource = attendee.ping_last_source_name

      if (!lastPingAt || !lastPingSource) {
        return
      }

      const key = pingSeenStorageKey(id, activeName)
      const seenPingAt = readStoredValue(key)

      if (seenPingAt && new Date(lastPingAt).getTime() <= new Date(seenPingAt).getTime()) {
        return
      }

      setIncomingPing({
        sourceName: lastPingSource,
        message: attendee.ping_last_message,
      })
      setShowPingModal(true)
      writeStoredValue(key, lastPingAt)
    },
    [id],
  )

  const loadEvent = useCallback(
    async (forcedSessionName = null) => {
      const requestId = ++latestRequestIdRef.current

      try {
        const nextPayload = await getEvent(id)

        if (requestId !== latestRequestIdRef.current) {
          return
        }

        setPayload(nextPayload)
        hasLoadedOnceRef.current = true
        maybeShowIncomingPing(nextPayload, forcedSessionName)
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
    },
    [id, maybeShowIncomingPing],
  )

  useEffect(() => {
    // Load now and on every realtime tick, plus a low-frequency safety net in
    // case ticks are missed or the realtime connection silently drops.
    loadEvent()
    const intervalId = setInterval(() => document.visibilityState === 'visible' && loadEvent(), AUTO_REFRESH_MS)
    const unsubscribe = subscribeToEventTicks(id, ['event', 'attendee', 'ping'], loadEvent)

    return () => {
      clearInterval(intervalId)
      unsubscribe()
    }
  }, [id, loadEvent])

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

      const normalizedName = name.trim()
      writeStoredValue(identityStorageKey(id), normalizedName)
      setSessionName(normalizedName)
      setName(normalizedName)
      setIsEditingResponse(false)
      setExcuseReason('')
      setPhone('')

      clearTimeout(celebrationTimeoutRef.current)

      if (selectedStatus === 'confirmed') {
        setShowConfirmCelebration(true)
        celebrationTimeoutRef.current = setTimeout(() => setShowConfirmCelebration(false), 4500)
      } else {
        setShowDeclineCelebration(true)
        celebrationTimeoutRef.current = setTimeout(() => setShowDeclineCelebration(false), 3500)
      }

      await loadEvent(normalizedName)
    } catch (submitError) {
      toast.error(submitError.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function getPingCooldownRemainingMs(targetAttendeeId) {
    return Math.max(0, readPingCooldownUntil(id, targetAttendeeId) - pingCooldownTick)
  }

  function closePingComposerModal() {
    if (pingBusyId === null) {
      setPingTargetId(null)
    }
  }

  async function handleSubmitPing(message) {
    setPingBusyId(pingTargetId)

    try {
      await pingAttendee(id, pingTargetId, sessionName || name, message)
      writePingCooldownUntil(id, pingTargetId, Date.now() + PING_COOLDOWN_MS)
      toast.success(t('ping.sent'))
      setPingTargetId(null)
      await loadEvent()
    } catch (pingError) {
      // Matched against the database's original text - error.message may
      // already be translated (see toRequestError in lib/api.js).
      if (pingError.serverMessage?.includes('10 minut')) {
        writePingCooldownUntil(id, pingTargetId, Date.now() + PING_COOLDOWN_MS)
      }

      toast.error(pingError.message)
    } finally {
      setPingBusyId(null)
    }
  }

  function handleResetIdentity() {
    if (sessionName) {
      removeStoredValue(identityStorageKey(id))
      removeStoredValue(pingSeenStorageKey(id, sessionName))
    }

    setSessionName('')
    setName('')
    setSelectedStatus('confirmed')
    setExcuseReason('')
    setPhone('')
    setIsEditingResponse(false)
  }

  // The organizer removed this guest; answering again starts from their name.
  function handleRsvpAgain() {
    const previousName = sessionName
    handleResetIdentity()
    setName(previousName)
  }

  function closePingModal() {
    setShowPingModal(false)
    setIncomingPing(null)
  }

  function closeManageModal() {
    if (!isUnlockingManage) {
      setShowManageModal(false)
    }
  }

  async function handleUnlockManage(pin) {
    setIsUnlockingManage(true)

    try {
      const response = await unlockManageWithPin(id, pin)
      toast.success(t('event.manageUnlocked'))
      navigate(response.organizerPath)
    } catch (unlockError) {
      toast.error(unlockError.message)
    } finally {
      setIsUnlockingManage(false)
    }
  }

  const sessionAttendee =
    isIdentityLocked && payload ? payload.attendees.find((attendee) => normalizeName(attendee.name) === normalizeName(sessionName)) : null

  useEffect(() => {
    if (!sessionAttendee || isEditingResponse) {
      return
    }

    // This effect exists specifically to reset the local draft fields from the
    // server record when it changes (and only when not mid-edit) - there's no
    // way to do that from render, since these fields must stay mutable for the
    // user to type into afterward.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedStatus(attendeeStatusToFormStatus(sessionAttendee.status))
    setExcuseReason(sessionAttendee.excuse_reason || '')
    setPhone(sessionAttendee.phone || '')
    // isEditingResponse is deliberately excluded: it must not retrigger this effect
    // (that would resync from a stale sessionAttendee mid-submit), only gate a run
    // that already fired because sessionAttendee changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionAttendee])

  function handleCancelEdit() {
    if (sessionAttendee) {
      setSelectedStatus(attendeeStatusToFormStatus(sessionAttendee.status))
      setExcuseReason(sessionAttendee.excuse_reason || '')
      setPhone(sessionAttendee.phone || '')
    }

    setIsEditingResponse(false)
  }

  if (isLoading) {
    return <PageShell eyebrow={t('event.publicInvite')} title={t('event.loadingTitle')} subtitle={t('event.loadingSubtitle')} />
  }

  if (error || !payload) {
    return <PageShell eyebrow={t('event.publicInvite')} title={t('event.notFoundTitle')} subtitle={error || t('common.linkGone')} />
  }

  const { event, attendees, summary } = payload

  return (
    <PageShell
      eyebrow={t('event.eyebrow')}
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      mergeNextPanel
      actions={<WeatherWidget location={event.location} datetime={event.datetime} />}>
      <main className="grid gap-6">
        <section className="panel order-0 rounded-t-none border-t-0 flex flex-wrap items-center gap-2 sm:gap-3">
          <AddToCalendarButton eventData={event} />
          <button type="button" className="secondary-button" onClick={() => setShowOverviewModal(true)}>
            {t('overview.title')}
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 font-bold text-white shadow-[0_10px_28px_-6px_rgba(111,76,255,0.65)] transition hover:-translate-y-0.5 hover:shadow-[0_14px_32px_-6px_rgba(111,76,255,0.8)]"
            style={{ background: 'linear-gradient(135deg, #7a1c3f, #6f4cff)' }}
            onClick={() => setShowShareModal(true)}>
            {t('share.invite')}
          </button>
          <button
            type="button"
            className="secondary-button border-transparent bg-transparent shadow-none hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setShowManageModal(true)}>
            {t('event.manage')}
          </button>
        </section>

        <section className="panel relative order-1 overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-[linear-gradient(135deg,rgba(122,28,63,0.14),rgba(111,76,255,0.1))] [mask-image:linear-gradient(to_bottom,black,transparent)] dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.26),rgba(111,76,255,0.16))]" />
          <div className="relative">
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.25em]">{t('event.note')}</p>
            <p
              className="mt-4 max-w-3xl rounded-2xl border-l-4 px-5 py-4 text-xl font-semibold leading-8 text-slate-900 shadow-sm dark:text-slate-50"
              style={{
                background: 'linear-gradient(135deg, rgba(122,28,63,0.1), rgba(111,76,255,0.08))',
                borderColor: '#6f4cff',
              }}>
              {event.description}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                ['statComing', summary.confirmed],
                ['statExcuses', summary.excused],
                ['statRejected', summary.rejected],
              ].map(([key, count]) => (
                <div key={key} className="stat-tile">
                  <div className="text-sm uppercase tracking-[0.18em] text-slate-500 dark:text-slate-300">{t(`event.${key}`)}</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">{count}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {showConfirmCelebration ? (
          <div className="order-2 lg:order-2">
            <ConfirmCelebration name={sessionName} />
          </div>
        ) : showDeclineCelebration ? (
          <div className="order-2 lg:order-2">
            <DeclineCelebration name={sessionName} />
          </div>
        ) : (
          <section className="panel order-2 lg:order-2">
            {!isIdentityLocked || isEditingResponse ? (
              <>
                <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
                  {isIdentityLocked ? t('event.changeResponse') : t('event.replyEyebrow')}
                </p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">
                  {isIdentityLocked ? t('event.editTitle') : t('event.replyTitle')}
                </h2>
                {isIdentityLocked && sessionAttendee ? (
                  <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {t('event.currentStatusOverwrite', {
                      status: t(statusLabelKey(sessionAttendee.status)),
                    })}
                  </p>
                ) : null}
                <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
                  <div>
                    <label htmlFor="attendee-name" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      {t('common.yourName')}
                    </label>
                    <input
                      id="attendee-name"
                      className="field"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder={t('common.guestNamePlaceholder')}
                      required
                      disabled={isIdentityLocked}
                    />
                  </div>

                  {event.requirePhone ? (
                    <div>
                      <label htmlFor="attendee-phone" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t('common.phoneNumber')}
                      </label>
                      <input
                        id="attendee-phone"
                        type="tel"
                        className="field"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+420 123 456 789"
                        required
                      />
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label={t('event.attendanceStatus')}>
                    {RESPONSE_OPTIONS.map(([status, key]) => (
                      <button
                        key={status}
                        type="button"
                        role="radio"
                        aria-checked={selectedStatus === status}
                        className={`rounded-[1.75rem] border px-4 py-4 text-left transition ${selectedStatus === status ? 'border-fuchsia-300 bg-[linear-gradient(135deg,rgba(122,28,63,0.12),rgba(111,76,255,0.08))] text-slate-950 dark:border-fuchsia-500/60 dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.32),rgba(111,76,255,0.28))] dark:text-slate-50' : 'border-slate-200 bg-white/60 text-slate-700 hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300'}`}
                        onClick={() => setSelectedStatus(status)}>
                        <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-slate-800 dark:text-slate-100">
                          {t(`event.${key}Option`)}
                        </span>
                        <span className="mt-2 block text-sm text-slate-500 dark:text-slate-200">{t(`event.${key}OptionHint`)}</span>
                      </button>
                    ))}
                  </div>

                  {selectedStatus === 'excused' ? (
                    <div>
                      <label htmlFor="excuse-reason" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
                        {t('event.excuseReason')}
                      </label>
                      <textarea
                        id="excuse-reason"
                        className="field min-h-28"
                        value={excuseReason}
                        onChange={(event) => setExcuseReason(event.target.value)}
                        placeholder={t('event.excuseReasonPlaceholder')}
                      />
                    </div>
                  ) : null}

                  <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
                    {isSubmitting
                      ? t('event.submitting')
                      : selectedStatus === 'confirmed'
                        ? isIdentityLocked
                          ? t('event.saveNewResponse')
                          : t('event.confirmOption')
                        : isIdentityLocked
                          ? t('event.sendNewExcuse')
                          : t('event.sendExcuse')}
                  </button>

                  {isIdentityLocked ? (
                    <button type="button" className="secondary-button w-full justify-center" onClick={handleCancelEdit}>
                      {t('common.back')}
                    </button>
                  ) : null}
                </form>
              </>
            ) : (
              <>
                <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">{t('event.signedInEyebrow')}</p>
                <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">{sessionName}</h2>
                <p className="mt-4 text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {t('event.identityNote')}{' '}
                  {sessionAttendee
                    ? t('event.currentStatus', {
                        status: t(statusLabelKey(sessionAttendee.status)),
                      })
                    : isSubmitting
                      ? t('event.loadingStatus')
                      : null}
                </p>
                {!sessionAttendee && !isSubmitting ? (
                  <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/90 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                    {t('event.removedNotice')}
                    <button type="button" className="primary-button mt-3 w-full justify-center" onClick={handleRsvpAgain}>
                      {t('event.rsvpAgain')}
                    </button>
                  </div>
                ) : null}
                {sessionAttendee?.status === 'excused_rejected' ? (
                  <div className="mt-5 rounded-3xl border border-amber-200 bg-amber-50/90 p-4 text-sm leading-6 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
                    {t('event.excuseRejectedNotice')}
                  </div>
                ) : null}
                {sessionAttendee?.status === 'confirmed' ? (
                  <button
                    type="button"
                    className="primary-button mt-5 w-full justify-center"
                    onClick={handleCheckIn}
                    disabled={isCheckingIn || Boolean(sessionAttendee?.checked_in_at)}>
                    {sessionAttendee?.checked_in_at ? t('event.checkedIn') : isCheckingIn ? t('event.checkingIn') : t('event.checkIn')}
                  </button>
                ) : null}
                <button type="button" className="primary-button mt-5 w-full justify-center" onClick={() => setIsEditingResponse(true)}>
                  {t('event.changeResponse')}
                </button>
                {isReminderSupported() ? (
                  <button type="button" className="secondary-button mt-3 w-full" onClick={toggleReminder} disabled={isTogglingReminder}>
                    {isTogglingReminder ? t('event.reminderBusy') : isReminderOn ? t('event.reminderOn') : t('event.reminderOff')}
                  </button>
                ) : null}
                <button type="button" className="secondary-button mt-3 w-full" onClick={handleResetIdentity}>
                  {t('event.notMe')}
                </button>
              </>
            )}
          </section>
        )}

        <div className="order-3 lg:order-3">
          <AttendeeList
            attendees={attendees}
            summary={summary}
            showPing
            onPing={setPingTargetId}
            pingBusyId={pingBusyId}
            canPing={Boolean(name.trim())}
            currentName={sessionName || name}
            getPingCooldownRemainingMs={getPingCooldownRemainingMs}
          />
        </div>

        {event.enableStops ? (
          <div className="order-4 lg:order-4">
            <EventStops eventId={id} />
          </div>
        ) : null}

        {event.enableBringList ? (
          <div className="order-5 lg:order-5">
            <SignupBoard eventId={id} category="bring" currentName={sessionName} canInteract={isIdentityLocked} />
          </div>
        ) : null}

        {event.enableCarpool ? (
          <div className="order-6 lg:order-6">
            <SignupBoard eventId={id} category="ride" currentName={sessionName} canInteract={isIdentityLocked} />
          </div>
        ) : null}

        <div className="order-7 lg:order-7">
          <PhotoGallery eventId={id} currentName={sessionName} />
        </div>

        <div className="order-8 lg:order-8">
          <EventChat eventId={id} currentName={sessionName} canSend={isIdentityLocked && Boolean(sessionName.trim())} />
        </div>

        <PinUnlockModal
          open={showManageModal}
          onClose={closeManageModal}
          hint={t('pin.hint')}
          onSubmit={handleUnlockManage}
          isUnlocking={isUnlockingManage}
        />

        <ModalOverlay open={showPingModal && Boolean(incomingPing)} onClose={closePingModal} labelledBy="incoming-ping-title">
          {incomingPing ? (
            <div className="modal-card">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('ping.incomingEyebrow')}</p>
              <h3 id="incoming-ping-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
                {incomingPing.sourceName}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                {incomingPing.message ? t('ping.incomingMessage', { message: incomingPing.message }) : t('ping.incomingNoMessage')}
              </p>
              <button type="button" className="primary-button mt-6 w-full" onClick={closePingModal}>
                {t('ping.gotIt')}
              </button>
            </div>
          ) : null}
        </ModalOverlay>

        <PingComposerModal
          open={pingTargetId !== null}
          onClose={closePingComposerModal}
          onSubmit={handleSubmitPing}
          isSending={pingBusyId !== null}
        />

        <ShareInviteModal
          open={showShareModal}
          onClose={() => setShowShareModal(false)}
          inviteUrl={buildAbsoluteUrl(`/event/${id}`)}
          eventId={id}
          eventName={event.name}
          datetime={event.datetime}
        />

        <EventOverviewModal open={showOverviewModal} onClose={() => setShowOverviewModal(false)} event={event} attendees={attendees} />
      </main>
    </PageShell>
  )
}

export default EventPage
