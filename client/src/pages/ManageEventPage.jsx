import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AttendeeList from '../components/AttendeeList.jsx'
import PageShell from '../components/PageShell.jsx'
import { getEvent, moderateAttendee, removeEvent } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'

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

  return (
    <PageShell
      eyebrow="Organizátorský přehled"
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <>
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
      <main className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(350px,0.9fr)]">
        <section className="space-y-6">
          <article className="panel">
            <p className="text-sm uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">Interní poznámka</p>
            <p className="mt-3 text-lg leading-8 text-slate-700 dark:text-slate-300">{event.description}</p>
            <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              Veřejná pozvánka: <Link className="font-medium text-slate-900 underline dark:text-slate-50" to={`/event/${id}`}>otevřít RSVP stránku</Link>
            </div>
          </article>

          <AttendeeList
            attendees={attendees}
            summary={summary}
            showModeration
            onModerate={handleModeration}
            busyId={busyId}
          />
        </section>

        <aside className="space-y-6">
          <section className="panel">
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
              Přehled hostů
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100">
                <div className="text-sm font-medium uppercase tracking-[0.18em]">Potvrzeno</div>
                <div className="mt-2 text-3xl font-semibold">{summary.confirmed}</div>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100">
                <div className="text-sm font-medium uppercase tracking-[0.18em]">Čeká / omluveno</div>
                <div className="mt-2 text-3xl font-semibold">{summary.excused}</div>
              </div>
              <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-100">
                <div className="text-sm font-medium uppercase tracking-[0.18em]">Zamítnuto</div>
                <div className="mt-2 text-3xl font-semibold">{summary.rejected}</div>
              </div>
            </div>
          </section>

          <section className="panel">
            <p className="text-sm font-medium uppercase tracking-[0.25em] text-slate-500 dark:text-slate-400">
              Soukromý odkaz
            </p>
            <p className="mt-3 break-all text-sm leading-6 text-slate-700 dark:text-slate-300">
              {buildAbsoluteUrl(`/event/${id}/manage?token=${token}`)}
            </p>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              Tenhle link si nech pro sebe. Právě on dovoluje schvalovat omluvenky a mazat akci.
            </p>
          </section>
        </aside>
      </main>
    </PageShell>
  )
}

export default ManageEventPage