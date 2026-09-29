import { useId } from 'react'
import EventDateTimePicker from './EventDateTimePicker.jsx'
import { useI18n } from '../lib/i18n.js'

const LABEL_CLASS_NAME = 'mb-2 block text-sm font-medium text-slate-700 dark:text-white'
const CHECKBOX_CARD_CLASS_NAME =
  'flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white/60 p-4 transition hover:border-fuchsia-200 dark:border-slate-700 dark:bg-slate-950/30'
// Form field -> key under eventForm (its label; `${key}Hint` is the hint).
const FEATURE_TOGGLES = [
  ['enableBringList', 'bringList'],
  ['enableCarpool', 'carpool'],
  ['enableStops', 'stops'],
]

// The event's own fields, shared by the create form and the organizer's
// edit modal. onChange receives the changed fields only.
function EventFormFields({ form, onChange, autoFocus = false }) {
  const { t } = useI18n()
  const id = useId()
  const setText = (field) => (event) => onChange({ [field]: event.target.value })
  const setChecked = (field) => (event) => onChange({ [field]: event.target.checked })

  return (
    <>
      <div>
        <label htmlFor={`${id}-name`} className={LABEL_CLASS_NAME}>
          {t('eventForm.name')}
        </label>
        <input
          id={`${id}-name`}
          className="field"
          value={form.name}
          onChange={setText('name')}
          placeholder={t('createEvent.namePlaceholder')}
          required
          autoFocus={autoFocus}
        />
      </div>
      <div>
        <label htmlFor={`${id}-location`} className={LABEL_CLASS_NAME}>
          {t('eventForm.location')}
        </label>
        <input
          id={`${id}-location`}
          className="field"
          value={form.location}
          onChange={setText('location')}
          placeholder={t('createEvent.locationPlaceholder')}
          required
        />
      </div>
      <div>
        <label className={LABEL_CLASS_NAME}>{t('eventForm.dateTime')}</label>
        <EventDateTimePicker value={form.datetime} onChange={(datetime) => onChange({ datetime })} />
      </div>
      <div>
        <label htmlFor={`${id}-description`} className={LABEL_CLASS_NAME}>
          {t('eventForm.description')}
        </label>
        <textarea
          id={`${id}-description`}
          className="field min-h-32"
          value={form.description}
          onChange={setText('description')}
          placeholder={t('eventForm.descriptionPlaceholder')}
          required
        />
      </div>
      <label className={CHECKBOX_CARD_CLASS_NAME}>
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600"
          checked={form.requirePhone}
          onChange={setChecked('requirePhone')}
        />
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t('eventForm.requirePhone')}</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('eventForm.requirePhoneHint')}</p>
        </div>
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        {FEATURE_TOGGLES.map(([field, key]) => (
          <label key={field} className={CHECKBOX_CARD_CLASS_NAME}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-fuchsia-600" checked={form[field]} onChange={setChecked(field)} />
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{t(`eventForm.${key}`)}</p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t(`eventForm.${key}Hint`)}</p>
            </div>
          </label>
        ))}
      </div>
    </>
  )
}

export default EventFormFields
