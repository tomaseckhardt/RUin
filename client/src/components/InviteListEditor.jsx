import RowListEditor from './RowListEditor.jsx'
import { useI18n } from '../lib/i18n.js'

function InviteListEditor({ invitees, onChange, disabled = false }) {
  const { t } = useI18n()

  return (
    <RowListEditor
      rows={invitees}
      onChange={onChange}
      fields={[
        { name: 'name', label: t('common.name'), placeholder: t('invites.namePlaceholder') },
        { name: 'phone', label: t('common.phone'), type: 'tel', placeholder: t('common.phonePlaceholder') },
      ]}
      newRow={() => ({ key: crypto.randomUUID(), name: '', phone: '' })}
      addLabel={t('invites.addInvitee')}
      hint={t('invites.phoneHint', { option: t('eventForm.requirePhone') })}
      gridClassName="sm:grid-cols-[1fr_1fr_auto]"
      maxRows={30}
      disabled={disabled}
    />
  )
}

export default InviteListEditor
