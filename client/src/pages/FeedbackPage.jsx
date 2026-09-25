import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import PageShell from '../components/PageShell.jsx'
import { getFeedbackReports } from '../lib/api.js'
import { getIntlLocale, useI18n } from '../lib/i18n.js'

const FILTERS = ['all', 'bug', 'idea']
const REPORT_TYPES = ['bug', 'idea']

function formatReportedAt(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat(getIntlLocale(), { dateStyle: 'full', timeStyle: 'short' }).format(date)
}

function FeedbackPage() {
  const { t } = useI18n()
  const [reports, setReports] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    getFeedbackReports()
      .then((data) => setReports(data ?? []))
      .catch((error) => toast.error(error.message))
  }, [])

  if (!reports) {
    return (
      <PageShell eyebrow={t('feedback.eyebrow')} title={t('feedback.title')} subtitle={t('feedback.loadingSubtitle')}>
        <p className="panel text-sm text-slate-500 dark:text-slate-400">{t('common.loading')}</p>
      </PageShell>
    )
  }

  const visibleReports = filter === 'all' ? reports : reports.filter((report) => report.type === filter)

  return (
    <PageShell eyebrow={t('feedback.eyebrow')} title={t('feedback.title')} subtitle={t('feedback.count', { count: reports.length })}>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            aria-pressed={filter === key}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              filter === key
                ? 'border-transparent bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            {t(`feedback.filters.${key}`)}
          </button>
        ))}
      </div>

      {visibleReports.length === 0 ? (
        <p className="panel text-sm text-slate-500 dark:text-slate-400">{t('feedback.empty')}</p>
      ) : (
        <div className="space-y-4">
          {visibleReports.map((report) => (
            <article key={report.id} className="panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="status-chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {REPORT_TYPES.includes(report.type) ? t(`feedback.types.${report.type}`) : report.type}
                  </span>
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{report.name}</p>
                </div>
                <time className="text-xs text-slate-500 dark:text-slate-400">{formatReportedAt(report.created_at)}</time>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700 dark:text-slate-200">{report.message}</p>
            </article>
          ))}
        </div>
      )}
    </PageShell>
  )
}

export default FeedbackPage
