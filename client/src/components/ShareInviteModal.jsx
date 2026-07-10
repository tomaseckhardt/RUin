import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { createQrPosterDataUrl, dataUrlToFile } from '../lib/qrPoster.js'
import { formatDateTime, shouldShowPastEventBadge } from '../lib/format.js'

function ShareInviteModal({ open, onClose, inviteUrl, eventId, eventName, datetime }) {
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [isGeneratingQr, setIsGeneratingQr] = useState(false)

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
          toast.error('QR kód se nepodařilo vygenerovat.')
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
  }, [open, inviteUrl, eventName, datetime])

  if (!open) {
    return null
  }

  const isPastEvent = datetime ? shouldShowPastEventBadge(datetime) : false

  async function handleCopyLink() {
    await navigator.clipboard.writeText(inviteUrl)
    toast.success('Pozvánka zkopírovaná do schránky.')
  }

  async function handleShareLink() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: eventName || 'RUin?',
          text: `Jsi na akci? ${eventName || ''}`,
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
    link.download = `pozvanka-${eventId || 'ruin'}.png`
    link.click()
  }

  async function handleShareQrPng() {
    if (!qrDataUrl) {
      return
    }

    const file = dataUrlToFile(qrDataUrl, `pozvanka-${eventId || 'ruin'}.png`)

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: `Pozvánka: ${eventName || ''}`,
          text: `Pozvánka na akci ${eventName || ''}`,
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
    toast.success('PNG bylo staženo. Sdílej ho z galerie/souborů.')
  }

  return (
    <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div
        className="max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:max-h-[90dvh] sm:max-w-md sm:rounded-[1.75rem] sm:p-6"
        style={{ animation: 'scale-in 0.3s ease both' }}
      >
        <div className="mb-3 flex items-start justify-between gap-4" style={{ animation: 'fade-up 0.3s ease both' }}>
          <div>
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Pozvánka</p>
            <h3 className="mt-1 text-xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50 sm:mt-2 sm:text-2xl">Sdílej nebo naskenuj</h3>
          </div>
          <button type="button" className="secondary-button shrink-0" onClick={onClose}>
            Zavřít
          </button>
        </div>

        {isPastEvent ? (
          <p className="mb-2 inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
            Akce proběhla
          </p>
        ) : null}

        <div
          className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/40 sm:p-4"
          style={{ animation: 'scale-in 0.35s ease 0.05s both' }}
        >
          {isGeneratingQr ? (
            <p className="py-16 text-center text-sm text-slate-500 dark:text-slate-300 sm:py-20">Generuji QR kód…</p>
          ) : (
            <img src={qrDataUrl} alt="QR kód pozvánky" className="mx-auto w-full max-w-[200px] sm:max-w-[280px]" />
          )}
        </div>

        <p className="mt-2 break-all text-xs text-slate-500 dark:text-slate-400">{inviteUrl}</p>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:mt-4 sm:gap-3" style={{ animation: 'fade-up 0.3s ease 0.1s both' }}>
          <button type="button" className="secondary-button justify-center" onClick={handleCopyLink}>
            Zkopírovat link
          </button>
          <button type="button" className="primary-button justify-center" onClick={handleShareLink}>
            Sdílet link
          </button>
          <button type="button" className="secondary-button justify-center" onClick={handleDownloadQr} disabled={!qrDataUrl}>
            Stáhnout QR
          </button>
          <button type="button" className="secondary-button justify-center" onClick={handleShareQrPng} disabled={!qrDataUrl}>
            Sdílet QR obrázek
          </button>
        </div>
      </div>
    </section>
  )
}

export default ShareInviteModal
