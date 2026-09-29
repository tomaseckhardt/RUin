import { useId, useState } from 'react'
import ModalOverlay from './ModalOverlay.jsx'
import { useI18n } from '../lib/i18n.js'

// The organizer's 4-digit PIN. With onCancel the submit button sits beside
// Cancel (in a modal); without it, it spans the form. children go below.
function PinUnlockForm({ onSubmit, isUnlocking, onCancel, children }) {
  const { t } = useI18n()
  const id = useId()
  const [pin, setPin] = useState('')

  const submitButton = (
    <button type="submit" className={`primary-button ${onCancel ? 'flex-1' : 'w-full'}`} disabled={isUnlocking}>
      {isUnlocking ? t('common.verifying') : t('pin.enter')}
    </button>
  )

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit(pin)
      }}>
      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
          {t('pin.label')}
        </label>
        <input
          id={id}
          type="password"
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          className="field"
          value={pin}
          onChange={(event) => setPin(event.target.value)}
          placeholder="1234"
          required
          autoFocus
        />
      </div>

      {onCancel ? (
        <div className="flex gap-3">
          <button type="button" className="secondary-button flex-1 justify-center" disabled={isUnlocking} onClick={onCancel}>
            {t('common.cancel')}
          </button>
          {submitButton}
        </div>
      ) : (
        submitButton
      )}

      {children}
    </form>
  )
}

export function PinUnlockModal({ open, onClose, hint, onSubmit, isUnlocking }) {
  const { t } = useI18n()
  const titleId = useId()

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <div className="modal-card">
        <div className="mb-5">
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('pin.eyebrow')}</p>
          <h3 id={titleId} className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
            {t('pin.title')}
          </h3>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{hint}</p>
        </div>

        <PinUnlockForm onSubmit={onSubmit} isUnlocking={isUnlocking} onCancel={onClose} />
      </div>
    </ModalOverlay>
  )
}

export default PinUnlockForm
