import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import ModalOverlay from './ModalOverlay.jsx'
import InviteListEditor from './InviteListEditor.jsx'
import GroupPicker from './GroupPicker.jsx'
import { getOwnerPayload, inviteAttendees } from '../lib/api.js'
import { createEmptyInvitee, getFilledInvitees, mergeInvitees } from '../lib/invitees.js'
import { getSavedOwner } from '../lib/ownerLinkStorage.js'

// Rendered only while the modal is open (see InvitePeopleModal below), so
// every field here starts fresh each time it's opened - no reset-on-open
// effect needed, ModalOverlay unmounting this on close already clears it.
function InvitePeopleForm({ eventId, token, onClose, onInvited }) {
  const [invitees, setInvitees] = useState(() => [createEmptyInvitee()])
  const [groups, setGroups] = useState([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    const owner = getSavedOwner()

    if (!owner) {
      return undefined
    }

    let cancelled = false

    getOwnerPayload(owner.ownerId, owner.token)
      .then((payload) => {
        if (!cancelled) {
          setGroups(payload.groups ?? [])
        }
      })
      .catch(() => {
        if (!cancelled) {
          setGroups([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  function handlePickGroup(group) {
    setInvitees((current) => mergeInvitees(current, group.members))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const filled = getFilledInvitees(invitees)

    if (filled.length === 0) {
      toast.error('Vyplň alespoň jednu osobu k pozvání.')
      return
    }

    setIsSubmitting(true)

    try {
      await inviteAttendees(eventId, token, filled)
      toast.success('Pozvánky uložené.')
      onClose()
      await onInvited?.()
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:rounded-[1.75rem] sm:p-6">
      <div className="mb-5">
        <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Pozvat lidi</p>
        <h3 id="invite-people-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
          Přidej jméno a telefon
        </h3>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
          Objeví se v seznamu jako „Pozváno“, dokud sami neodpoví.
        </p>
      </div>

      <GroupPicker groups={groups} onPick={handlePickGroup} disabled={isSubmitting} />

      <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
        <InviteListEditor invitees={invitees} onChange={setInvitees} disabled={isSubmitting} />

        <div className="flex gap-3">
          <button type="button" className="secondary-button flex-1 justify-center" onClick={onClose} disabled={isSubmitting}>
            Zrušit
          </button>
          <button type="submit" className="primary-button flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Pozývám…' : 'Pozvat'}
          </button>
        </div>
      </form>
    </div>
  )
}

function InvitePeopleModal({ open, onClose, eventId, token, onInvited }) {
  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy="invite-people-title">
      <InvitePeopleForm eventId={eventId} token={token} onClose={onClose} onInvited={onInvited} />
    </ModalOverlay>
  )
}

export default InvitePeopleModal
