import { useId } from 'react'
import { useI18n } from '../lib/i18n.js'

// Editable rows of inputs with Remove and Add buttons (invitees, bring-list
// items...). Each field is { name, label, placeholder?, type?, min?, max?,
// parse? }; parse turns the input's text into the stored value.
function RowListEditor({ rows, onChange, fields, newRow, addLabel, hint, gridClassName, maxRows, disabled = false }) {
  const { t } = useI18n()
  const id = useId()

  function updateRow(index, patch) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  return (
    <div className="space-y-3">
      {rows.map((row, index) => (
        <div key={row.key} className={`grid gap-3 sm:items-end ${gridClassName}`}>
          {fields.map((field) => (
            <div key={field.name}>
              <label htmlFor={`${id}-${index}-${field.name}`} className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
                {field.label}
              </label>
              <input
                id={`${id}-${index}-${field.name}`}
                className="field"
                type={field.type ?? 'text'}
                min={field.min}
                max={field.max}
                value={row[field.name]}
                onChange={(event) => updateRow(index, { [field.name]: field.parse ? field.parse(event.target.value) : event.target.value })}
                placeholder={field.placeholder}
                disabled={disabled}
              />
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-rose-600 hover:underline dark:text-rose-300 sm:mb-3"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            disabled={disabled}>
            {t('common.remove')}
          </button>
        </div>
      ))}

      {rows.length < maxRows ? (
        <button type="button" className="secondary-button" onClick={() => onChange([...rows, newRow()])} disabled={disabled}>
          {addLabel}
        </button>
      ) : null}

      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  )
}

export default RowListEditor
