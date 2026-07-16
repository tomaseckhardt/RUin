import { useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import PageShell from '../components/PageShell.jsx'
import EventDateTimePicker from '../components/EventDateTimePicker.jsx'
import ConfettiBurst from '../components/ConfettiBurst.jsx'
import { createEventPoll } from '../lib/api.js'

function createEmptyOption() {
  return { key: crypto.randomUUID(), datetime: '', location: '', note: '' }
}

function CreatePollPage() {
  const navigate = useNavigate()
  const [creatorName, setCreatorName] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState(() => [createEmptyOption()])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confettiOrigin, setConfettiOrigin] = useState(null)
  const [burstKey, setBurstKey] = useState(0)

  function updateOption(index, patch) {
    setOptions((current) => current.map((option, i) => (i === index ? { ...option, ...patch } : option)))
  }

  function addOption(event) {
    if (options.length >= 5) {
      return
    }

    const rect = event.currentTarget.getBoundingClientRect()
    setConfettiOrigin({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    setBurstKey((current) => current + 1)

    setOptions((current) => [...current, createEmptyOption()])
  }

  function removeOption(index) {
    setOptions((current) => current.filter((_, i) => i !== index))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const incompleteIndex = options.findIndex((option) => !option.datetime || !option.location.trim())

    if (incompleteIndex !== -1) {
      toast.error(`Možnost ${incompleteIndex + 1} nemá vyplněné datum nebo místo — doplň ji, nebo ji odeber.`)
      return
    }

    if (options.length < 2) {
      toast.error('Přidej aspoň dvě možnosti.')
      return
    }

    setIsSubmitting(true)

    try {
      const result = await createEventPoll({
        creatorName,
        name,
        description,
        options,
      })
      toast.success('Anketa je připravená. Sdílej odkaz na hlasování.')
      navigate(result.creatorPath)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <PageShell
      eyebrow="hlasování před založením akce"
      title="Vytvoř anketu na termín a místo"
      subtitle="Hoď 2–5 možností, ať se parta domluví, než založíš ostrou akci."
    >
      <main className="grid gap-6">
        <form className="panel space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Tvoje jméno</label>
              <input className="field" value={creatorName} onChange={(event) => setCreatorName(event.target.value)} placeholder="Např. Tomáš" required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Název ankety</label>
              <input className="field" value={name} onChange={(event) => setName(event.target.value)} placeholder="Kdy na led hokej?" required />
            </div>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">Popis (nepovinné)</label>
            <textarea className="field min-h-24" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Pár slov k akci…" />
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">Možnosti</p>
            {options.map((option, index) => (
              <div key={option.key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Možnost {index + 1}</p>
                  {options.length > 1 ? (
                    <button type="button" className="text-xs text-rose-600 hover:underline dark:text-rose-300" onClick={() => removeOption(index)}>
                      Odebrat
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">Datum a čas</label>
                    <EventDateTimePicker value={option.datetime} onChange={(value) => updateOption(index, { datetime: value })} />
                  </div>
                  <div>
                    <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">Místo</label>
                    <input className="field" value={option.location} onChange={(event) => updateOption(index, { location: event.target.value })} placeholder="Praha 7" />
                  </div>
                </div>
                <div className="mt-3">
                  <label className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">Poznámka (nepovinné)</label>
                  <input className="field" value={option.note} onChange={(event) => updateOption(index, { note: event.target.value })} placeholder="Levnější vstupné před 18:00" />
                </div>
              </div>
            ))}

            {options.length < 5 ? (
              <button
                type="button"
                onClick={addOption}
                className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-3.5 text-base font-black tracking-[-0.01em] text-white shadow-lg"
                style={{
                  background: 'linear-gradient(135deg, #6f4cff, #a78bfa, #f472b6)',
                  animation: 'party-pulse 1.8s ease-in-out infinite',
                }}
              >
                🎉 Afterparty?! 🎉
              </button>
            ) : null}
          </div>

          <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Vytvářím anketu…' : 'Vytvořit anketu'}
          </button>
        </form>
      </main>

      <ConfettiBurst origin={confettiOrigin} burstKey={burstKey} />
    </PageShell>
  )
}

export default CreatePollPage
