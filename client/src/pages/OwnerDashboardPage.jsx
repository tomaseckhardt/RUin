import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import PageShell from '../components/PageShell.jsx'
import CollapsibleCard from '../components/CollapsibleCard.jsx'
import OwnerAccessModal from '../components/OwnerAccessModal.jsx'
import {
  addContactGroupMember,
  createContactGroup,
  deleteContactGroup,
  deleteEventTemplate,
  getOwnerPayload,
  removeContactGroupMember,
} from '../lib/api.js'
import { clearSavedOwnerIdentity, getSavedOwner } from '../lib/ownerLinkStorage.js'

function isInvalidOwnerTokenError(message) {
  return typeof message === 'string' && message.includes('Neplatný přístupový token')
}

function OwnerDashboardPage() {
  const navigate = useNavigate()
  const [owner, setOwner] = useState(() => getSavedOwner())
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [memberForms, setMemberForms] = useState({})
  const [busyMemberId, setBusyMemberId] = useState(null)
  const isLoading = Boolean(owner) && !payload && !error

  const loadPayload = useCallback(async (activeOwner) => {
    try {
      const nextPayload = await getOwnerPayload(activeOwner.ownerId, activeOwner.token)
      setPayload(nextPayload)
      setError('')
    } catch (loadError) {
      if (isInvalidOwnerTokenError(loadError.message)) {
        clearSavedOwnerIdentity()
        setOwner(null)
        setPayload(null)
        return
      }

      setError(loadError.message)
    }
  }, [])

  useEffect(() => {
    if (!owner) {
      return undefined
    }

    let cancelled = false

    getOwnerPayload(owner.ownerId, owner.token)
      .then((nextPayload) => {
        if (!cancelled) {
          setPayload(nextPayload)
          setError('')
        }
      })
      .catch((loadError) => {
        if (cancelled) {
          return
        }

        if (isInvalidOwnerTokenError(loadError.message)) {
          clearSavedOwnerIdentity()
          setOwner(null)
          setPayload(null)
          return
        }

        setError(loadError.message)
      })

    return () => {
      cancelled = true
    }
  }, [owner])

  function handleAccessGranted(nextOwner) {
    setOwner(nextOwner)
  }

  async function handleCreateGroup(event) {
    event.preventDefault()

    if (!owner || !newGroupName.trim()) {
      return
    }

    setIsCreatingGroup(true)

    try {
      await createContactGroup(owner.ownerId, owner.token, newGroupName)
      toast.success('Skupina uložená.')
      setNewGroupName('')
      await loadPayload(owner)
    } catch (createError) {
      toast.error(createError.message)
    } finally {
      setIsCreatingGroup(false)
    }
  }

  async function handleDeleteGroup(groupId, groupName) {
    if (!owner) {
      return
    }

    const confirmed = window.confirm(`Opravdu chceš smazat skupinu „${groupName}“?`)

    if (!confirmed) {
      return
    }

    try {
      await deleteContactGroup(owner.ownerId, owner.token, groupId)
      toast.success('Skupina byla smazaná.')
      await loadPayload(owner)
    } catch (deleteError) {
      toast.error(deleteError.message)
    }
  }

  function updateMemberForm(groupId, patch) {
    setMemberForms((current) => ({
      ...current,
      [groupId]: { name: '', phone: '', ...current[groupId], ...patch },
    }))
  }

  async function handleAddMember(event, groupId) {
    event.preventDefault()

    if (!owner) {
      return
    }

    const form = memberForms[groupId] || { name: '', phone: '' }

    if (!form.name.trim() || !form.phone.trim()) {
      toast.error('Vyplň jméno i telefon.')
      return
    }

    try {
      await addContactGroupMember(owner.ownerId, owner.token, groupId, form)
      toast.success('Člověk je přidaný.')
      updateMemberForm(groupId, { name: '', phone: '' })
      await loadPayload(owner)
    } catch (addError) {
      toast.error(addError.message)
    }
  }

  async function handleRemoveMember(groupId, memberId) {
    if (!owner) {
      return
    }

    setBusyMemberId(memberId)

    try {
      await removeContactGroupMember(owner.ownerId, owner.token, groupId, memberId)
      await loadPayload(owner)
    } catch (removeError) {
      toast.error(removeError.message)
    } finally {
      setBusyMemberId(null)
    }
  }

  async function handleDeleteTemplate(templateId, templateName) {
    if (!owner) {
      return
    }

    const confirmed = window.confirm(`Opravdu chceš smazat šablonu „${templateName}“?`)

    if (!confirmed) {
      return
    }

    try {
      await deleteEventTemplate(owner.ownerId, owner.token, templateId)
      toast.success('Šablona byla smazaná.')
      await loadPayload(owner)
    } catch (deleteError) {
      toast.error(deleteError.message)
    }
  }

  if (!owner) {
    return (
      <PageShell
        eyebrow="Skupiny a šablony"
        title="Přihlas se telefonem a kódem"
        subtitle="Odtud spravuješ uložené skupiny kontaktů i šablony akcí."
      >
        <OwnerAccessModal open onClose={() => navigate('/')} onAccessGranted={handleAccessGranted} />
      </PageShell>
    )
  }

  if (isLoading) {
    return (
      <PageShell eyebrow="Skupiny a šablony" title="Načítám…" subtitle="Chvilka, sbírám tvoje skupiny a šablony." />
    )
  }

  if (error || !payload) {
    return (
      <PageShell eyebrow="Skupiny a šablony" title="Nepodařilo se načíst" subtitle={error || 'Zkus to znovu.'} />
    )
  }

  return (
    <PageShell
      eyebrow="Skupiny a šablony"
      title="Moje skupiny a šablony"
      subtitle="Uložené kontakty a šablony akcí, dostupné z jakéhokoli zařízení přes telefon a kód."
    >
      <main className="grid gap-6">
        <section className="panel">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Nová skupina</p>
          <form className="mt-3 flex flex-wrap gap-3" onSubmit={handleCreateGroup}>
            <input
              className="field flex-1"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="Např. badminton"
              disabled={isCreatingGroup}
            />
            <button type="submit" className="primary-button" disabled={isCreatingGroup}>
              {isCreatingGroup ? 'Ukládám…' : 'Vytvořit'}
            </button>
          </form>
        </section>

        {payload.groups.length === 0 ? (
          <section className="panel">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Zatím žádné skupiny. Založ novou nahoře, nebo si nějakou ulož při zakládání akce.
            </p>
          </section>
        ) : (
          payload.groups.map((group) => {
            const memberForm = memberForms[group.id] || { name: '', phone: '' }

            return (
              <CollapsibleCard
                key={group.id}
                eyebrow="Skupina"
                title={group.name}
                headerActions={
                  <button
                    type="button"
                    className="secondary-button border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                    onClick={() => handleDeleteGroup(group.id, group.name)}
                  >
                    Smazat skupinu
                  </button>
                }
              >
                <ul className="space-y-2">
                  {group.members.map((member) => (
                    <li
                      key={member.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60"
                    >
                      <div>
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{member.name}</span>{' '}
                        <a
                          href={`tel:${member.phone}`}
                          className="text-sm text-fuchsia-700 underline underline-offset-2 dark:text-fuchsia-300"
                        >
                          {member.phone}
                        </a>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-rose-600 hover:underline dark:text-rose-300"
                        disabled={busyMemberId === member.id}
                        onClick={() => handleRemoveMember(group.id, member.id)}
                      >
                        Smazat
                      </button>
                    </li>
                  ))}
                  {group.members.length === 0 ? (
                    <li className="text-sm text-slate-500 dark:text-slate-400">Zatím nikdo.</li>
                  ) : null}
                </ul>

                <form
                  className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
                  onSubmit={(event) => handleAddMember(event, group.id)}
                >
                  <input
                    className="field"
                    value={memberForm.name}
                    onChange={(event) => updateMemberForm(group.id, { name: event.target.value })}
                    placeholder="Jméno"
                  />
                  <input
                    className="field"
                    type="tel"
                    value={memberForm.phone}
                    onChange={(event) => updateMemberForm(group.id, { phone: event.target.value })}
                    placeholder="Telefon"
                  />
                  <button type="submit" className="secondary-button">
                    Přidat
                  </button>
                </form>
              </CollapsibleCard>
            )
          })
        )}

        <section className="panel">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Šablony akcí</p>
          {payload.templates.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">
              Zatím žádné šablony. Uložíš je při zakládání akce.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {payload.templates.map((template) => (
                <li
                  key={template.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{template.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {template.eventName} · {template.location}
                      {template.requirePhone ? ' · telefon povinný' : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-rose-600 hover:underline dark:text-rose-300"
                    onClick={() => handleDeleteTemplate(template.id, template.name)}
                  >
                    Smazat
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </PageShell>
  )
}

export default OwnerDashboardPage
