function InviteListEditor({ invitees, onChange, disabled = false, maxRows = 30 }) {
  function updateRow(index, patch) {
    onChange(invitees.map((invitee, i) => (i === index ? { ...invitee, ...patch } : invitee)))
  }

  function addRow() {
    if (invitees.length >= maxRows) {
      return
    }

    onChange([...invitees, { key: crypto.randomUUID(), name: '', phone: '' }])
  }

  function removeRow(index) {
    onChange(invitees.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-3">
      {invitees.map((invitee, index) => (
        <div key={invitee.key} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">Jméno</label>
            <input
              className="field"
              value={invitee.name}
              onChange={(event) => updateRow(index, { name: event.target.value })}
              placeholder="Např. Jarda"
              disabled={disabled}
            />
          </div>
          <div>
            <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">Telefon</label>
            <input
              className="field"
              type="tel"
              value={invitee.phone}
              onChange={(event) => updateRow(index, { phone: event.target.value })}
              placeholder="Např. 777123456"
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

      {invitees.length < maxRows ? (
        <button type="button" className="secondary-button" onClick={addRow} disabled={disabled}>
          + Přidat pozvaného
        </button>
      ) : null}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Aby appka poznala pozvaného, až si sám odpoví, potřebuje telefon — nezapomeň zapnout „Vyžadovat telefonní číslo“ výše.
      </p>
    </div>
  )
}

export default InviteListEditor
