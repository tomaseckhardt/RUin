import { useState } from 'react'
import { toast } from 'sonner'
import ModalOverlay from './ModalOverlay.jsx'
import { accessOwnerAccount } from '../lib/api.js'
import { saveOwnerIdentity } from '../lib/ownerLinkStorage.js'

function OwnerAccessModal({ open, onClose, onAccessGranted }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleClose() {
    if (isSubmitting) {
      return
    }

    onClose()
  }

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const result = await accessOwnerAccount(name, phone, code)
      saveOwnerIdentity(result.ownerId, result.token)
      toast.success('Hotovo — ke skupinám a šablonám se teď dostaneš odkudkoli přes tenhle telefon a kód.')
      setName('')
      setPhone('')
      setCode('')
      onAccessGranted({ ownerId: result.ownerId, token: result.token })
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <ModalOverlay open={open} onClose={handleClose} labelledBy="owner-access-title">
      <div className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
        <div className="mb-5">
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Skupiny a šablony</p>
          <h3 id="owner-access-title" className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
            Jméno, telefon a kód
          </h3>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            Poprvé tady? Zvol si 6místný kód a účet se založí sám. Už ho máš? Zadej stejný telefon a kód a dostaneš se ke svým skupinám a šablonám z jakéhokoli zařízení.
          </p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Jméno</label>
            <input
              className="field"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Např. Tomáš"
              required
              autoFocus
              disabled={isSubmitting}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Telefonní číslo</label>
            <input
              className="field"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="Např. 777123456"
              required
              disabled={isSubmitting}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">6místný kód</label>
            <input
              className="field"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              required
              disabled={isSubmitting}
            />
          </div>

          <div className="flex gap-3">
            <button type="button" className="secondary-button flex-1 justify-center" onClick={handleClose}>
              Zrušit
            </button>
            <button type="submit" className="primary-button flex-1" disabled={isSubmitting}>
              {isSubmitting ? 'Ověřuji…' : 'Pokračovat'}
            </button>
          </div>
        </form>
      </div>
    </ModalOverlay>
  )
}

export default OwnerAccessModal
