import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import CollapsibleCard from './CollapsibleCard.jsx'
import { addEventStop, deleteEventStop, getEventStops } from '../lib/api.js'
import { subscribeToEventTicks } from '../lib/realtimeTick.js'

function EventStops({ eventId, isOrganizer = false, organizerToken = null }) {
  const [stops, setStops] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [startsAtLabel, setStartsAtLabel] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function loadStops() {
    try {
      setStops(await getEventStops(eventId))
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    // Fetch-on-mount-and-eventId-change, refreshed again by the realtime
    // tick subscription below - there's no external system to "subscribe" to
    // for the initial load itself, so this has to call loadStops directly.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStops()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  useEffect(() => {
    return subscribeToEventTicks(eventId, ['stop'], loadStops)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  async function handleAdd(event) {
    event.preventDefault()

    if (!name.trim()) {
      return
    }

    setIsSaving(true)

    try {
      await addEventStop(eventId, organizerToken, { name, location, startsAtLabel })
      setName('')
      setLocation('')
      setStartsAtLabel('')
      setShowAddForm(false)
      await loadStops()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(stop) {
    const confirmed = window.confirm(`Opravdu chceš smazat zastávku ${stop.name}?`)

    if (!confirmed) {
      return
    }

    try {
      await deleteEventStop(eventId, organizerToken, stop.id)
      await loadStops()
    } catch (error) {
      toast.error(error.message)
    }
  }

  if (isLoading || (stops.length === 0 && !isOrganizer)) {
    return null
  }

  return (
    <CollapsibleCard
      eyebrow="Program večera"
      title="Zastávky"
      headerActions={
        isOrganizer ? (
          <button type="button" className="secondary-button" onClick={() => setShowAddForm((current) => !current)}>
            {showAddForm ? 'Zavřít' : 'Přidat zastávku'}
          </button>
        ) : null
      }
    >
      {showAddForm ? (
        <form className="mb-4 grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30 sm:grid-cols-3" onSubmit={handleAdd}>
          <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Např. Hospoda U Fleků" required />
          <input className="field" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Místo (nepovinné)" />
          <div className="flex gap-2">
            <input className="field" value={startsAtLabel} onChange={(event) => setStartsAtLabel(event.target.value)} placeholder="18:00" />
            <button type="submit" className="primary-button shrink-0" disabled={isSaving}>
              {isSaving ? '…' : 'Přidat'}
            </button>
          </div>
        </form>
      ) : null}

      {stops.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Zatím žádná zastávka. Klidně přidej itinerář na celý večer.</p>
      ) : (
        <ol className="space-y-3">
          {stops.map((stop, index) => (
            <li key={stop.id} className="flex items-start gap-3 rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-xs font-bold text-fuchsia-800 dark:bg-fuchsia-950/60 dark:text-fuchsia-300">
                {index + 1}
              </span>
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{stop.name}</p>
                  {stop.starts_at_label ? <span className="status-chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{stop.starts_at_label}</span> : null}
                </div>
                {stop.location ? <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{stop.location}</p> : null}
              </div>
              {isOrganizer ? (
                <button type="button" className="text-xs text-rose-600 hover:underline dark:text-rose-300" onClick={() => handleDelete(stop)}>
                  Smazat
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </CollapsibleCard>
  )
}

export default EventStops
