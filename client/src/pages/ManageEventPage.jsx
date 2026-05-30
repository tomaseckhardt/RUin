import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AddToCalendarButton from '../components/AddToCalendarButton.jsx'
import AttendeeList from '../components/AttendeeList.jsx'
import EventChat from '../components/EventChat.jsx'
import PageShell from '../components/PageShell.jsx'
import { deleteAttendee, getEvent, moderateAttendee, pingAttendee, removeEvent } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'

const AUTO_REFRESH_MS = 10000

async function fetchEventPayload(id) {
  return getEvent(id)
}

function ManageEventPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [payload, setPayload] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [pingBusyId, setPingBusyId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const inviteUrl = useMemo(() => buildAbsoluteUrl(`/event/${id}`), [id])

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
      if (!token) {
        if (!cancelled) {
          setError('Chybí organizátorský token v odkazu.')
          setIsLoading(false)
        }

        return
      }

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

  useEffect(() => {
    if (!token) {
      return undefined
    }

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
  }, [id, token])

  async function handleModeration(attendeeId, status) {
    setBusyId(attendeeId)

    try {
      await moderateAttendee(id, attendeeId, { token, status })
      toast.success(status === 'excused_accepted' ? 'Omluvenka schválená.' : 'Omluvenka zamítnutá.')
      await loadEvent()
    } catch (actionError) {
      toast.error(actionError.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete() {
    if (!token) {
      toast.error('Chybí organizátorský token v odkazu.')
      return
    }

    const confirmed = window.confirm('Opravdu chceš tuhle akci smazat? Tohle nejde vrátit zpět.')

    if (!confirmed) {
      return
    }

    setIsDeleting(true)

    try {
      await removeEvent(id, token)
      toast.success('Akce byla smazaná.')
      navigate('/')
    } catch (actionError) {
      toast.error(actionError.message)
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleDeleteAttendee(attendeeId, attendeeName) {
    if (!token) {
      toast.error('Chybí organizátorský token v odkazu.')
      return
    }

    const confirmed = window.confirm(`Opravdu chceš smazat účastníka ${attendeeName}?`)

    if (!confirmed) {
      return
    }

    setDeleteBusyId(attendeeId)

    try {
      await deleteAttendee(id, attendeeId, token)
      toast.success('Účastník byl smazaný.')
      await loadEvent()
    } catch (deleteError) {
      toast.error(deleteError.message)
    } finally {
      setDeleteBusyId(null)
    }
  }

  async function handlePing(attendeeId, sourceName) {
    const pingMessage = window.prompt('Přidej zprávu ke šťouchnutí (volitelné, max 280 znaků):', '')

    if (pingMessage === null) {
      return
    }

    setPingBusyId(attendeeId)

    try {
      await pingAttendee(id, attendeeId, sourceName, pingMessage)
      toast.success('Šťouchnutí odeslané.')
      await loadEvent()
    } catch (pingError) {
      toast.error(pingError.message)
    } finally {
      setPingBusyId(null)
    }
  }

  async function handleShare() {
    await navigator.clipboard.writeText(inviteUrl)
    toast.success('Veřejná pozvánka je ve schránce.')
  }

  if (isLoading) {
    return (
      <PageShell eyebrow="Organizátor" title="Načítám přehled akce…" subtitle="Chvilka, sbírám všechna RSVP na jedno místo." />
    )
  }

  if (error || !payload) {
    return (
      <PageShell eyebrow="Organizátor" title="Správa akce není dostupná" subtitle={error || 'Akce nebo odkaz už neexistuje.'} />
    )
  }

  const { event, attendees, summary } = payload
  const organizerName = attendees[0]?.name || ''

  return (
    <PageShell
      eyebrow="host control room"
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <>
          <AddToCalendarButton eventData={event} />
          <button type="button" className="secondary-button" onClick={handleShare}>
            Sdílet pozvánku
          </button>
          <button
            type="button"
            className="secondary-button border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Mažu akci…' : 'Smazat akci'}
          </button>
        </>
      }
    >
      <main className="space-y-6">
        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
          <article className="panel relative overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(135deg,rgba(122,28,63,0.14),rgba(111,76,255,0.1))] dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.26),rgba(111,76,255,0.16))]" />
            <div className="relative">
              <p className="accent-copy text-sm uppercase tracking-[0.25em]">Interní poznámka</p>
              <p className="mt-3 text-lg leading-8 text-slate-700 dark:text-slate-300">{event.description}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="surface-subtle">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Kontrola hostů</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Schvaluj omluvenky nebo je nech čekat.</p>
                </div>
                <div className="surface-subtle">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Jasný přehled</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Vidíš, kdo dorazí a kdo to ještě řeší.</p>
                </div>
                <div className="surface-subtle sm:col-span-2 xl:col-span-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Privátní režim</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Odkaz pro organizátora necháš jen pro sebe.</p>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="stat-tile text-slate-900 dark:text-slate-100">
                  <div className="text-sm font-medium uppercase tracking-[0.18em]">Potvrzeno</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em]">{summary.confirmed}</div>
                </div>
                <div className="stat-tile text-slate-900 dark:text-slate-100">
                  <div className="text-sm font-medium uppercase tracking-[0.18em]">Čeká / omluveno</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em]">{summary.excused}</div>
                </div>
                <div className="stat-tile text-slate-900 dark:text-slate-100">
                  <div className="text-sm font-medium uppercase tracking-[0.18em]">Zamítnuto</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em]">{summary.rejected}</div>
                </div>
              </div>
            </div>
          </article>

          <aside className="space-y-6">
            <section className="panel">
              <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
                Controls
              </p>
              <div className="mt-4 space-y-3">
                <button type="button" className="secondary-button w-full justify-center" onClick={handleShare}>
                  Sdílet pozvánku
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

            <section className="panel">
              <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Soukromý odkaz</p>
              <p className="mt-3 break-all text-sm leading-6 text-slate-700 dark:text-slate-300">
                {buildAbsoluteUrl(`/event/${id}/manage?token=${token}`)}
              </p>
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
                Tenhle link si nech pro sebe. Právě on dovoluje schvalovat omluvenky a mazat akci.
              </p>
              <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                Veřejná pozvánka: <Link className="font-medium text-slate-900 underline dark:text-slate-50" to={`/event/${id}`}>otevřít RSVP stránku</Link>
              </div>
            </section>
          </aside>
        </section>

        <AttendeeList
          attendees={attendees}
          summary={summary}
          showModeration
          onModerate={handleModeration}
          busyId={busyId}
          showPing
          onPing={(attendeeId) => handlePing(attendeeId, organizerName)}
          pingBusyId={pingBusyId}
          canPing={Boolean(organizerName.trim())}
          currentName={organizerName}
          showDelete
          onDelete={handleDeleteAttendee}
          deleteBusyId={deleteBusyId}
        />

        <EventChat
          eventId={id}
          currentName={organizerName}
          canSend={Boolean(organizerName.trim())}
        />
      </main>
    </PageShell>
  )
}

export default ManageEventPage