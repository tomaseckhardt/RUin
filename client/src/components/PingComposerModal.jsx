import { useId, useState } from 'react'
import ModalOverlay from './ModalOverlay.jsx'
import { useI18n } from '../lib/i18n.js'

const PING_MESSAGE_MAX = 280

// Its own component so the message starts empty each time the modal opens:
// ModalOverlay unmounts its children while closed.
function PingComposerForm({ titleId, onClose, onSubmit, isSending }) {
  const { t } = useI18n()
  const messageId = useId()
  const [message, setMessage] = useState('')

  return (
    <div className="modal-card">
      <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('ping.composerEyebrow')}</p>
      <h3 id={titleId} className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
        {t('ping.composerTitle')}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">{t('ping.composerHint')}</p>

      <form
        className="mt-4 space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit(message)
        }}>
        <div>
          <label htmlFor={messageId} className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
            {t('ping.messageLabel')}
          </label>
          <textarea
            id={messageId}
            className="field min-h-24"
            value={message}
            onChange={(event) => setMessage(event.target.value.slice(0, PING_MESSAGE_MAX))}
            placeholder={t('ping.messagePlaceholder')}
            disabled={isSending}
            autoFocus
          />
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {t('common.charactersLeft', { count: PING_MESSAGE_MAX - message.length })}
          </p>
        </div>

        <div className="flex gap-3">
          <button type="button" className="secondary-button flex-1 justify-center" disabled={isSending} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="primary-button flex-1" disabled={isSending}>
            {isSending ? t('ping.sending') : t('common.send')}
          </button>
        </div>
      </form>
    </div>
  )
}

function PingComposerModal({ open, onClose, onSubmit, isSending }) {
  const titleId = useId()

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <PingComposerForm titleId={titleId} onClose={onClose} onSubmit={onSubmit} isSending={isSending} />
    </ModalOverlay>
  )
}

export default PingComposerModal
