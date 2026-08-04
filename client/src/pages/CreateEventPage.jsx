import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate } from 'react-router-dom'
import AddToHomeButton from '../components/AddToHomeButton.jsx'
import BringListEditor from '../components/BringListEditor.jsx'
import CollapsibleCard from '../components/CollapsibleCard.jsx'
import ConfettiBurst from '../components/ConfettiBurst.jsx'
import EventDateTimePicker from '../components/EventDateTimePicker.jsx'
import GroupPicker from '../components/GroupPicker.jsx'
import InviteListEditor from '../components/InviteListEditor.jsx'
import OwnerAccessModal from '../components/OwnerAccessModal.jsx'
import PageShell from '../components/PageShell.jsx'
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
import { createEmptyBringItem, getFilledBringItems } from '../lib/bringItems.js'
import { formatDateTime, parseLocalDateTime } from '../lib/format.js'
import { createEmptyInvitee, getFilledInvitees, mergeInvitees } from '../lib/invitees.js'
import { clearSavedOrganizerToken, getSavedOrganizerEventIds } from '../lib/organizerLinkStorage.js'
import { getSavedOwner } from '../lib/ownerLinkStorage.js'

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
  const [showBringItems, setShowBringItems] = useState(false)
  const [bringItems, setBringItems] = useState(() => [createEmptyBringItem()])
  const [saveAsGroup, setSaveAsGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [templateName, setTemplateName] = useState('')
  const [showOwnerAccessModal, setShowOwnerAccessModal] = useState(false)
  const [pendingOwnerCheckbox, setPendingOwnerCheckbox] = useState(null)

  const whyItWorks = [
    'Všichni vidí stejný plán, žádné ztracené zprávy v chatu.',
    'Odpověď je na jedno kliknutí, takže lidi to fakt vyplní.',
    'Organizátor má backstage odkaz a drží věci pod kontrolou.',
  ]

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.datetime) {
      toast.error('Vyber datum a čas akce.')
      return
    }

    const parsedDatetime = parseLocalDateTime(form.datetime)

    if (!parsedDatetime || parsedDatetime.getTime() <= Date.now()) {
      toast.error('Datum a čas akce musí být v budoucnosti.')
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
          toast.error(`Akce je založená, ale afterparty se nepodařilo uložit: ${afterpartyError.message}`)
        }
      }

      const filledInvitees = getFilledInvitees(invitees)

      if (filledInvitees.length > 0 && organizerToken) {
        try {
          await inviteAttendees(payload.event.id, organizerToken, filledInvitees)
        } catch (inviteError) {
          toast.error(`Akce je založená, ale pozvánky se nepodařilo uložit: ${inviteError.message}`)
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
          toast.error(`Akce je založená, ale skupinu se nepodařilo uložit: ${groupError.message}`)
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
          toast.error(`Akce je založená, ale šablonu se nepodařilo uložit: ${templateError.message}`)
        }
      }

      if (form.enableBringList) {
        const filledBringItems = getFilledBringItems(bringItems)

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
            toast.error(`Akce je založená, ale položku "${item.label}" se nepodařilo uložit: ${bringError.message}`)
          }
        }
      }

      toast.success('Akce je připravená. Odkazy můžeš rovnou sdílet.')
      setForm(initialForm)
      setShowAfterparty(false)
      setAfterpartyLocation('')
      setAfterpartyTime('')
      setShowInvites(false)
      setInvitees([createEmptyInvitee()])
      setShowBringItems(false)
      setBringItems([createEmptyBringItem()])
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

    toast.success(`Šablona „${template.name}“ je načtená do formuláře.`)
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
      eyebrow="group plans, less chaos"
      title="R U in?"
      subtitle="Pozvánka, co vypadá fresh, funguje rychle a nenechá skupinový chat spadnout do tří dnů ticha a šesti výmluv."
      actions={
        <>
          <Link to="/moje" className="secondary-button">
            Moje skupiny a šablony
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
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.28em]">Organizátor</p>
                <h2 className="mt-4 max-w-2xl text-4xl font-black tracking-[-0.06em] text-slate-950 dark:text-slate-50 sm:text-5xl lg:text-6xl">
                  Vytvoř událost, kterou lidi fakt chtějí otevřít
                </h2>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                  Jedna krásná stránka místo nekonečného přepisování do chatu. Nahoď název, místo a čas, pošli odkaz a hned vidíš, kdo dorazí.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a href="#create-form" className="primary-button">
                    Začít tvořit
                  </a>
                  <Link to="/poll/new" className="secondary-button">
                    Nejdřív hlasování o termínu
                  </Link>
                  <span className="hero-badge inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-4 py-3 text-sm font-medium text-slate-600 shadow-sm">
                    Bez přihlašování, bez zdržování
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">Rychlost</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">30 s</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Připraveno k odeslání během chvilky.</p>
                </div>
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">Flow</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">1 link</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Veřejně pro hosty, privátně pro organizátora.</p>
                </div>
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">Stav</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">Live</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Všechno vidíš přehledně na jednom místě.</p>
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
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">Dropni link</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Veřejná pozvánka jde rovnou do skupiny a všichni mají stejný přehled.</p>
            </article>
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">02</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">Sbírej vibe check</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Lidi kliknou, jestli dorazí nebo pošlou omluvenku i s důvodem.</p>
            </article>
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">03</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">Rozhodni backstage</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Z privátního linku vidíš seznam a držíš nad akcí moderátorský přehled.</p>
            </article>
          </section>

        </section>

        <aside id="create-form" className="panel order-1 h-fit xl:order-2 xl:sticky xl:top-6">
          <div className="mb-6">
            <CollapsibleCard eyebrow="Rychlý vstup" title="Moje poslední akce" defaultOpen={false}>
              {isLoadingRecentEvents ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">Načítám poslední akce…</p>
              ) : null}

              {!isLoadingRecentEvents && recentEvents.length === 0 ? (
                <p className="text-sm text-slate-600 dark:text-slate-300">Zatím tu nic není. Jakmile založíš akci, objeví se tady rychlý vstup do správy.</p>
              ) : null}

              {!isLoadingRecentEvents && recentEvents.length > 0 ? (
                <div className="space-y-3">
                  {recentEvents.map(({ id: eventId, event }) => (
                    <article key={eventId} className="rounded-2xl border border-slate-200 bg-white/65 p-3 dark:border-slate-700 dark:bg-slate-950/35">
                      <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{event.name}</p>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(event.datetime)} · {event.location}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link to={`/event/${eventId}/manage`} className="secondary-button px-3 py-1.5 text-xs">
                          Otevřít správu
                        </Link>
                        <Link to={`/event/${eventId}`} className="secondary-button px-3 py-1.5 text-xs">
                          Otevřít pozvánku
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
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Composer</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">
              Poskládej akci
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Vyplň jen to důležité. Po uložení dostaneš odkaz, který můžeš rovnou poslat do skupiny.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Tvoje jméno (organizátor)</label>
                <input
                  className="field"
                  value={form.organizerName}
                  onChange={updateField('organizerName')}
                  placeholder="Např. Tomáš"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Správcovský PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  className="field"
                  value={form.organizerPin}
                  onChange={updateField('organizerPin')}
                  placeholder="Např. 1234"
                  required
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">4 číslice. Bude potřeba pro vstup do správy akce.</p>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Název akce</label>
              <input
                className="field"
                value={form.name}
                onChange={updateField('name')}
                placeholder="Např. Grilovačka na střeše"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Místo</label>
              <input
                className="field"
                value={form.location}
                onChange={updateField('location')}
                placeholder="Praha 7, dvorek za kavárnou"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Datum a čas</label>
              <EventDateTimePicker
                value={form.datetime}
                onChange={(nextValue) => setForm((current) => ({ ...current, datetime: nextValue }))}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Popis</label>
              <textarea
                className="field min-h-32"
                value={form.description}
                onChange={updateField('description')}
                placeholder="Co se děje, co vzít s sebou a jestli hrozí dress code."
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
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Vyžadovat telefonní číslo</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Učastníci budou muset vyplnit telefon. Z organizátorské stránky pak můžeš na každého přímo zavolat.</p>
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
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Kdo co bere</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Seznam věcí k přinesení, kam se lidi zapisují.</p>
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
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Spolujízda</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Kdo koho sveze, kam se lidi zapisují.</p>
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
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Itinerář / zastávky</p>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Vícero zastávek večera (i afterparty).</p>
                </div>
              </label>
            </div>

            <CollapsibleCard eyebrow="Nepovinné" title="Doplňkové možnosti" defaultOpen={false}>
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
                      🎉 {showAfterparty ? 'Zavřít afterparty' : 'Afterparty?!'} 🎉
                    </button>

                    {showAfterparty ? (
                      <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30 sm:grid-cols-2">
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Kam se jde potom</label>
                          <input
                            className="field"
                            value={afterpartyLocation}
                            onChange={(event) => setAfterpartyLocation(event.target.value)}
                            placeholder="Klub Afterparty, Praha 7"
                          />
                        </div>
                        <div>
                          <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Čas</label>
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

                {form.enableBringList ? (
                  <div>
                    <button
                      type="button"
                      className="secondary-button w-full justify-center"
                      onClick={() => setShowBringItems((current) => !current)}
                    >
                      {showBringItems ? 'Zavřít kdo co bere' : '+ Naplánovat, kdo co bere'}
                    </button>

                    {showBringItems ? (
                      <div className="mt-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30">
                        <BringListEditor items={bringItems} onChange={setBringItems} disabled={isSubmitting} />
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
                    {showInvites ? 'Zavřít pozvané' : '+ Pozvat lidi předem'}
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
                          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Uložit tento seznam jako skupinu</p>
                          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Příště je pozveš znovu jedním kliknutím.</p>
                          {saveAsGroup ? (
                            <input
                              className="field mt-3"
                              value={groupName}
                              onChange={(event) => setGroupName(event.target.value)}
                              placeholder="Např. badminton"
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
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Uložit tuto akci jako šablonu</p>
                    <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Příště založíš podobnou akci jedním kliknutím.</p>
                    {saveAsTemplate ? (
                      <input
                        className="field mt-3"
                        value={templateName}
                        onChange={(event) => setTemplateName(event.target.value)}
                        placeholder="Např. Badminton"
                        disabled={isSubmitting}
                      />
                    ) : null}
                  </div>
                </label>
              </div>
            </CollapsibleCard>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Zakládám akci…' : 'Vytvořit akci'}
              </button>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Po vytvoření dostaneš veřejný odkaz i soukromý organizátorský link.
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