import { useI18n } from '../lib/i18n.js'

function GroupPicker({ groups, onPick, disabled = false }) {
  const { t } = useI18n()

  if (!groups.length) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {groups.map((group) => (
        <button
          key={group.id}
          type="button"
          className="status-chip bg-fuchsia-100 text-fuchsia-800 transition hover:bg-fuchsia-200 disabled:opacity-60 dark:bg-fuchsia-950/60 dark:text-fuchsia-300"
          onClick={() => onPick(group)}
          disabled={disabled}
        >
          {t('groupPicker.fillFromGroup', { name: group.name, count: group.members.length })}
        </button>
      ))}
    </div>
  )
}

export default GroupPicker
