import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import CollapsibleCard from './CollapsibleCard.jsx'
import { addSignupItem, claimSignupItem, deleteSignupItem, getSignupItems, removeSignupClaim, unclaimSignupItem } from '../lib/api.js'
import { supabase } from '../lib/supabase.js'

function normalizeName(value) {
  return (value || '').trim().toLocaleLowerCase('cs-CZ')
}

const CATEGORY_CONFIG = {
  bring: {
    title: 'Kdo co nese',
    eyebrow: 'Bring list',
    addLabel: 'Přidat věc',
    placeholder: 'Např. Pivo, led, reproduktor…',
    emptyText: 'Zatím nic. Klidně přidej první věc, ale není to povinné.',
    capacityLabel: 'Kolik kusů/lidí stačí',
  },
  ride: {
    title: 'Kdo jede autem',
    eyebrow: 'Spolujízda',
    addLabel: 'Nabídnout odvoz',
    placeholder: 'Např. Auto z Prahy 6, odjezd 17:30',
    emptyText: 'Zatím nikdo nenabídl odvoz. Klidně to napiš, ale není to povinné.',
    capacityLabel: 'Kolik volných míst',
  },
}

function SignupBoard({ eventId, category, currentName, canInteract, isOrganizer = false, organizerToken = null }) {
  const config = CATEGORY_CONFIG[category]
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [label, setLabel] = useState('')
  const [capacity, setCapacity] = useState(1)
  const [note, setNote] = useState('')
  const [busyItemId, setBusyItemId] = useState(null)
  const latestRequestIdRef = useRef(0)
  const itemIdsRef = useRef(new Set())

  useEffect(() => {
    itemIdsRef.current = new Set(items.map((item) => item.id))
  }, [items])

  async function loadItems() {
    const requestId = ++latestRequestIdRef.current

    try {
      const allItems = await getSignupItems(eventId)

      if (requestId !== latestRequestIdRef.current) {
        return
      }

      setItems(allItems.filter((item) => item.category === category))
    } catch (error) {
      if (requestId === latestRequestIdRef.current) {
        toast.error(error.message)
      }
    } finally {
      if (requestId === latestRequestIdRef.current) {
        setIsLoading(false)
      }
    }
  }

  useEffect(() => {
    // Fetch-on-mount-and-eventId/category-change, refreshed again by the
    // realtime subscription below - there's no external system to
    // "subscribe" to for the initial load itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems()

    const channel = supabase
      .channel(`signup-board:${eventId}:${category}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_signup_items', filter: `event_id=eq.${eventId}` }, loadItems)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_signup_claims' }, (payload) => {
        // event_signup_claims has no event_id column to filter server-side on,
        // so only reload when the claim actually belongs to an item on this board.
        const itemId = payload.new?.item_id ?? payload.old?.item_id

        if (itemId !== undefined && !itemIdsRef.current.has(itemId)) {
          return
        }

        loadItems()
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, category])

  async function handleAdd(event) {
    event.preventDefault()

    if (!label.trim()) {
      return
    }

    setIsAdding(true)

    try {
      await addSignupItem(eventId, {
        category,
        label,
        capacity,
        note,
        createdBy: currentName || 'Organizátor',
      })
      setLabel('')
      setCapacity(1)
      setNote('')
      setShowAddForm(false)
      await loadItems()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsAdding(false)
    }
  }

  async function handleClaim(item) {
    if (!currentName?.trim()) {
      toast.error('Napiš svoje jméno v RSVP, ať víme, kdo se hlásí.')
      return
    }

    setBusyItemId(item.id)

    try {
      await claimSignupItem(item.id, currentName)
      await loadItems()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusyItemId(null)
    }
  }

  async function handleUnclaim(item) {
    setBusyItemId(item.id)

    try {
      await unclaimSignupItem(item.id, currentName)
      await loadItems()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusyItemId(null)
    }
  }

  async function handleRemoveClaim(item, claim) {
    setBusyItemId(item.id)

    try {
      await removeSignupClaim(item.id, claim.attendee_name, currentName)
      await loadItems()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusyItemId(null)
    }
  }

  async function handleDelete(item) {
    if (!organizerToken) {
      return
    }

    setBusyItemId(item.id)

    try {
      await deleteSignupItem(eventId, item.id, organizerToken)
      await loadItems()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusyItemId(null)
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <CollapsibleCard
      eyebrow={config.eyebrow}
      title={config.title}
      headerActions={
        <button type="button" className="secondary-button" onClick={() => setShowAddForm((current) => !current)}>
          {showAddForm ? 'Zavřít' : config.addLabel}
        </button>
      }
    >
      {showAddForm ? (
        <form className="mb-4 space-y-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30" onSubmit={handleAdd}>
          <input
            className="field"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={config.placeholder}
            required
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">{config.capacityLabel}</label>
              <input
                type="number"
                min={1}
                max={20}
                className="field"
                value={capacity}
                onChange={(event) => setCapacity(Number(event.target.value) || 1)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">Poznámka (nepovinné)</label>
              <input className="field" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Odjíždím v 17:30" />
            </div>
          </div>
          <button type="submit" className="primary-button w-full justify-center" disabled={isAdding}>
            {isAdding ? 'Přidávám…' : 'Přidat'}
          </button>
        </form>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{config.emptyText}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const claims = item.event_signup_claims || []
            const claimedSeats = claims.reduce((sum, claim) => sum + claim.seats, 0)
            const isFull = claimedSeats >= item.capacity
            const myClaim = currentName ? claims.find((claim) => claim.attendee_name.toLocaleLowerCase('cs-CZ') === currentName.trim().toLocaleLowerCase('cs-CZ')) : null
            const isOwnRide = category === 'ride' && currentName?.trim() && normalizeName(item.created_by) === normalizeName(currentName)

            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
                    {item.note ? <p className="text-xs text-slate-500 dark:text-slate-400">{item.note}</p> : null}
                    {claims.length > 0 ? (
                      isOwnRide ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {claims.map((claim) => (
                            <span
                              key={claim.id}
                              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/60 py-1 pl-2.5 pr-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300"
                            >
                              {claim.attendee_name}
                              <button
                                type="button"
                                className="rounded-full px-1.5 py-0.5 text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                disabled={busyItemId === item.id}
                                onClick={() => handleRemoveClaim(item, claim)}
                              >
                                Nabídnout výměnu
                              </button>
                            </span>
                          ))}
                          <span className="text-xs text-slate-400 dark:text-slate-500">({claimedSeats}/{item.capacity})</span>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {claims.map((claim) => claim.attendee_name).join(', ')} ({claimedSeats}/{item.capacity})
                        </p>
                      )
                    ) : (
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Zatím nikdo ({item.capacity} volných)</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {isOwnRide ? (
                      <span className="status-chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">Tvoje nabídka</span>
                    ) : myClaim ? (
                      <button
                        type="button"
                        className="secondary-button px-3 py-1.5 text-xs"
                        disabled={busyItemId === item.id}
                        onClick={() => handleUnclaim(item)}
                      >
                        Odhlásit se
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button px-3 py-1.5 text-xs"
                        disabled={!canInteract || isFull || busyItemId === item.id}
                        onClick={() => handleClaim(item)}
                      >
                        {isFull ? 'Obsazeno' : 'Přihlásit se'}
                      </button>
                    )}
                    {isOrganizer ? (
                      <button
                        type="button"
                        className="secondary-button border-rose-200 bg-rose-50 px-3 py-1.5 text-xs text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                        disabled={busyItemId === item.id}
                        onClick={() => handleDelete(item)}
                      >
                        Smazat
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </CollapsibleCard>
  )
}

export default SignupBoard
