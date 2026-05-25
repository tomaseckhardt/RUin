import { useState } from 'react'
import { toast } from 'sonner'
import PageShell from '../components/PageShell.jsx'
import { createEvent } from '../lib/api.js'
import { buildAbsoluteUrl } from '../lib/format.js'

const initialForm = {
  name: '',
  location: '',
  datetime: '',
  description: '',
}

function LinkCard({ label, href, tone }) {
  return (
    <div className={`rounded-[1.75rem] border p-5 ${tone}`}>
      <p className="text-sm font-medium uppercase tracking-[0.2em]">{label}</p>
      <a
        href={href}
        className="mt-3 block break-all text-lg font-medium underline decoration-1 underline-offset-4"
      >
        {href}
      </a>
    </div>
  )
}

function CreateEventPage() {
  const [form, setForm] = useState(initialForm)
  const [createdLinks, setCreatedLinks] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setIsSubmitting(true)

    try {
      const payload = await createEvent(form)
      setCreatedLinks(payload)
      toast.success('Akce je připravená. Odkazy můžeš rovnou sdílet.')
      setForm(initialForm)
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
      eyebrow="Pozvánky bez dramatu"
      title="R U in?"
      subtitle="Založ akci, pošli odkaz a nech kamarády, ať konečně přestanou odpovídat jenom emojičkem."
    >
      <main className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <section className="panel">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
                Organizátor
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950 dark:text-slate-50">
                Vytvoř novou akci
              </h2>
            </div>
            <div className="rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-sm font-medium text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              bez registrace
            </div>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
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
              <button type="submit" className="primary-button" disabled={isSubmitting}>
                {isSubmitting ? 'Zakládám akci…' : 'Vytvořit akci'}
              </button>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Po vytvoření dostaneš veřejný odkaz i soukromý organizátorský link.
              </p>
            </div>
          </form>
        </section>

        <aside className="space-y-6">
          <section className="panel">
            <p className="accent-copy text-sm font-medium uppercase tracking-[0.25em]">
              Jak to funguje
            </p>
            <ol className="mt-4 space-y-4 text-sm leading-6 text-slate-600 dark:text-stone-50">
              <li>1. Vytvoříš akci a zkopíruješ veřejný odkaz do skupiny.</li>
              <li>2. Každý odpoví jménem a buď přijde, nebo pošle omluvenku.</li>
              <li>3. Ty v soukromém organizátorském odkazu rozhodneš, co bereš.</li>
            </ol>
          </section>

          {createdLinks ? (
            <section className="panel">
              <h2 className="text-2xl font-bold text-slate-950">Odkazy jsou připravené</h2>
              <div className="mt-4 space-y-4">
                <LinkCard
                  label="Veřejná pozvánka"
                  href={buildAbsoluteUrl(createdLinks.guestPath)}
                  tone="border-slate-200 bg-white/50 text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100"
                />
                <LinkCard
                  label="Organizátorský odkaz"
                  href={buildAbsoluteUrl(createdLinks.organizerPath)}
                  tone="border-slate-200 bg-white/50 text-slate-900 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-100"
                />
              </div>
            </section>
          ) : null}
        </aside>
      </main>
    </PageShell>
  )
}

export default CreateEventPage