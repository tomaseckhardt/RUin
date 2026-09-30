import { useId, useState } from 'react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import PageShell from '../components/PageShell.jsx'
import EventDateTimePicker from '../components/EventDateTimePicker.jsx'
import ConfettiBurst from '../components/ConfettiBurst.jsx'
import { createEventPoll } from '../lib/api.js'
import { parseEventDateTime, parseOrganizerToken } from '../lib/format.js'
import { useI18n } from '../lib/i18n.js'
import { savePollCreatorToken } from '../lib/pollCreatorStorage.js'

function createEmptyOption() {
  return { key: crypto.randomUUID(), datetime: '', location: '', note: '' }
}

function CreatePollPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const [creatorName, setCreatorName] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [options, setOptions] = useState(() => [createEmptyOption()])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [confettiOrigin, setConfettiOrigin] = useState(null)
  const [burstKey, setBurstKey] = useState(0)
  const fieldId = useId()

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
      toast.error(t('createPoll.optionIncomplete', { number: incompleteIndex + 1 }))
      return
    }

    if (options.length < 2) {
      toast.error(t('createPoll.minTwoOptions'))
      return
    }

    const pastOptionIndex = options.findIndex((option) => {
      const datetime = parseEventDateTime(option.datetime)
      return !datetime || datetime.getTime() <= Date.now()
    })

    if (pastOptionIndex !== -1) {
      toast.error(t('createPoll.optionMustBeFuture', { number: pastOptionIndex + 1 }))
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
      // The creator's token stays in this browser; the address bar keeps the
      // plain voting link, safe to share.
      savePollCreatorToken(result.pollId, parseOrganizerToken(result.creatorPath))
      toast.success(t('createPoll.created'))
      navigate(result.votePath)
    } catch (error) {
      toast.error(error.message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <PageShell eyebrow={t('createPoll.eyebrow')} title={t('createPoll.title')} subtitle={t('createPoll.subtitle')}>
      <main className="grid gap-6">
        <form className="panel space-y-4" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={`${fieldId}-creator-name`} className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">
                {t('common.yourName')}
              </label>
              <input
                id={`${fieldId}-creator-name`}
                className="field"
                value={creatorName}
                onChange={(event) => setCreatorName(event.target.value)}
                placeholder={t('common.namePlaceholder')}
                required
              />
            </div>
            <div>
              <label htmlFor={`${fieldId}-name`} className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">
                {t('createPoll.name')}
              </label>
              <input
                id={`${fieldId}-name`}
                className="field"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('createPoll.namePlaceholder')}
                required
              />
            </div>
          </div>
          <div>
            <label htmlFor={`${fieldId}-description`} className="mb-2 block text-sm font-medium text-slate-700 dark:text-white">
              {t('createPoll.description')}
            </label>
            <textarea
              id={`${fieldId}-description`}
              className="field min-h-24"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t('createPoll.descriptionPlaceholder')}
            />
          </div>

          <div className="space-y-4">
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t('poll.options')}</p>
            {options.map((option, index) => (
              <div key={option.key} className="rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">{t('createPoll.option', { number: index + 1 })}</p>
                  {options.length > 1 ? (
                    <button type="button" className="text-xs text-rose-600 hover:underline dark:text-rose-300" onClick={() => removeOption(index)}>
                      {t('common.remove')}
                    </button>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* The picker is a button, not a field a <label> can name. */}
                  <div role="group" aria-labelledby={`${fieldId}-${option.key}-datetime`}>
                    <label id={`${fieldId}-${option.key}-datetime`} className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t('eventForm.dateTime')}
                    </label>
                    <EventDateTimePicker value={option.datetime} onChange={(value) => updateOption(index, { datetime: value })} />
                  </div>
                  <div>
                    <label
                      htmlFor={`${fieldId}-${option.key}-location`}
                      className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
                      {t('eventForm.location')}
                    </label>
                    <input
                      id={`${fieldId}-${option.key}-location`}
                      className="field"
                      value={option.location}
                      onChange={(event) => updateOption(index, { location: event.target.value })}
                      placeholder={t('createPoll.locationPlaceholder')}
                    />
                  </div>
                </div>
                <div className="mt-3">
                  <label htmlFor={`${fieldId}-${option.key}-note`} className="mb-2 block text-xs font-medium text-slate-600 dark:text-slate-300">
                    {t('common.noteOptional')}
                  </label>
                  <input
                    id={`${fieldId}-${option.key}-note`}
                    className="field"
                    value={option.note}
                    onChange={(event) => updateOption(index, { note: event.target.value })}
                    placeholder={t('createPoll.notePlaceholder')}
                  />
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
                }}>
                {t('createPoll.addOption')}
              </button>
            ) : null}
          </div>

          <button type="submit" className="primary-button w-full" disabled={isSubmitting}>
            {isSubmitting ? t('createPoll.submitting') : t('createPoll.submit')}
          </button>
        </form>
      </main>

      <ConfettiBurst origin={confettiOrigin} burstKey={burstKey} />
    </PageShell>
  )
}

export default CreatePollPage
