import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import CollapsibleCard from './CollapsibleCard.jsx'
import { addSignupItem, claimSignupItem, deleteSignupItem, getSignupItems, removeSignupClaim, unclaimSignupItem } from '../lib/api.js'
import { useI18n } from '../lib/i18n.js'
import { subscribeToEventTicks } from '../lib/realtimeTick.js'
import { normalizeName } from '../lib/normalizeName.js'

function SignupBoard({ eventId, category, currentName, canInteract, isOrganizer = false, organizerToken = null }) {
  const { t } = useI18n()
  // Keys under signup.bring / signup.ride, matching the category.
  const copy = (field) => t(`signup.${category}.${field}`)
  const [items, setItems] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isAdding, setIsAdding] = useState(false)
  const [showAddForm, setShowAddForm] = useState(false)
  const [label, setLabel] = useState('')
  const [capacity, setCapacity] = useState(1)
  const [note, setNote] = useState('')
  // Ids of items with a change in flight - several can run at once.
  const [busyItemIds, setBusyItemIds] = useState(() => new Set())
  const latestRequestIdRef = useRef(0)

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
    // Load now, and again whenever a realtime tick says the lists changed.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadItems()
    return subscribeToEventTicks(eventId, ['signup_item', 'signup_claim'], loadItems)
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
        createdBy: currentName || t('common.organizer'),
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

  // Runs one change to an item with the item marked busy, then reloads.
  async function runItemAction(item, action) {
    setBusyItemIds((current) => new Set(current).add(item.id))

    try {
      await action()
      await loadItems()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setBusyItemIds((current) => {
        const next = new Set(current)
        next.delete(item.id)
        return next
      })
    }
  }

  function handleClaim(item) {
    if (!currentName?.trim()) {
      toast.error(t('signup.nameRequired'))
      return
    }

    runItemAction(item, () => claimSignupItem(item.id, currentName))
  }

  function handleDelete(item) {
    if (window.confirm(t('signup.confirmDelete', { label: item.label }))) {
      runItemAction(item, () => deleteSignupItem(eventId, item.id, organizerToken))
    }
  }

  if (isLoading) {
    return null
  }

  return (
    <CollapsibleCard
      eyebrow={copy('eyebrow')}
      title={copy('title')}
      headerActions={
        <button type="button" className="secondary-button" onClick={() => setShowAddForm((current) => !current)}>
          {showAddForm ? t('common.close') : copy('addLabel')}
        </button>
      }>
      {showAddForm ? (
        <form
          className="mb-4 space-y-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30"
          onSubmit={handleAdd}>
          <input className="field" value={label} onChange={(event) => setLabel(event.target.value)} placeholder={copy('placeholder')} required />
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">{copy('capacityLabel')}</label>
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
              <label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">{t('common.noteOptional')}</label>
              <input className="field" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('signup.notePlaceholder')} />
            </div>
          </div>
          <button type="submit" className="primary-button w-full justify-center" disabled={isAdding}>
            {isAdding ? t('signup.adding') : t('common.add')}
          </button>
        </form>
      ) : null}

      {items.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{copy('emptyText')}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const claims = item.event_signup_claims || []
            const claimedSeats = claims.reduce((sum, claim) => sum + claim.seats, 0)
            const isFull = claimedSeats >= item.capacity
            const myClaim = currentName?.trim() ? claims.find((claim) => normalizeName(claim.attendee_name) === normalizeName(currentName)) : null
            const isOwnRide = category === 'ride' && currentName?.trim() && normalizeName(item.created_by) === normalizeName(currentName)
            // The driver can let a passenger go; the organizer can remove anyone.
            const claimRemoval = isOwnRide
              ? { label: t('signup.offerSwap'), token: null }
              : isOrganizer
                ? { label: t('common.remove'), token: organizerToken }
                : null

            return (
              <div key={item.id} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-700">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.label}</p>
                    {item.note ? <p className="text-xs text-slate-500 dark:text-slate-400">{item.note}</p> : null}
                    {claims.length > 0 ? (
                      claimRemoval ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {claims.map((claim) => (
                            <span
                              key={claim.id}
                              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/60 py-1 pl-2.5 pr-1.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300">
                              {claim.attendee_name}
                              <button
                                type="button"
                                className="rounded-full px-1.5 py-0.5 text-rose-600 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950/40"
                                disabled={busyItemIds.has(item.id)}
                                onClick={() =>
                                  runItemAction(item, () => removeSignupClaim(item.id, claim.attendee_name, currentName, claimRemoval.token))
                                }>
                                {claimRemoval.label}
                              </button>
                            </span>
                          ))}
                          <span className="text-xs text-slate-400 dark:text-slate-500">
                            ({claimedSeats}/{item.capacity})
                          </span>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          {claims.map((claim) => claim.attendee_name).join(', ')} ({claimedSeats}/{item.capacity})
                        </p>
                      )
                    ) : (
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{t('signup.nobodyYet', { count: item.capacity })}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {isOwnRide ? (
                      <span className="status-chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{t('signup.yourOffer')}</span>
                    ) : myClaim ? (
                      <button
                        type="button"
                        className="secondary-button px-3 py-1.5 text-xs"
                        disabled={busyItemIds.has(item.id)}
                        onClick={() => runItemAction(item, () => unclaimSignupItem(item.id, currentName))}>
                        {t('signup.unclaim')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button px-3 py-1.5 text-xs"
                        disabled={!canInteract || isFull || busyItemIds.has(item.id)}
                        onClick={() => handleClaim(item)}>
                        {isFull ? t('signup.full') : t('signup.claim')}
                      </button>
                    )}
                    {isOrganizer ? (
                      <button
                        type="button"
                        className="secondary-button danger-button px-3 py-1.5 text-xs"
                        disabled={busyItemIds.has(item.id)}
                        onClick={() => handleDelete(item)}>
                        {t('common.delete')}
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
