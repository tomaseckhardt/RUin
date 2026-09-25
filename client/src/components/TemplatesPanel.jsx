import CollapsibleCard from './CollapsibleCard.jsx'
import { useI18n } from '../lib/i18n.js'

function TemplatesPanel({ templates, isLoading, onUseTemplate }) {
  const { t } = useI18n()

  return (
    <CollapsibleCard eyebrow={t('templates.eyebrow')} title={t('templates.title')} defaultOpen={false}>
      {isLoading ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('templates.loading')}</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {t('templates.empty')}
        </p>
      ) : (
        <ul className="space-y-3">
          {templates.map((template) => (
            <li
              key={template.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/60 p-3 dark:border-slate-700 dark:bg-slate-950/30"
            >
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">{template.name}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {template.location}
                  {template.requirePhone ? t('common.phoneRequiredSuffix') : ''}
                </p>
              </div>
              <button type="button" className="secondary-button shrink-0" onClick={() => onUseTemplate(template)}>
                {t('templates.use')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </CollapsibleCard>
  )
}

export default TemplatesPanel
