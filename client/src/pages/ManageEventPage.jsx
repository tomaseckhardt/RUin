import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import QRCode from 'qrcode'
import { toast } from 'sonner'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AddToCalendarButton from '../components/AddToCalendarButton.jsx'
import AttendeeList from '../components/AttendeeList.jsx'
import EventChat from '../components/EventChat.jsx'
import PageShell from '../components/PageShell.jsx'
import { deleteAttendee, getEvent, moderateAttendee, pingAttendee, removeEvent, unlockManageWithPin } from '../lib/api.js'
import { buildAbsoluteUrl, formatDateTime } from '../lib/format.js'
import { clearSavedOrganizerToken, getSavedOrganizerToken, saveOrganizerToken } from '../lib/organizerLinkStorage.js'
import { supabase } from '../lib/supabase.js'

const AUTO_REFRESH_MS = 10000

async function fetchEventPayload(id) {
  return getEvent(id)
}

function parseOrganizerTokenFromPath(path) {
  if (typeof path !== 'string' || !path) {
    return ''
  }

  try {
    const parsedUrl = new URL(path, window.location.origin)
    return parsedUrl.searchParams.get('token') || ''
  } catch {
    return ''
  }
}

function isInvalidOrganizerTokenError(message) {
  if (typeof message !== 'string') {
    return false
  }

  return message.includes('Neplatný organizátorský odkaz')
}

function parseLocalEventDate(dateString) {
  if (typeof dateString !== 'string') {
    return null
  }

  const match = dateString.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})[T ]([0-9]{2}):([0-9]{2})(?::([0-9]{2}))?$/)

  if (!match) {
    return null
  }

  const [, year, month, day, hour, minute, second = '0'] = match
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  )

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

function shouldShowPastEventBadge(eventDateString) {
  const eventDate = parseLocalEventDate(eventDateString)

  if (!eventDate) {
    return false
  }

  const badgeDate = new Date(eventDate)
  badgeDate.setDate(badgeDate.getDate() + 1)
  badgeDate.setHours(8, 0, 0, 0)

  return Date.now() >= badgeDate.getTime()
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return y
  }

  let line = ''
  let lineCount = 0

  for (let i = 0; i < words.length; i += 1) {
    const testLine = line ? `${line} ${words[i]}` : words[i]
    const testWidth = ctx.measureText(testLine).width

    if (testWidth <= maxWidth || !line) {
      line = testLine
      continue
    }

    ctx.fillText(line, x, y + lineCount * lineHeight)
    lineCount += 1

    if (lineCount >= maxLines - 1) {
      const remaining = words.slice(i).join(' ')
      let tail = remaining

      while (ctx.measureText(`${tail}…`).width > maxWidth && tail.length > 0) {
        tail = tail.slice(0, -1)
      }

      ctx.fillText(`${tail}…`, x, y + lineCount * lineHeight)
      return y + (lineCount + 1) * lineHeight
    }

    line = words[i]
  }

  if (line) {
    ctx.fillText(line, x, y + lineCount * lineHeight)
    lineCount += 1
  }

  return y + lineCount * lineHeight
}

