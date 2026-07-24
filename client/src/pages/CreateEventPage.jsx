import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Link, useNavigate } from 'react-router-dom'
import AddToHomeButton from '../components/AddToHomeButton.jsx'
import ConfettiBurst from '../components/ConfettiBurst.jsx'
import EventDateTimePicker from '../components/EventDateTimePicker.jsx'
import PageShell from '../components/PageShell.jsx'
import { addEventStop, createEvent, getEvent } from '../lib/api.js'
import { formatDateTime, parseLocalDateTime } from '../lib/format.js'
import { clearSavedOrganizerToken, getSavedOrganizerEventIds } from '../lib/organizerLinkStorage.js'

function parseTokenFromPath(path) {
  try {
    return new URL(path, window.location.origin).searchParams.get('token') || ''
  } catch {
    return ''
  }
}

const initialForm = {
  organizerName: '',
  organizerPin: '',
  name: '',
  location: '',
  datetime: '',
  description: '',
  requirePhone: false,
}

function CreateEventPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [recentEvents, setRecentEvents] = useState([])
  const [isLoadingRecentEvents, setIsLoadingRecentEvents] = useState(true)
  const [showAfterparty, setShowAfterparty] = useState(false)
  const [afterpartyLocation, setAfterpartyLocation] = useState('')
  const [afterpartyTime, setAfterpartyTime] = useState('')
  const [confettiOrigin, setConfettiOrigin] = useState(null)
  const [burstKey, setBurstKey] = useState(0)

  const whyItWorks = [
    'Všichni vidí stejný plán, žádné ztracené zprávy v chatu.',
    'Odpověď je na jedno kliknutí, takže lidi to fakt vyplní.',
    'Organizátor má backstage odkaz a drží věci pod kontrolou.',
  ]

  async function handleSubmit(event) {
    event.preventDefault()

    if (!form.datetime) {
      toast.error('Vyber datum a čas akce.')
      return
    }

    const parsedDatetime = parseLocalDateTime(form.datetime)

    if (!parsedDatetime || parsedDatetime.getTime() <= Date.now()) {
      toast.error('Datum a čas akce musí být v budoucnosti.')
      return
    }

    setIsSubmitting(true)

    try {
      const payload = await createEvent(form)

      if (showAfterparty && afterpartyLocation.trim() && afterpartyTime) {
        const token = parseTokenFromPath(payload.organizerPath)

        if (token) {
          try {
            await addEventStop(payload.event.id, token, {
              name: 'Afterparty',
              location: afterpartyLocation,
              startsAtLabel: afterpartyTime,
            })
          } catch (afterpartyError) {
            toast.error(`Akce je založená, ale afterparty se nepodařilo uložit: ${afterpartyError.message}`)
          }
        }
      }

      toast.success('Akce je připravená. Odkazy můžeš rovnou sdílet.')
      setForm(initialForm)
      setShowAfterparty(false)
      setAfterpartyLocation('')
      setAfterpartyTime('')
      navigate(payload.organizerPath)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function handleAfterpartyClick(event) {
    if (!showAfterparty) {
      const rect = event.currentTarget.getBoundingClientRect()
      setConfettiOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
      setBurstKey((current) => current + 1)
    }

    setShowAfterparty((current) => !current)
  }

  function updateField(field) {
    return (event) => {
      setForm((current) => ({
        ...current,
        [field]: event.target.value,
      }))
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadRecentEvents() {
      setIsLoadingRecentEvents(true)

      try {
        const ids = getSavedOrganizerEventIds().slice(-6).reverse()

        if (ids.length === 0) {
          if (!cancelled) {
            setRecentEvents([])
          }

          return
        }

        const results = await Promise.allSettled(ids.map((eventId) => getEvent(eventId)))
        const nextEvents = []

        results.forEach((result, index) => {
          const eventId = ids[index]

          if (result.status === 'fulfilled' && result.value?.event) {
            nextEvents.push({
              id: eventId,
              event: result.value.event,
            })
            return
          }

          clearSavedOrganizerToken(eventId)
        })

        if (!cancelled) {
          setRecentEvents(nextEvents)
        }
      } finally {
        if (!cancelled) {
          setIsLoadingRecentEvents(false)
        }
      }
    }

    loadRecentEvents()

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <PageShell
      eyebrow="group plans, less chaos"
      title="R U in?"
      subtitle="Pozvánka, co vypadá fresh, funguje rychle a nenechá skupinový chat spadnout do tří dnů ticha a šesti výmluv."
      actions={<AddToHomeButton />}
    >
      <main className="grid gap-6 xl:grid-cols-[minmax(0,1.18fr)_minmax(360px,0.82fr)]">
        <section className="space-y-6">
          <article className="panel relative overflow-hidden">
            <div className="pointer-events-none absolute -right-20 -top-16 h-56 w-56 rounded-full bg-[radial-gradient(circle,rgba(111,76,255,0.18),transparent_68%)] blur-2xl dark:bg-[radial-gradient(circle,rgba(111,76,255,0.24),transparent_68%)]" />
            <div className="pointer-events-none absolute -left-16 bottom-0 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(122,28,63,0.18),transparent_66%)] blur-2xl dark:bg-[radial-gradient(circle,rgba(122,28,63,0.28),transparent_66%)]" />
            <div className="relative grid gap-8 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] xl:items-end">
              <div>
                <p className="accent-copy text-sm font-semibold uppercase tracking-[0.28em]">Organizátor</p>
                <h2 className="mt-4 max-w-2xl text-4xl font-black tracking-[-0.06em] text-slate-950 dark:text-slate-50 sm:text-5xl lg:text-6xl">
                  Vytvoř událost, kterou lidi fakt chtějí otevřít
                </h2>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600 dark:text-slate-300">
                  Jedna krásná stránka místo nekonečného přepisování do chatu. Nahoď název, místo a čas, pošli odkaz a hned vidíš, kdo dorazí.
                </p>
                <div className="mt-8 flex flex-wrap gap-3">
                  <a href="#create-form" className="primary-button">
                    Začít tvořit
                  </a>
                  <Link to="/poll/new" className="secondary-button">
                    Nejdřív hlasování o termínu
                  </Link>
                  <span className="hero-badge inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-4 py-3 text-sm font-medium text-slate-600 shadow-sm">
                    Bez přihlašování, bez zdržování
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-1">
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">Rychlost</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">30 s</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Připraveno k odeslání během chvilky.</p>
                </div>
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">Flow</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">1 link</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Veřejně pro hosty, privátně pro organizátora.</p>
                </div>
                <div className="stat-tile">
                  <div className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-300">Stav</div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.04em] text-slate-950 dark:text-slate-50">Live</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Všechno vidíš přehledně na jednom místě.</p>
                </div>
              </div>
            </div>
          </article>

          <section className="grid gap-4 md:grid-cols-3">
            {whyItWorks.map((item, index) => (
              <article key={item} className="surface-subtle">
                <p className="accent-copy text-xs font-semibold uppercase tracking-[0.24em]">0{index + 1}</p>
                <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">{item}</p>
              </article>
            ))}
          </section>

          <section className="grid gap-4 md:grid-cols-3">
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">01</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">Dropni link</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Veřejná pozvánka jde rovnou do skupiny a všichni mají stejný přehled.</p>
            </article>
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">02</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">Sbírej vibe check</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Lidi kliknou, jestli dorazí nebo pošlou omluvenku i s důvodem.</p>
            </article>
            <article className="panel">
              <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">03</p>
              <h3 className="mt-3 text-xl font-bold text-slate-950 dark:text-slate-50">Rozhodni backstage</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">Z privátního linku vidíš seznam a držíš nad akcí moderátorský přehled.</p>
            </article>
          </section>

        </section>

        <aside id="create-form" className="panel h-fit xl:sticky xl:top-6">
          <div className="mb-6">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Moje poslední akce</p>
            {isLoadingRecentEvents ? (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Načítám poslední akce…</p>
            ) : null}

            {!isLoadingRecentEvents && recentEvents.length === 0 ? (
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Zatím tu nic není. Jakmile založíš akci, objeví se tady rychlý vstup do správy.</p>
            ) : null}

            {!isLoadingRecentEvents && recentEvents.length > 0 ? (
              <div className="mt-3 space-y-3">
                {recentEvents.map(({ id: eventId, event }) => (
                  <article key={eventId} className="rounded-2xl border border-slate-200 bg-white/65 p-3 dark:border-slate-700 dark:bg-slate-950/35">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{event.name}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDateTime(event.datetime)} · {event.location}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Link to={`/event/${eventId}/manage`} className="secondary-button px-3 py-1.5 text-xs">
                        Otevřít správu
                      </Link>
                      <Link to={`/event/${eventId}`} className="secondary-button px-3 py-1.5 text-xs">
                        Otevřít pozvánku
                      </Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>

          <div className="mb-6">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">Composer</p>
            <h2 className="mt-2 text-3xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">
              Poskládej akci
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
              Vyplň jen to důležité. Po uložení dostaneš odkaz, který můžeš rovnou poslat do skupiny.
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Tvoje jméno (organizátor)</label>
                <input
                  className="field"
                  value={form.organizerName}
                  onChange={updateField('organizerName')}
                  placeholder="Např. Tomáš"
                  required
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Správcovský PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  className="field"
                  value={form.organizerPin}
                  onChange={updateField('organizerPin')}
                  placeholder="Např. 1234"
                  required
                />
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">4 číslice. Bude potřeba pro vstup do správy akce.</p>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Název akce</label>
              <input
                className="field"
                value={form.name}
                onChange={updateField('name')}
                placeholder="Např. Grilovačka na střeše"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Místo</label>
              <input
                className="field"
                value={form.location}
                onChange={updateField('location')}
                placeholder="Praha 7, dvorek za kavárnou"
                required
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Datum a čas</label>
              <EventDateTimePicker
                value={form.datetime}
                onChange={(nextValue) => setForm((current) => ({ ...current, datetime: nextValue }))}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Popis</label>
              <textarea
                className="field min-h-32"
                value={form.description}
                onChange={updateField('description')}
                placeholder="Co se děje, co vzít s sebou a jestli hrozí dress code."
                required
              />
            </div>
            <div>
              <button
                type="button"
                onClick={handleAfterpartyClick}
                className="inline-flex w-full items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-black tracking-[-0.01em] text-white shadow-lg"
                style={{
                  background: 'linear-gradient(135deg, #6f4cff, #a78bfa, #f472b6)',
                  animation: showAfterparty ? 'none' : 'party-pulse 1.8s ease-in-out infinite',
                }}
              >
                🎉 {showAfterparty ? 'Zavřít afterparty' : 'Afterparty?!'} 🎉
              </button>

              {showAfterparty ? (
                <div className="mt-3 grid gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Kam se jde potom</label>
                    <input
                      className="field"
                      value={afterpartyLocation}
                      onChange={(event) => setAfterpartyLocation(event.target.value)}
                      placeholder="Klub Afterparty, Praha 7"
                    />
                  </div>
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Čas</label>
                    <input
                      type="time"
                      className="field"
                      value={afterpartyTime}
                      onChange={(event) => setAfterpartyTime(event.target.value)}
                    />
                  </div>
                </div>
              ) : null}
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
                checked={form.requirePhone}
                onChange={(e) => setForm((current) => ({ ...current, requirePhone: e.target.checked }))}
              />
              <div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">Vyžadovat telefonní číslo</p>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Učastníci budou muset vyplnit telefon. Z organizátorské stránky pak můžeš na každého přímo zavolat.</p>
              </div>
            </label>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Zakládám akci…' : 'Vytvořit akci'}
              </button>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Po vytvoření dostaneš veřejný odkaz i soukromý organizátorský link.
              </p>
            </div>
          </form>
        </aside>
      </main>

      <ConfettiBurst origin={confettiOrigin} burstKey={burstKey} />
    </PageShell>
  )
}

export default CreateEventPage