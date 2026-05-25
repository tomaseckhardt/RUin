import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useParams } from 'react-router-dom'
import AttendeeList from '../components/AttendeeList.jsx'
import PageShell from '../components/PageShell.jsx'
import { getEvent, submitRsvp } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'

async function fetchEventPayload(id) {
  return getEvent(id)
}

function EventPage() {
  const { id } = useParams()
  const [payload, setPayload] = useState(null)
  const [name, setName] = useState('')
  const [excuseReason, setExcuseReason] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('confirmed')
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
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
      eyebrow="Veřejná pozvánka"
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <button type="button" className="secondary-button" onClick={copyInviteLink}>
          Sdílet pozvánku
        </button>
      }
    >
      <main className="grid gap-6 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,0.95fr)]">
        <section className="space-y-6">
          <article className="panel">
            <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Co se chystá</p>
            <p className="mt-3 text-lg leading-8 text-slate-700">{event.description}</p>
          </article>

          <AttendeeList attendees={attendees} summary={summary} />
        </section>

        <aside className="panel h-fit lg:sticky lg:top-6">
          <p className="text-sm font-semibold uppercase tracking-[0.25em] text-orange-600">
            Odpověz organizátorovi
          </p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Přijdeš, nebo se omlouváš?</h2>
          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-sm font-semibold text-slate-700">Tvoje jméno</label>
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
                className={`rounded-[1.5rem] border px-4 py-4 text-left transition ${selectedStatus === 'confirmed' ? 'border-emerald-300 bg-emerald-50 text-emerald-900 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-200'}`}
                onClick={() => setSelectedStatus('confirmed')}
              >
                <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
                  Potvrzuji účast
                </span>
                <span className="mt-2 block text-sm text-slate-500">Jdeš a chceš být v zelené části seznamu.</span>
              </button>
              <button
                type="button"
                className={`rounded-[1.5rem] border px-4 py-4 text-left transition ${selectedStatus === 'excused' ? 'border-orange-300 bg-orange-50 text-orange-900 shadow-sm' : 'border-slate-200 bg-white text-slate-700 hover:border-orange-200'}`}
                onClick={() => setSelectedStatus('excused')}
              >
                <span className="block text-sm font-semibold uppercase tracking-[0.2em] text-orange-700">
                  Omlouvám se
                </span>
                <span className="mt-2 block text-sm text-slate-500">Klidně připiš důvod, ať je to aspoň uvěřitelné.</span>
              </button>
            </div>

            {selectedStatus === 'excused' ? (
              <div>
                <label className="mb-2 block text-sm font-semibold text-slate-700">Důvod omluvy</label>
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
      </main>
    </PageShell>
  )
}

export default EventPage