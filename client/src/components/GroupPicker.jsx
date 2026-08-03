function GroupPicker({ groups, onPick, disabled = false }) {
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
          Naplnit ze skupiny „{group.name}“ ({group.members.length})
        </button>
      ))}
    </div>
  )
}

export default GroupPicker
