import { useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import AddToHomeButton from '../components/AddToHomeButton.jsx'
import PageShell from '../components/PageShell.jsx'
import { createEvent } from '../lib/api.js'

const initialForm = {
  organizerName: '',
  organizerPin: '',
  name: '',
  location: '',
  datetime: '',
  description: '',
}

function CreateEventPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const whyItWorks = [
    'Všichni vidí stejný plán, žádné ztracené zprávy v chatu.',
    'Odpověď je na jedno kliknutí, takže lidi to fakt vyplní.',
    'Organizátor má backstage odkaz a drží věci pod kontrolou.',
  ]

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const payload = await createEvent(form)
      toast.success('Akce je připravená. Odkazy můžeš rovnou sdílet.')
      setForm(initialForm)
      navigate(payload.organizerPath)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  function updateField(field) {
    return (event) => {
      setForm((current) => ({
        ...current,
        [field]: event.target.value,
      }))
    }
  }

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
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white/70 px-4 py-3 text-sm font-medium text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-300">
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
            <div className="grid gap-4 sm:grid-cols-2">
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
                <input
                  type="datetime-local"
                  className="field"
                  value={form.datetime}
                  onChange={updateField('datetime')}
                  required
                />
              </div>
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
    </PageShell>
  )
}

export default CreateEventPage