async function createQrPosterDataUrl({ inviteUrl, eventName, eventDateLabel, isPastEvent }) {
  const qrCanvas = document.createElement('canvas')

  await QRCode.toCanvas(qrCanvas, inviteUrl, {
    width: 900,
    margin: 2,
    color: {
      dark: '#201219',
      light: '#FFFFFFFF',
    },
  })

  const width = 1080
  const height = 1440
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')

  if (!ctx) {
    throw new Error('Canvas context unavailable')
  }

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = '#7a1c3f'
  ctx.font = '700 40px "Avenir Next", "Segoe UI", sans-serif'
  ctx.fillText('R U in? · QR pozvánka', 90, 120)

  ctx.fillStyle = '#201219'
  ctx.font = '900 66px "Avenir Next", "Segoe UI", sans-serif'
  const nextY = wrapCanvasText(ctx, eventName || 'Pozvánka', 90, 220, width - 180, 78, 3)

  ctx.fillStyle = '#4f3c49'
  ctx.font = '500 34px "Avenir Next", "Segoe UI", sans-serif'
  ctx.fillText(eventDateLabel || '', 90, nextY + 40)

  if (isPastEvent) {
    ctx.fillStyle = '#fee2e2'
    ctx.fillRect(90, nextY + 80, 290, 64)
    ctx.fillStyle = '#9f1239'
    ctx.font = '700 32px "Avenir Next", "Segoe UI", sans-serif'
    ctx.fillText('Akce proběhla', 112, nextY + 124)
  }

  const qrSize = 760
  const qrX = (width - qrSize) / 2
  const qrY = 520

  ctx.fillStyle = '#f8f4f7'
  ctx.fillRect(qrX - 20, qrY - 20, qrSize + 40, qrSize + 40)
  ctx.drawImage(qrCanvas, qrX, qrY, qrSize, qrSize)

  ctx.fillStyle = '#6f4cff'
  ctx.font = '600 26px "Avenir Next", "Segoe UI", sans-serif'
  ctx.fillText('Naskenuj pro otevření pozvánky', 320, 1320)

  return canvas.toDataURL('image/png')
}

function dataUrlToFile(dataUrl, fileName) {
  const [meta, base64] = dataUrl.split(',')
  const mime = meta.match(/data:(.*);base64/)?.[1] || 'image/png'
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new File([bytes], fileName, { type: mime })
}

function ManageEventPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlToken = searchParams.get('token') || ''
  const [, refreshStoredToken] = useReducer((value) => value + 1, 0)
  const [payload, setPayload] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [pingBusyId, setPingBusyId] = useState(null)
  const [deleteBusyId, setDeleteBusyId] = useState(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showOverviewModal, setShowOverviewModal] = useState(false)
  const [showQrModal, setShowQrModal] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [isGeneratingQr, setIsGeneratingQr] = useState(false)
  const [showPingComposerModal, setShowPingComposerModal] = useState(false)
  const [pingTargetId, setPingTargetId] = useState(null)
  const [pingMessageInput, setPingMessageInput] = useState('')
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [managePin, setManagePin] = useState('')
  const [isUnlockingManage, setIsUnlockingManage] = useState(false)

  const inviteUrl = useMemo(() => buildAbsoluteUrl(`/event/${id}`), [id])
  const activeToken = urlToken || getSavedOrganizerToken(id)

  const loadEvent = useCallback(async () => {
    try {
      const nextPayload = await fetchEventPayload(id)
      setPayload(nextPayload)
      setError('')
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setIsLoading(false)
    }
  }, [id])

  useEffect(() => {
    let cancelled = false

    async function hydrateEvent() {
      if (!activeToken) {
        if (!cancelled) {
          setError('Pro vstup do správy zadej PIN.')
          setShowUnlockModal(true)
          setIsLoading(false)
        }

        return
      }

      try {
        const nextPayload = await fetchEventPayload(id)

        if (cancelled) {
          return
        }

        setPayload(nextPayload)
        setError('')
        setShowUnlockModal(false)

        if (urlToken) {
          saveOrganizerToken(id, urlToken)
          navigate(`/event/${id}/manage`, { replace: true })
        }
      } catch (loadError) {
        if (cancelled) {
          return
        }

        if (isInvalidOrganizerTokenError(loadError.message)) {
          clearSavedOrganizerToken(id)
          refreshStoredToken()
          setShowUnlockModal(true)
          setError('Správa vyžaduje nové odemčení PINem.')
          return
        }

        setError(loadError.message)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    hydrateEvent()

    return () => {
      cancelled = true
    }
  }, [activeToken, id, navigate, urlToken])

  useEffect(() => {
    if (!showQrModal) {
      return
    }

    let cancelled = false

    async function generateQrCode() {
      setIsGeneratingQr(true)

      try {
        const dataUrl = await createQrPosterDataUrl({
          inviteUrl,
          eventName: payload?.event?.name,
          eventDateLabel: payload?.event ? formatDateTime(payload.event.datetime) : '',
          isPastEvent: payload?.event ? shouldShowPastEventBadge(payload.event.datetime) : false,
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
  }, [inviteUrl, payload?.event, showQrModal])

  useEffect(() => {
    if (!activeToken) {
      return undefined
    }

    let cancelled = false
    let inFlight = false

    async function refreshEvent() {
      if (inFlight || document.visibilityState !== 'visible') {
        return
      }

      inFlight = true

      try {
        const nextPayload = await fetchEventPayload(id)

        if (cancelled) {
          return
        }

        setPayload(nextPayload)
        setError('')
      } catch (refreshError) {
        if (!cancelled) {
          setError(refreshError.message)
        }
      } finally {
        inFlight = false
      }
    }

    const intervalId = setInterval(refreshEvent, AUTO_REFRESH_MS)

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [activeToken, id])

  useEffect(() => {
    if (!activeToken) {
      return undefined
    }

    let refreshTimeout = null

    function scheduleRealtimeRefresh() {
      if (refreshTimeout) {
        return
      }

      refreshTimeout = setTimeout(() => {
        refreshTimeout = null
        loadEvent()
      }, 120)
    }

    const channel = supabase
      .channel(`manage-live:${id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'attendee_pings',
          filter: `event_id=eq.${id}`,
        },
        scheduleRealtimeRefresh,
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event_realtime_ticks',
          filter: `event_id=eq.${id}`,
        },
        scheduleRealtimeRefresh,
      )
      .subscribe()

    return () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout)
      }

      supabase.removeChannel(channel)
    }
  }, [activeToken, id, loadEvent])

  async function handleModeration(attendeeId, status) {
    setBusyId(attendeeId)

    try {
      await moderateAttendee(id, attendeeId, { token: activeToken, status })
      toast.success(status === 'excused_accepted' ? 'Omluvenka schválená.' : 'Omluvenka zamítnutá.')
      await loadEvent()
    } catch (actionError) {
      toast.error(actionError.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleDelete() {
    if (!activeToken) {
      setShowUnlockModal(true)
      toast.error('Správa vyžaduje odemčení PINem.')
      return
    }

    const confirmed = window.confirm('Opravdu chceš tuhle akci smazat? Tohle nejde vrátit zpět.')

    if (!confirmed) {
      return
    }

    setIsDeleting(true)

    try {
      await removeEvent(id, activeToken)
      clearSavedOrganizerToken(id)
      toast.success('Akce byla smazaná.')
      navigate('/')
    } catch (actionError) {
      toast.error(actionError.message)
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleDeleteAttendee(attendeeId, attendeeName) {
    if (!activeToken) {
      setShowUnlockModal(true)
      toast.error('Správa vyžaduje odemčení PINem.')
      return
    }

    const confirmed = window.confirm(`Opravdu chceš smazat účastníka ${attendeeName}?`)

    if (!confirmed) {
      return
    }

    setDeleteBusyId(attendeeId)

    try {
      await deleteAttendee(id, attendeeId, activeToken)
      toast.success('Účastník byl smazaný.')
      await loadEvent()
    } catch (deleteError) {
      toast.error(deleteError.message)
    } finally {
      setDeleteBusyId(null)
    }
  }

  function handlePing(attendeeId) {
    setPingTargetId(attendeeId)
    setPingMessageInput('')
    setShowPingComposerModal(true)
  }

  function closePingComposerModal() {
    if (pingBusyId !== null) {
      return
    }

    setShowPingComposerModal(false)
    setPingTargetId(null)
    setPingMessageInput('')
  }

  async function handleSubmitPing(event) {
    event.preventDefault()

    if (pingTargetId === null) {
      return
    }

    setPingBusyId(pingTargetId)

    try {
      await pingAttendee(id, pingTargetId, organizerName, pingMessageInput)
      toast.success('Šťouchnutí odeslané.')
      setShowPingComposerModal(false)
      setPingTargetId(null)
      setPingMessageInput('')
      await loadEvent()
    } catch (pingError) {
      toast.error(pingError.message)
    } finally {
      setPingBusyId(null)
    }
  }

  async function handleShare() {
    await navigator.clipboard.writeText(inviteUrl)
    toast.success('Veřejná pozvánka je ve schránce.')
  }

  async function handleShareQrPng() {
    if (!qrDataUrl) {
      return
    }

    const file = dataUrlToFile(qrDataUrl, `pozvanka-${id}.png`)

    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          title: `Pozvánka: ${event.name}`,
          text: `Pozvánka na akci ${event.name}`,
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

  function handleDownloadQr() {
    if (!qrDataUrl) {
      return
    }

    const link = document.createElement('a')
    link.href = qrDataUrl
    link.download = `pozvanka-${id}.png`
    link.click()
  }

  function closeUnlockModal() {
    if (isUnlockingManage) {
      return
    }

    setShowUnlockModal(false)
    setManagePin('')
  }

  async function handleUnlockManage(event) {
    event.preventDefault()
    setIsUnlockingManage(true)

    try {
      const response = await unlockManageWithPin(id, managePin)
      const nextToken = parseOrganizerTokenFromPath(response.organizerPath)

      if (!nextToken) {
        throw new Error('Nepodařilo se uložit přihlášení organizátora.')
      }

      saveOrganizerToken(id, nextToken)
      refreshStoredToken()
      setShowUnlockModal(false)
      setManagePin('')
      setError('')
      toast.success('Správa odemčená. Přihlášení je uložené pro příště.')
      await loadEvent()
    } catch (unlockError) {
      toast.error(unlockError.message)
    } finally {
      setIsUnlockingManage(false)
    }
  }

  if (isLoading) {
    return (
      <PageShell eyebrow="Organizátor" title="Načítám přehled akce…" subtitle="Chvilka, sbírám všechna RSVP na jedno místo." />
    )
  }

  if (error || !payload) {
    return (
      <PageShell eyebrow="Organizátor" title="Správa akce není dostupná" subtitle={error || 'Akce nebo odkaz už neexistuje.'} />
    )
  }

  const { event, attendees, summary } = payload
  const organizerName = attendees[0]?.name || ''
  const isPastEvent = shouldShowPastEventBadge(event.datetime)

  return (
    <PageShell
      eyebrow="host control room"
      title={event.name}
      subtitle={`${event.location} · ${formatDateTime(event.datetime)}`}
      actions={
        <>
          <AddToCalendarButton eventData={event} />
          <button type="button" className="secondary-button" onClick={() => setShowOverviewModal(true)}>
            Přehled
          </button>
          <button type="button" className="secondary-button" onClick={() => setShowQrModal(true)}>
            QR pozvánka
          </button>
          <button type="button" className="secondary-button" onClick={handleShare}>
            Sdílet pozvánku
          </button>
          <button
            type="button"
            className="secondary-button border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
            onClick={handleDelete}
            disabled={isDeleting}
          >
            {isDeleting ? 'Mažu akci…' : 'Smazat akci'}
          </button>
        </>
      }
    >
      <main className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <article className="panel relative order-4 overflow-hidden xl:order-1">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-[linear-gradient(135deg,rgba(122,28,63,0.14),rgba(111,76,255,0.1))] dark:bg-[linear-gradient(135deg,rgba(122,28,63,0.26),rgba(111,76,255,0.16))]" />
            <div className="relative">
              <p className="accent-copy text-sm uppercase tracking-[0.25em]">Interní poznámka</p>
              <p className="mt-3 text-lg leading-8 text-slate-700 dark:text-slate-300">{event.description}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="surface-subtle">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Kontrola hostů</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Schvaluj omluvenky nebo je nech čekat.</p>
                </div>
                <div className="surface-subtle">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Jasný přehled</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Vidíš, kdo dorazí a kdo to ještě řeší.</p>
                </div>
                <div className="surface-subtle sm:col-span-2 xl:col-span-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500 dark:text-slate-300">Privátní režim</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Odkaz pro organizátora necháš jen pro sebe.</p>
                </div>
              </div>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <div className="stat-tile text-slate-900 dark:text-slate-100">
                  <div className="text-sm font-medium uppercase tracking-[0.18em]">Potvrzeno</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em]">{summary.confirmed}</div>
                </div>
                <div className="stat-tile text-slate-900 dark:text-slate-100">
                  <div className="text-sm font-medium uppercase tracking-[0.18em]">Čeká / omluveno</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em]">{summary.excused}</div>
                </div>
                <div className="stat-tile text-slate-900 dark:text-slate-100">
                  <div className="text-sm font-medium uppercase tracking-[0.18em]">Zamítnuto</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em]">{summary.rejected}</div>
                </div>
              </div>
            </div>
        </article>

        <aside className="order-1 space-y-6 xl:order-2">
          <section className="panel">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
              Controls
            </p>
            <div className="mt-4 space-y-3">
              <button
                type="button"
                className="secondary-button w-full justify-center"
                onClick={() => setShowOverviewModal(true)}
              >
                Přehled
              </button>
              <button type="button" className="secondary-button w-full justify-center" onClick={() => setShowQrModal(true)}>
                QR pozvánka
              </button>
              <button type="button" className="secondary-button w-full justify-center" onClick={handleShare}>
                Sdílet pozvánku
              </button>
              <button
                type="button"
                className="secondary-button w-full justify-center border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
                onClick={handleDelete}
                disabled={isDeleting}
              >
                {isDeleting ? 'Mažu akci…' : 'Smazat akci'}
              </button>
            </div>
          </section>

          <section className="panel">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Soukromý odkaz</p>
            <p className="mt-3 break-all text-sm leading-6 text-slate-700 dark:text-slate-300">
              {buildAbsoluteUrl(`/event/${id}/manage${activeToken ? `?token=${activeToken}` : ''}`)}
            </p>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">
              Tenhle link si nech pro sebe. Právě on dovoluje schvalovat omluvenky a mazat akci.
            </p>
            <div className="mt-5 rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
              Veřejná pozvánka: <Link className="font-medium text-slate-900 underline dark:text-slate-50" to={`/event/${id}`}>otevřít RSVP stránku</Link>
            </div>
          </section>
        </aside>

        <div className="order-2 xl:order-3 xl:col-span-2">
          <AttendeeList
            attendees={attendees}
            summary={summary}
            showModeration
            onModerate={handleModeration}
            busyId={busyId}
            showPing
            onPing={handlePing}
            pingBusyId={pingBusyId}
            canPing={Boolean(organizerName.trim())}
            currentName={organizerName}
            showDelete
            onDelete={handleDeleteAttendee}
            deleteBusyId={deleteBusyId}
            showPhone={Boolean(payload?.event?.requirePhone)}
          />
        </div>

        <div className="order-3 xl:order-4 xl:col-span-2">
          <EventChat
            eventId={id}
            currentName={organizerName}
            canSend={Boolean(organizerName.trim())}
          />
        </div>

        {showQrModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">QR pozvánka</p>
              <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Naskenuj a přidej se</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Sdílej tenhle QR kód ve skupině nebo na místě.</p>
              {isPastEvent ? (
                <p className="mt-2 inline-flex rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
                  Akce proběhla
                </p>
              ) : null}

              <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-950/40">
                {isGeneratingQr ? (
                  <p className="py-20 text-center text-sm text-slate-500 dark:text-slate-300">Generuji QR kód…</p>
                ) : (
                  <img src={qrDataUrl} alt="QR kód pozvánky" className="mx-auto w-full max-w-[320px]" />
                )}
              </div>

              <p className="mt-3 break-all text-xs text-slate-500 dark:text-slate-400">{inviteUrl}</p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button type="button" className="secondary-button justify-center" onClick={() => setShowQrModal(false)}>
                  Zavřít
                </button>
                <button type="button" className="secondary-button justify-center" onClick={handleShareQrPng}>
                  Sdílet PNG
                </button>
                <button type="button" className="primary-button justify-center" onClick={handleDownloadQr} disabled={!qrDataUrl}>
                  Stáhnout PNG
                </button>
                <button type="button" className="secondary-button justify-center" onClick={handleShare}>
                  Zkopírovat link
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {showPingComposerModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Šťouchnout účastníka</p>
              <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Přidej zprávu</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Nepovinné. Když nic nenapíšeš, odešle se jen šťouchnutí.</p>

              <form className="mt-4 space-y-4" onSubmit={handleSubmitPing}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Zpráva</label>
                  <textarea
                    className="field min-h-24"
                    value={pingMessageInput}
                    onChange={(event) => setPingMessageInput(event.target.value.slice(0, 280))}
                    placeholder="Hej, pojď s náma!"
                    disabled={pingBusyId !== null}
                    autoFocus
                  />
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Zbývá {280 - pingMessageInput.length} znaků</p>
                </div>

                <div className="flex gap-3">
                  <button type="button" className="secondary-button flex-1 justify-center" onClick={closePingComposerModal}>
                    Zrušit
                  </button>
                  <button type="submit" className="primary-button flex-1" disabled={pingBusyId !== null}>
                    {pingBusyId !== null ? 'Šťouchám…' : 'Odeslat'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {showUnlockModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-md sm:rounded-[1.75rem] sm:p-6">
              <div className="mb-5">
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Správa akce</p>
                <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">Zadej PIN</h3>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">PIN zadáš jednou. Přihlášení se uloží na tomto zařízení.</p>
              </div>

              <form className="space-y-4" onSubmit={handleUnlockManage}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">Správcovský PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    pattern="[0-9]{4}"
                    maxLength={4}
                    className="field"
                    value={managePin}
                    onChange={(event) => setManagePin(event.target.value)}
                    placeholder="1234"
                    required
                    autoFocus
                  />
                </div>

                <div className="flex gap-3">
                  <button type="button" className="secondary-button flex-1 justify-center" onClick={closeUnlockModal}>
                    Zrušit
                  </button>
                  <button type="submit" className="primary-button flex-1" disabled={isUnlockingManage}>
                    {isUnlockingManage ? 'Ověřuji…' : 'Vstoupit'}
                  </button>
                </div>
              </form>
            </div>
          </section>
        ) : null}

        {showOverviewModal ? (
          <section className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div className="h-[100dvh] w-full max-w-none rounded-none border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:h-auto sm:max-w-lg sm:rounded-[1.75rem] sm:p-6">
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">Přehled</p>
                  <h3 className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">{event.name}</h3>
                </div>
                <button
                  type="button"
                  className="secondary-button shrink-0"
                  onClick={() => setShowOverviewModal(false)}
                >
                  Zavřít
                </button>
              </div>

              <div className="max-h-[60vh] space-y-5 overflow-y-auto">
                {['confirmed', 'excused', 'excused_accepted', 'excused_rejected'].map((statusGroup) => {
                  const group = attendees.filter((a) => a.status === statusGroup)
                  if (group.length === 0) return null
                  const labels = {
                    confirmed: '✅ Přijdou',
                    excused: '⏳ Omluvenky (čeká)',
                    excused_accepted: '❌ Omluvenka přijatá',
                    excused_rejected: '⚪ Omluvenka zamítnutá',
                  }

                  return (
                    <div key={statusGroup}>
                      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                        {labels[statusGroup]} ({group.length})
                      </p>
                      <ul className="space-y-2">
                        {group.map((a) => (
                          <li
                            key={a.id}
                            className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{a.name}</span>
                              {event.requirePhone && a.phone ? (
                                <a
                                  href={`tel:${a.phone}`}
                                  className="text-sm font-medium text-fuchsia-700 underline underline-offset-2 dark:text-fuchsia-300"
                                >
                                  {a.phone}
                                </a>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>
        ) : null}
      </main>
    </PageShell>
  )
}

export default ManageEventPage