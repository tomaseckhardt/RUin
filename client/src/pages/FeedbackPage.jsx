import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import PageShell from '../components/PageShell.jsx'
import { getFeedbackReports } from '../lib/api.js'

const TYPE_LABEL = {
  bug: '🐛 Chyba',
  idea: '💡 Nápad',
}

const FILTERS = [
  { key: 'all', label: 'Vše' },
  { key: 'bug', label: '🐛 Chyby' },
  { key: 'idea', label: '💡 Nápady' },
]

function formatReportedAt(value) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'full', timeStyle: 'short' }).format(date)
}

function FeedbackPage() {
  const [reports, setReports] = useState(null)
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    getFeedbackReports()
      .then((data) => setReports(data ?? []))
      .catch((error) => toast.error(error.message))
  }, [])

  if (!reports) {
    return (
      <PageShell eyebrow="interní" title="Chyby a nápady" subtitle="Načítám hlášení…">
        <p className="panel text-sm text-slate-500 dark:text-slate-400">Načítám…</p>
      </PageShell>
    )
  }

  const visibleReports = filter === 'all' ? reports : reports.filter((report) => report.type === filter)

  return (
    <PageShell eyebrow="interní" title="Chyby a nápady" subtitle={`${reports.length} ${reports.length === 1 ? 'hlášení' : 'hlášení celkem'}`}>
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setFilter(item.key)}
            aria-pressed={filter === item.key}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              filter === item.key
                ? 'border-transparent bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {visibleReports.length === 0 ? (
        <p className="panel text-sm text-slate-500 dark:text-slate-400">Zatím nic v téhle kategorii.</p>
      ) : (
        <div className="space-y-4">
          {visibleReports.map((report) => (
            <article key={report.id} className="panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="status-chip bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {TYPE_LABEL[report.type] ?? report.type}
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
