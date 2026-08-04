const CATEGORY_CONFIG = {
  bring: {
    itemLabel: 'Věc',
    itemPlaceholder: 'Např. Pivo',
    personLabel: 'Kdo (nepovinné)',
    personPlaceholder: 'Např. Petr',
    quantityLabel: 'Kolik',
    addLabel: '+ Přidat věc',
    hint: 'Když u věci nenapíšeš jméno, zůstane volná a kdokoli se na ni může přihlásit později.',
  },
  ride: {
    itemLabel: 'Popis odvozu',
    itemPlaceholder: 'Např. Auto z Prahy 6, odjezd 17:30',
    personLabel: 'Kdo řídí (nepovinné)',
    personPlaceholder: 'Např. Petr',
    quantityLabel: 'Volná místa',
    addLabel: '+ Přidat odvoz',
    hint: 'Když nenapíšeš řidiče, nabídka zůstane bez jména - doplníte ho později.',
  },
}

function SignupItemEditor({ category, items, onChange, disabled = false, maxRows = 20 }) {
  const config = CATEGORY_CONFIG[category]

  function updateRow(index, patch) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  function addRow() {
    if (items.length >= maxRows) {
      return
    }

    onChange([...items, { key: crypto.randomUUID(), label: '', personName: '', quantity: 1 }])
  }

  function removeRow(index) {
    onChange(items.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={item.key} className="grid gap-3 sm:grid-cols-[1fr_1fr_5rem_auto] sm:items-end">
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">{config.itemLabel}</label>
            <input
              className="field"
              value={item.label}
              onChange={(event) => updateRow(index, { label: event.target.value })}
              placeholder={config.itemPlaceholder}
              disabled={disabled}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">{config.personLabel}</label>
            <input
              className="field"
              value={item.personName}
              onChange={(event) => updateRow(index, { personName: event.target.value })}
              placeholder={config.personPlaceholder}
              disabled={disabled}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">{config.quantityLabel}</label>
            <input
              type="number"
              min={1}
              max={20}
              className="field"
              value={item.quantity}
              onChange={(event) => updateRow(index, { quantity: Number(event.target.value) || 1 })}
              disabled={disabled}
            />
          </div>
          <button
            type="button"
            className="text-xs text-rose-600 hover:underline dark:text-rose-300 sm:mb-3"
            onClick={() => removeRow(index)}
            disabled={disabled}
          >
            Odebrat
          </button>
        </div>
      ))}

      {items.length < maxRows ? (
        <button type="button" className="secondary-button" onClick={addRow} disabled={disabled}>
          {config.addLabel}
        </button>
      ) : null}

      <p className="text-xs text-slate-500 dark:text-slate-400">{config.hint}</p>
    </div>
  )
}

export default SignupItemEditor
