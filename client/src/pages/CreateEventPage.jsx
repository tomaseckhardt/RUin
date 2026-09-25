import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate } from 'react-router-dom'
import AddToHomeButton from '../components/AddToHomeButton.jsx'
import CollapsibleCard from '../components/CollapsibleCard.jsx'
import ConfettiBurst from '../components/ConfettiBurst.jsx'
import EventDateTimePicker from '../components/EventDateTimePicker.jsx'
import GroupPicker from '../components/GroupPicker.jsx'
import InviteListEditor from '../components/InviteListEditor.jsx'
import OwnerAccessModal from '../components/OwnerAccessModal.jsx'
import PageShell from '../components/PageShell.jsx'
import SignupItemEditor from '../components/SignupItemEditor.jsx'
import TemplatesPanel from '../components/TemplatesPanel.jsx'
import {
  addContactGroupMember,
  addEventStop,
  addSignupItem,
  claimSignupItem,
  createContactGroup,
  createEvent,
  createEventTemplate,
  getEvent,
  getOwnerPayload,
  inviteAttendees,
} from '../lib/api.js'
import { formatDateTime, parseLocalDateTime } from '../lib/format.js'
import { useI18n } from '../lib/i18n.js'
import { createEmptyInvitee, getFilledInvitees, mergeInvitees } from '../lib/invitees.js'
import { clearSavedOrganizerToken, getSavedOrganizerEventIds } from '../lib/organizerLinkStorage.js'
import { getSavedOwner } from '../lib/ownerLinkStorage.js'
import { createEmptySignupPrefillItem, getFilledSignupPrefillItems } from '../lib/signupPrefillItems.js'

function parseTokenFromPath(path) {
  try {
    return new URL(path, window.location.origin).searchParams.get('token') || ''
  } catch {
    return ''
  }
}

const initialForm = {
  organizerName: '',
  organizerPin: '',
  name: '',
  location: '',
  datetime: '',
  description: '',
  requirePhone: false,
  enableBringList: true,
  enableCarpool: true,
  enableStops: true,
}

function CreateEventPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [recentEvents, setRecentEvents] = useState([])
  const [isLoadingRecentEvents, setIsLoadingRecentEvents] = useState(true)
  const [showAfterparty, setShowAfterparty] = useState(false)
  const [afterpartyLocation, setAfterpartyLocation] = useState('')
  const [afterpartyTime, setAfterpartyTime] = useState('')
  const [confettiOrigin, setConfettiOrigin] = useState(null)
  const [burstKey, setBurstKey] = useState(0)
  const [owner, setOwner] = useState(() => getSavedOwner())
  const [ownerPayload, setOwnerPayload] = useState({ groups: [], templates: [] })
  const [hasLoadedOwnerPayload, setHasLoadedOwnerPayload] = useState(false)
  const isLoadingOwnerPayload = Boolean(owner) && !hasLoadedOwnerPayload
  const [showInvites, setShowInvites] = useState(false)
  const [invitees, setInvitees] = useState(() => [createEmptyInvitee()])
  const [bringItems, setBringItems] = useState(() => [createEmptySignupPrefillItem()])
  const [rideItems, setRideItems] = useState(() => [createEmptySignupPrefillItem()])
  const [saveAsGroup, setSaveAsGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [showOwnerAccessModal, setShowOwnerAccessModal] = useState(false)
  const [pendingOwnerCheckbox, setPendingOwnerCheckbox] = useState(null)

  const whyItWorks = t('createEvent.whyItWorks')

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.datetime) {
      toast.error(t('eventForm.pickDateTime'))
      return
    }

    const parsedDatetime = parseLocalDateTime(form.datetime)

    if (!parsedDatetime || parsedDatetime.getTime() <= Date.now()) {
      toast.error(t('createEvent.dateMustBeFuture'))
      return
    }

    setIsSubmitting(true)

    try {
      const payload = await createEvent(form)
      const organizerToken = parseTokenFromPath(payload.organizerPath)

      if (showAfterparty && afterpartyLocation.trim() && afterpartyTime && organizerToken) {
        try {
          await addEventStop(payload.event.id, organizerToken, {
            name: 'Afterparty',
            location: afterpartyLocation,
            startsAtLabel: afterpartyTime,
          })
        } catch (afterpartyError) {
          toast.error(t('createEvent.afterpartyFailed', { error: afterpartyError.message }))
        }
      }

      const filledInvitees = getFilledInvitees(invitees)

      if (filledInvitees.length > 0 && organizerToken) {
        try {
          await inviteAttendees(payload.event.id, organizerToken, filledInvitees)
        } catch (inviteError) {
          toast.error(t('createEvent.invitesFailed', { error: inviteError.message }))
        }
      }

      let createdGroupId = null

      if (saveAsGroup && groupName.trim() && owner) {
        try {
          const groupResult = await createContactGroup(owner.ownerId, owner.token, groupName)
          createdGroupId = groupResult.group.id

          for (const invitee of filledInvitees) {
            await addContactGroupMember(owner.ownerId, owner.token, createdGroupId, invitee)
          }
        } catch (groupError) {
          toast.error(t('createEvent.groupFailed', { error: groupError.message }))
        }
      }

      if (saveAsTemplate && templateName.trim() && owner) {
        try {
          await createEventTemplate(owner.ownerId, owner.token, {
            name: templateName,
            eventName: form.name,
            location: form.location,
            description: form.description,
            requirePhone: form.requirePhone,
            defaultGroupId: createdGroupId,
          })
        } catch (templateError) {
          toast.error(t('createEvent.templateFailed', { error: templateError.message }))
        }
      }

      if (form.enableBringList) {
        const filledBringItems = getFilledSignupPrefillItems(bringItems)

        for (const item of filledBringItems) {
          try {
            const itemResult = await addSignupItem(payload.event.id, {
              category: 'bring',
              label: item.label,
              capacity: item.quantity,
              createdBy: form.organizerName,
            })

            if (item.personName) {
              await claimSignupItem(itemResult.id, item.personName, item.quantity)
            }
          } catch (bringError) {
            toast.error(t('createEvent.bringItemFailed', { label: item.label, error: bringError.message }))
          }
        }
      }

      if (form.enableCarpool) {
        const filledRideItems = getFilledSignupPrefillItems(rideItems)

        for (const item of filledRideItems) {
          try {
            await addSignupItem(payload.event.id, {
              category: 'ride',
              label: item.label,
              capacity: item.quantity,
              createdBy: item.personName || form.organizerName,
            })
          } catch (rideError) {
            toast.error(t('createEvent.rideFailed', { label: item.label, error: rideError.message }))
          }
        }
      }

      toast.success(t('createEvent.created'))
      setForm(initialForm)
      setShowAfterparty(false)
      setAfterpartyLocation('')
      setAfterpartyTime('')
      setShowInvites(false)
      setInvitees([createEmptyInvitee()])
      setBringItems([createEmptySignupPrefillItem()])
      setRideItems([createEmptySignupPrefillItem()])
      setSaveAsGroup(false)
      setGroupName('')
      setSaveAsTemplate(false)
      setTemplateName('')
      navigate(payload.organizerPath)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleAfterpartyClick(event) {
    if (!showAfterparty) {
      const rect = event.currentTarget.getBoundingClientRect()
      setConfettiOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      setBurstKey((current) => current + 1)
    }

    setShowAfterparty((current) => !current)
  }

  function updateField(field) {
    return (event) => {
      setForm((current) => ({
        ...current,
        [field]: event.target.value,
      }))
    }
  }

  function handleToggleSaveAsGroup(checked) {
    if (checked && !owner) {
      setPendingOwnerCheckbox('group')
      setShowOwnerAccessModal(true)
      return
    }

    setSaveAsGroup(checked)
  }

  function handleToggleSaveAsTemplate(checked) {
    if (checked && !owner) {
      setPendingOwnerCheckbox('template')
      setShowOwnerAccessModal(true)
      return
    }

    setSaveAsTemplate(checked)
  }

  function handleOwnerAccessGranted(nextOwner) {
    setOwner(nextOwner)
    setShowOwnerAccessModal(false)

    if (pendingOwnerCheckbox === 'group') {
      setSaveAsGroup(true)
    } else if (pendingOwnerCheckbox === 'template') {
      setSaveAsTemplate(true)
    }

    setPendingOwnerCheckbox(null)
  }

  function handlePickGroup(group) {
    setInvitees((current) => mergeInvitees(current, group.members))
  }

  function handleUseTemplate(template) {
    setForm((current) => ({
      ...current,
      name: template.eventName,
      location: template.location,
      description: template.description,
      requirePhone: template.requirePhone,
    }))

    const defaultGroup = ownerPayload.groups.find((group) => group.id === template.defaultGroupId)

    if (defaultGroup) {
      setShowInvites(true)
      setInvitees((current) => mergeInvitees(current, defaultGroup.members))
    }

    toast.success(t('createEvent.templateLoaded', { name: template.name }))
  }

  useEffect(() => {
    if (!owner) {
      return undefined
    }

    let cancelled = false

    getOwnerPayload(owner.ownerId, owner.token)
      .then((nextPayload) => {
        if (!cancelled) {
          setOwnerPayload(nextPayload)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOwnerPayload({ groups: [], templates: [] })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHasLoadedOwnerPayload(true)
        }
      })

    return () => {
      cancelled = true
    }
  }, [owner])

  useEffect(() => {
    let cancelled = false

    async function loadRecentEvents() {
      setIsLoadingRecentEvents(true)

      try {
        const ids = getSavedOrganizerEventIds().slice(-6).reverse()

        if (ids.length === 0) {
          if (!cancelled) {
            setRecentEvents([])
          }

          return
        }

        const results = await Promise.allSettled(ids.map((eventId) => getEvent(eventId)))
        const nextEvents = []

        results.forEach((result, index) => {
          const eventId = ids[index]

          if (result.status === 'fulfilled' && result.value?.event) {
            nextEvents.push({
              id: eventId,
              event: result.value.event,
            })
            return
          }

          clearSavedOrganizerToken(eventId)
        })

        if (!cancelled) {
          setRecentEvents(nextEvents)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRecentEvents(false)
        }
      }
    }

    loadRecentEvents()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PageShell
      eyebrow={t('createEvent.eyebrow')}
      title="R U in?"
      subtitle={t('createEvent.subtitle')}
      actions={
        <>
          <Link to="/moje" className="secondary-button">
            {t('owner.title')}
          </Link>
          <AddToHomeButton />
        </>
      }
    >
      <main className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
        <section className="order-2 space-y-6 xl:order-1">
          <article className="panel relative overflow-hidden">
            <div className="pointer-events-none absolute -right-20 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(111,76,255,0.18),transparent_68%)] blur-2xl dark:bg-[radial-gradient(circle,rgba(111,76,255,0.24),transparent_68%)]" />
            <div className="pointer-events-none absolute -left-16 bottom-0 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(122,28,63,0.18),transparent_66%)] blur-2xl dark:bg-[radial-gradient(circle,rgba(122,28,63,0.28),transparent_66%)]" />
            <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] xl:items-end">
              <div>
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.28em]">{t('createEvent.heroEyebrow')}</p>
                <h2 className="mt-4 max-w-2xl text-4xl font-black tracking-[-0.06em] text-slate-950 dark:text-slate-50 sm:text-5xl lg:text-6xl">
                  {t('createEvent.heroTitle')}
                </h2>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                  {t('createEvent.heroText')}
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a href="#create-form" className="primary-button">
                    {t('createEvent.startCreating')}
                  </a>
                  <Link to="/poll/new" className="secondary-button">
                    {t('createEvent.pollFirst')}
                  </Link>
                  <span className="hero-badge inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-4 py-3 text-sm font-medium text-slate-600 shadow-sm">
                    {t('createEvent.noSignup')}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">{t('createEvent.speedLabel')}</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">{t('createEvent.speedValue')}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('createEvent.speedText')}</p>
                </div>
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">{t('createEvent.flowLabel')}</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">{t('createEvent.flowValue')}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('createEvent.flowText')}</p>
                </div>
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">{t('createEvent.statusLabel')}</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">{t('createEvent.statusValue')}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('createEvent.statusText')}</p>
                </div>
              </div>
            </div>
          </article>

          <section className="grid gap-4 md:grid-cols-3">
            {whyItWorks.map((item, index) => (
              <article key={item} className="surface-subtle">
                <p className="accent-copy text-xs font-semibold uppercase tracking-[0.24em]">0{index + 1}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{item}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">01</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">{t('createEvent.stepShareTitle')}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('createEvent.stepShareText')}</p>
            </article>
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">02</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">{t('createEvent.stepCollectTitle')}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('createEvent.stepCollectText')}</p>
            </article>
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">03</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">{t('createEvent.stepDecideTitle')}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('createEvent.stepDecideText')}</p>
            </article>
          </section>

        </section>

        <aside id="create-form" className="panel order-1 h-fit xl:order-2 xl:sticky xl:top-6">
          <div className="mb-6">
            <CollapsibleCard eyebrow={t('createEvent.recentEyebrow')} title={t('createEvent.recentTitle')} defaultOpen={false}>
              {isLoadingRecentEvents ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">{t('createEvent.recentLoading')}</p>
              ) : null}

              {!isLoadingRecentEvents && recentEvents.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">{t('createEvent.recentEmpty')}</p>
              ) : null}

              {!isLoadingRecentEvents && recentEvents.length > 0 ? (
                <div className="space-y-3">
                  {recentEvents.map(({ id: eventId, event }) => (
                    <article key={eventId} className="rounded-2xl border border-slate-200 bg-white/65 p-3 dark:border-slate-700 dark:bg-slate-950/35">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{event.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(event.datetime)} · {event.location}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/event/${eventId}/manage`} className="secondary-button px-3 py-1.5 text-xs">
                          {t('createEvent.openManage')}
                        </Link>
                        <Link to={`/event/${eventId}`} className="secondary-button px-3 py-1.5 text-xs">
                          {t('common.openInvite')}
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </CollapsibleCard>
          </div>

          <div className="mb-6">
            <TemplatesPanel
              templates={ownerPayload.templates}
              isLoading={isLoadingOwnerPayload}
              onUseTemplate={handleUseTemplate}
            />
          </div>

          <div className="mb-6">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">{t('createEvent.composerEyebrow')}</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">
              {t('createEvent.composerTitle')}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {t('createEvent.composerText')}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('createEvent.organizerName')}</label>
                <input
                  className="field"
                  value={form.organizerName}
                  onChange={updateField('organizerName')}
                  placeholder={t('common.namePlaceholder')}
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('pin.label')}</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  className="field"
                  value={form.organizerPin}
                  onChange={updateField('organizerPin')}
                  placeholder={t('createEvent.pinPlaceholder')}
                  required
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t('createEvent.pinHint')}</p>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('eventForm.name')}</label>
              <input
                className="field"
                value={form.name}
                onChange={updateField('name')}
                placeholder={t('createEvent.namePlaceholder')}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('eventForm.location')}</label>
              <input
                className="field"
                value={form.location}
                onChange={updateField('location')}
                placeholder={t('createEvent.locationPlaceholder')}
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('eventForm.dateTime')}</label>
              <EventDateTimePicker
                value={form.datetime}
                onChange={(nextValue) => setForm((current) => ({ ...current, datetime: nextValue }))}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('eventForm.description')}</label>
              <textarea
                className="field min-h-32"
                value={form.description}
                onChange={updateField('description')}
                placeholder={t('eventForm.descriptionPlaceholder')}
                required
              />
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                checked={form.requirePhone}
                onChange={(e) => setForm((current) => ({ ...current, requirePhone: e.target.checked }))}
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
                  checked={form.enableBringList}
                  onChange={(e) => setForm((current) => ({ ...current, enableBringList: e.target.checked }))}
                />
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.bringList')}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('eventForm.bringListHint')}</p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                  checked={form.enableCarpool}
                  onChange={(e) => setForm((current) => ({ ...current, enableCarpool: e.target.checked }))}
                />
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.carpool')}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('eventForm.carpoolHint')}</p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                  checked={form.enableStops}
                  onChange={(e) => {
                    const checked = e.target.checked
                    setForm((current) => ({ ...current, enableStops: checked }))
                    if (!checked) {
                      setShowAfterparty(false)
                    }
                  }}
                />
                <div>
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.stops')}</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('eventForm.stopsHint')}</p>
                </div>
              </label>
            </div>

            {form.enableBringList ? (
              <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.bringList')}</p>
                <div className="mt-3">
                  <SignupItemEditor category="bring" items={bringItems} onChange={setBringItems} disabled={isSubmitting} />
                </div>
              </div>
            ) : null}

            {form.enableCarpool ? (
              <div className="rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.carpool')}</p>
                <div className="mt-3">
                  <SignupItemEditor category="ride" items={rideItems} onChange={setRideItems} disabled={isSubmitting} />
                </div>
              </div>
            ) : null}

            <CollapsibleCard eyebrow={t('createEvent.extrasEyebrow')} title={t('createEvent.extrasTitle')} defaultOpen={false}>
              <div className="space-y-4">
                {form.enableStops ? (
                  <div>
                    <button
                      type="button"
                      onClick={handleAfterpartyClick}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-black tracking-[-0.01em] text-white shadow-lg"
                      style={{
                        background: 'linear-gradient(135deg, #6f4cff, #a78bfa, #f472b6)',
                        animation: showAfterparty ? 'none' : 'party-pulse 1.8s ease-in-out infinite',
                      }}
                    >
                      🎉 {showAfterparty ? t('createEvent.afterpartyClose') : t('createEvent.afterpartyOpen')} 🎉
                    </button>

                    {showAfterparty ? (
                      <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('createEvent.afterpartyLocation')}</label>
                          <input
                            className="field"
                            value={afterpartyLocation}
                            onChange={(event) => setAfterpartyLocation(event.target.value)}
                            placeholder={t('createEvent.afterpartyLocationPlaceholder')}
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">{t('common.time')}</label>
                          <input
                            type="time"
                            className="field"
                            value={afterpartyTime}
                            onChange={(event) => setAfterpartyTime(event.target.value)}
                          />
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div>
                  <button
                    type="button"
                    className="secondary-button w-full justify-center"
                    onClick={() => setShowInvites((current) => !current)}
                  >
                    {showInvites ? t('createEvent.invitesClose') : t('createEvent.invitesOpen')}
                  </button>

                  {showInvites ? (
                    <div className="mt-3 space-y-4 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                      <GroupPicker groups={ownerPayload.groups} onPick={handlePickGroup} disabled={isSubmitting} />
                      <InviteListEditor invitees={invitees} onChange={setInvitees} disabled={isSubmitting} />

                      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                          checked={saveAsGroup}
                          onChange={(event) => handleToggleSaveAsGroup(event.target.checked)}
                          disabled={isSubmitting}
                        />
                        <div className="w-full">
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('createEvent.saveAsGroup')}</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('createEvent.saveAsGroupHint')}</p>
                          {saveAsGroup ? (
                            <input
                              className="field mt-3"
                              value={groupName}
                              onChange={(event) => setGroupName(event.target.value)}
                              placeholder={t('createEvent.groupNamePlaceholder')}
                              disabled={isSubmitting}
                            />
                          ) : null}
                        </div>
                      </label>
                    </div>
                  ) : null}
                </div>

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                    checked={saveAsTemplate}
                    onChange={(event) => handleToggleSaveAsTemplate(event.target.checked)}
                    disabled={isSubmitting}
                  />
                  <div className="w-full">
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('createEvent.saveAsTemplate')}</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('createEvent.saveAsTemplateHint')}</p>
                    {saveAsTemplate ? (
                      <input
                        className="field mt-3"
                        value={templateName}
                        onChange={(event) => setTemplateName(event.target.value)}
                        placeholder={t('createEvent.templateNamePlaceholder')}
                        disabled={isSubmitting}
                      />
                    ) : null}
                  </div>
                </label>
              </div>
            </CollapsibleCard>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
                {isSubmitting ? t('createEvent.submitting') : t('createEvent.submit')}
              </button>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {t('createEvent.submitHint')}
              </p>
            </div>
          </form>
        </aside>
      </main>

      <ConfettiBurst origin={confettiOrigin} burstKey={burstKey} />

      <OwnerAccessModal
        open={showOwnerAccessModal}
        onClose={() => {
          setShowOwnerAccessModal(false)
          setPendingOwnerCheckbox(null)
        }}
        onAccessGranted={handleOwnerAccessGranted}
      />
    </PageShell>
  )
}

export default CreateEventPage