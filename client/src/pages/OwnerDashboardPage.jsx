import { useCallback, useEffect, useRef, useState } from 'react'
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
import { useI18n } from '../lib/i18n.js'
import { clearSavedOwnerIdentity, getSavedOwner } from '../lib/ownerLinkStorage.js'

// Matched against the database's original text, not the (possibly
// translated) error.message - see toRequestError in lib/api.js.
const REFRESH_ERROR_TOAST_ID = 'owner-refresh-error'

function isInvalidOwnerTokenError(error) {
  return typeof error?.serverMessage === 'string' && error.serverMessage.includes('Neplatný přístupový token')
}

function OwnerDashboardPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [owner, setOwner] = useState(() => getSavedOwner())
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [isCreatingGroup, setIsCreatingGroup] = useState(false)
  const [memberForms, setMemberForms] = useState({})
  const [busyMemberId, setBusyMemberId] = useState(null)
  const [addingMemberGroupId, setAddingMemberGroupId] = useState(null)
  const isLoading = Boolean(owner) && !payload && !error
  const hasLoadedOnceRef = useRef(false)

  const loadPayload = useCallback(async (activeOwner) => {
    try {
      const nextPayload = await getOwnerPayload(activeOwner.ownerId, activeOwner.token)
      setPayload(nextPayload)
      hasLoadedOnceRef.current = true
      setError('')
    } catch (loadError) {
      if (isInvalidOwnerTokenError(loadError)) {
        clearSavedOwnerIdentity()
        setOwner(null)
        setPayload(null)
        hasLoadedOnceRef.current = false
        return
      }

      // Once the page is up, a failed refresh doesn't replace it.
      if (hasLoadedOnceRef.current) {
        toast.error(loadError.message, { id: REFRESH_ERROR_TOAST_ID })
      } else {
        setError(loadError.message)
      }
    }
  }, [])

  useEffect(() => {
    if (owner) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadPayload(owner)
    }
  }, [owner, loadPayload])

  async function handleCreateGroup(event) {
    event.preventDefault()

    if (!newGroupName.trim()) {
      return
    }

    setIsCreatingGroup(true)

    try {
      await createContactGroup(owner.ownerId, owner.token, newGroupName)
      toast.success(t('owner.groupSaved'))
      setNewGroupName('')
      await loadPayload(owner)
    } catch (createError) {
      toast.error(createError.message)
    } finally {
      setIsCreatingGroup(false)
    }
  }

  async function handleDeleteGroup(groupId, groupName) {
    const confirmed = window.confirm(t('owner.confirmDeleteGroup', { name: groupName }))

    if (!confirmed) {
      return
    }

    try {
      await deleteContactGroup(owner.ownerId, owner.token, groupId)
      toast.success(t('owner.groupDeleted'))
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

    const form = memberForms[groupId] || { name: '', phone: '' }

    if (!form.name.trim() || !form.phone.trim()) {
      toast.error(t('owner.fillNameAndPhone'))
      return
    }

    setAddingMemberGroupId(groupId)

    try {
      await addContactGroupMember(owner.ownerId, owner.token, groupId, form)
      toast.success(t('owner.memberAdded'))
      updateMemberForm(groupId, { name: '', phone: '' })
      await loadPayload(owner)
    } catch (addError) {
      toast.error(addError.message)
    } finally {
      setAddingMemberGroupId(null)
    }
  }

  async function handleRemoveMember(groupId, memberId) {
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
    const confirmed = window.confirm(t('owner.confirmDeleteTemplate', { name: templateName }))

    if (!confirmed) {
      return
    }

    try {
      await deleteEventTemplate(owner.ownerId, owner.token, templateId)
      toast.success(t('owner.templateDeleted'))
      await loadPayload(owner)
    } catch (deleteError) {
      toast.error(deleteError.message)
    }
  }

  const backButton = (
    <button type="button" className="secondary-button" onClick={() => navigate(-1)}>
      {t('owner.back')}
    </button>
  )

  if (!owner) {
    return (
      <PageShell eyebrow={t('owner.eyebrow')} title={t('owner.signInTitle')} subtitle={t('owner.signInSubtitle')} actions={backButton}>
        <OwnerAccessModal open onClose={() => navigate('/')} onAccessGranted={setOwner} />
      </PageShell>
    )
  }

  if (isLoading) {
    return <PageShell eyebrow={t('owner.eyebrow')} title={t('common.loading')} subtitle={t('owner.loadingSubtitle')} actions={backButton} />
  }

  if (error || !payload) {
    return <PageShell eyebrow={t('owner.eyebrow')} title={t('owner.loadFailedTitle')} subtitle={error || t('owner.tryAgain')} actions={backButton} />
  }

  return (
    <PageShell eyebrow={t('owner.eyebrow')} title={t('owner.title')} subtitle={t('owner.subtitle')} actions={backButton}>
      <main className="grid gap-6">
        <section className="panel">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">{t('owner.newGroup')}</p>
          <form className="mt-3 flex flex-wrap gap-3" onSubmit={handleCreateGroup}>
            <input
              className="field flex-1"
              aria-label={t('owner.newGroup')}
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder={t('owner.groupNamePlaceholder')}
              disabled={isCreatingGroup}
            />
            <button type="submit" className="primary-button" disabled={isCreatingGroup}>
              {isCreatingGroup ? t('common.saving') : t('owner.create')}
            </button>
          </form>
        </section>

        {payload.groups.length === 0 ? (
          <section className="panel">
            <p className="text-sm text-slate-500 dark:text-slate-400">{t('owner.noGroups')}</p>
          </section>
        ) : (
          payload.groups.map((group) => {
            const memberForm = memberForms[group.id] || { name: '', phone: '' }

            return (
              <CollapsibleCard
                key={group.id}
                eyebrow={t('owner.group')}
                title={group.name}
                headerActions={
                  <button type="button" className="secondary-button danger-button" onClick={() => handleDeleteGroup(group.id, group.name)}>
                    {t('owner.deleteGroup')}
                  </button>
                }>
                <ul className="space-y-2">
                  {group.members.map((member) => (
                    <li
                      key={member.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                      <div>
                        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{member.name}</span>{' '}
                        <a href={`tel:${member.phone}`} className="text-sm text-fuchsia-700 underline underline-offset-2 dark:text-fuchsia-300">
                          {member.phone}
                        </a>
                      </div>
                      <button
                        type="button"
                        className="text-xs text-rose-600 hover:underline dark:text-rose-300"
                        disabled={busyMemberId === member.id}
                        onClick={() => handleRemoveMember(group.id, member.id)}>
                        {t('common.delete')}
                      </button>
                    </li>
                  ))}
                  {group.members.length === 0 ? <li className="text-sm text-slate-500 dark:text-slate-400">{t('owner.nobodyYet')}</li> : null}
                </ul>

                <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={(event) => handleAddMember(event, group.id)}>
                  <input
                    className="field"
                    aria-label={t('common.name')}
                    value={memberForm.name}
                    onChange={(event) => updateMemberForm(group.id, { name: event.target.value })}
                    placeholder={t('common.name')}
                  />
                  <input
                    className="field"
                    type="tel"
                    aria-label={t('common.phone')}
                    value={memberForm.phone}
                    onChange={(event) => updateMemberForm(group.id, { phone: event.target.value })}
                    placeholder={t('common.phone')}
                  />
                  <button type="submit" className="secondary-button" disabled={addingMemberGroupId === group.id}>
                    {t('common.add')}
                  </button>
                </form>
              </CollapsibleCard>
            )
          })
        )}

        <section className="panel">
          <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">{t('owner.templatesTitle')}</p>
          {payload.templates.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">{t('owner.noTemplates')}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {payload.templates.map((template) => (
                <li
                  key={template.id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{template.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {template.eventName} · {template.location}
                      {template.requirePhone ? t('common.phoneRequiredSuffix') : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="text-xs text-rose-600 hover:underline dark:text-rose-300"
                    onClick={() => handleDeleteTemplate(template.id, template.name)}>
                    {t('common.delete')}
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
