import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import ModalOverlay from './ModalOverlay.jsx'
import { createQrPosterDataUrl, dataUrlToFile } from '../lib/qrPoster.js'
import { formatDateTime, shouldShowPastEventBadge } from '../lib/format.js'
import { useI18n } from '../lib/i18n.js'

function ShareInviteModal({ open, onClose, inviteUrl, eventId, eventName, datetime }) {
  const { locale, t } = useI18n()
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [isGeneratingQr, setIsGeneratingQr] = useState(false)

  // Depends on locale too: the poster's own text is drawn in the active
  // language, so it has to be regenerated after a language switch.
  useEffect(() => {
    if (!open) {
      return
    }

    let cancelled = false

    async function generateQrCode() {
      setIsGeneratingQr(true)

      try {
        const dataUrl = await createQrPosterDataUrl({
          inviteUrl,
          eventName,
          eventDateLabel: datetime ? formatDateTime(datetime) : '',
          isPastEvent: datetime ? shouldShowPastEventBadge(datetime) : false,
        })

        if (!cancelled) {
          setQrDataUrl(dataUrl)
        }
      } catch {
        if (!cancelled) {
          toast.error(t('share.qrFailed'))
        }
      } finally {
        if (!cancelled) {
          setIsGeneratingQr(false)
        }
      }
    }

    generateQrCode()

    return () => {
      cancelled = true
    }
  }, [open, inviteUrl, eventName, datetime, locale, t])

  const isPastEvent = datetime ? shouldShowPastEventBadge(datetime) : false

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast.success(t('share.copied'))
    } catch {
      toast.error(t('share.copyFailed'))
    }
  }

  async function handleShareLink() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: eventName || 'RUin?',
          text: t('share.shareText', { name: eventName || '' }),
          url: inviteUrl,
        })
        return
      } catch (shareError) {
        if (shareError?.name === 'AbortError') {
          return
        }
      }
    }

    await handleCopyLink()
  }

  function handleDownloadQr() {
    if (!qrDataUrl) {
      return
    }

    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = t('share.qrFileName', { id: eventId || 'ruin' })
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  async function handleShareQrPng() {
    if (!qrDataUrl) {
      return
    }

    const file = dataUrlToFile(qrDataUrl, t('share.qrFileName', { id: eventId || 'ruin' }))

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: t('share.qrShareTitle', { name: eventName || '' }),
          text: t('share.qrShareText', { name: eventName || '' }),
          files: [file],
        })
        return
      } catch (shareError) {
        if (shareError?.name === 'AbortError') {
          return
        }
      }
    }

    handleDownloadQr()
    toast.success(t('share.pngDownloaded'))
  }

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy="share-invite-title">
      <div
        className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-lg sm:rounded-[1.75rem] sm:p-8"
        style={{ animation: 'scale-in 0.3s ease both' }}>
        <div className="mb-3 flex items-start justify-between gap-4 sm:mb-5" style={{ animation: 'fade-up 0.3s ease both' }}>
          <div>
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em] sm:text-base">{t('share.invite')}</p>
            <h3 id="share-invite-title" className="mt-1 text-xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50 sm:mt-2 sm:text-3xl">
              {t('share.title')}
            </h3>
          </div>
          <button type="button" className="secondary-button shrink-0 sm:text-base" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        {isPastEvent ? (
          <p className="mb-2 inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:bg-rose-950/40 dark:text-rose-200 sm:text-sm">
            {t('share.eventOver')}
          </p>
        ) : null}

        <div
          className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/40 sm:p-5"
          style={{ animation: 'scale-in 0.35s ease 0.05s both' }}>
          {isGeneratingQr ? (
            <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-300 sm:py-20 sm:text-base">{t('share.generatingQr')}</p>
          ) : (
            <img src={qrDataUrl} alt={t('share.qrAlt')} className="mx-auto w-full max-w-[200px] sm:max-w-[340px]" />
          )}
        </div>

        <p className="mt-2 break-all text-xs text-slate-500 dark:text-slate-400 sm:mt-3 sm:text-sm">{inviteUrl}</p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-4" style={{ animation: 'fade-up 0.3s ease 0.1s both' }}>
          <button type="button" className="secondary-button justify-center sm:py-4 sm:text-base" onClick={handleCopyLink}>
            {t('share.copyLink')}
          </button>
          <button type="button" className="primary-button justify-center sm:py-4 sm:text-base" onClick={handleShareLink}>
            {t('share.shareLink')}
          </button>
          <button type="button" className="secondary-button justify-center sm:py-4 sm:text-base" onClick={handleDownloadQr} disabled={!qrDataUrl}>
            {t('share.downloadQr')}
          </button>
          <button type="button" className="secondary-button justify-center sm:py-4 sm:text-base" onClick={handleShareQrPng} disabled={!qrDataUrl}>
            {t('share.shareQrImage')}
          </button>
        </div>
      </div>
    </ModalOverlay>
  )
}

export default ShareInviteModal
