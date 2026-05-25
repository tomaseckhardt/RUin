import { summaryText } from '../lib/format.js'

const statusConfig = {
  confirmed: {
    label: 'Potvrzeno',
    tone: 'bg-emerald-100 text-emerald-800',
    accent: 'border-emerald-200/80 bg-emerald-50/80',
    icon: '✅',
  },
  excused: {
    label: 'Čeká na posouzení',
    tone: 'bg-orange-100 text-orange-800',
    accent: 'border-orange-200/80 bg-orange-50/80',
    icon: '⏳',
  },
  excused_accepted: {
    label: 'Omluvenka přijatá',
    tone: 'bg-rose-100 text-rose-800',
    accent: 'border-rose-200/80 bg-rose-50/80',
    icon: '❌',
  },
  excused_rejected: {
    label: 'Omluvenka zamítnutá',
    tone: 'bg-slate-200 text-slate-700',
    accent: 'border-slate-200 bg-slate-100/90',
    icon: '⚪',
  },
}

function AttendeeList({ attendees, summary, showModeration = false, onModerate, busyId }) {
  return (
    <section className="panel">
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">Kdo je v tom s tebou</h2>
          <p className="mt-1 text-sm text-slate-500">{summaryText(summary)}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm font-medium text-slate-500">
          <span className="status-chip bg-emerald-100 text-emerald-800">✅ {summary.confirmed} přijde</span>
          <span className="status-chip bg-orange-100 text-orange-800">⏳ {summary.excused} omluvenky</span>
          <span className="status-chip bg-slate-200 text-slate-700">⚪ {summary.rejected} zamítnuté</span>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {attendees.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-10 text-center text-slate-500">
            Zatím nikdo neodpověděl. První jméno čeká právě na tebe.
          </div>
        ) : null}

        {attendees.map((attendee) => {
          const config = statusConfig[attendee.status]
          const rejected = attendee.status === 'excused_rejected'
          const acceptedExcuse = attendee.status === 'excused_accepted'

          return (
            <article
              key={attendee.id}
              className={`rounded-[1.5rem] border p-4 shadow-sm transition ${config.accent}`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`text-lg font-bold ${acceptedExcuse ? 'text-rose-700 line-through' : ''} ${rejected ? 'text-slate-500' : 'text-slate-900'}`}
                    >
                      {config.icon} {attendee.name}
                    </span>
                    <span className={`status-chip ${config.tone}`}>{config.label}</span>
                  </div>
                  {attendee.excuse_reason ? (
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                      „{attendee.excuse_reason}“
                    </p>
                  ) : null}
                </div>

                {showModeration && attendee.status === 'excused' ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="secondary-button border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                      disabled={busyId === attendee.id}
                      onClick={() => onModerate(attendee.id, 'excused_accepted')}
                    >
                      ✅ Schválit
                    </button>
                    <button
                      type="button"
                      className="secondary-button border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
                      disabled={busyId === attendee.id}
                      onClick={() => onModerate(attendee.id, 'excused_rejected')}
                    >
                      ❌ Zamítnout
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default AttendeeList