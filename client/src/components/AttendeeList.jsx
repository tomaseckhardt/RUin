import { summaryText } from '../lib/format.js'

const statusConfig = {
  confirmed: {
    label: 'Potvrzeno',
    tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
    accent: 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/70 dark:bg-emerald-950/20',
    icon: '✅',
  },
  excused: {
    label: 'Čeká na posouzení',
    tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
    accent: 'border-amber-200/80 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/20',
    icon: '⏳',
  },
  excused_accepted: {
    label: 'Omluvenka přijatá',
    tone: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
    accent: 'border-rose-200/80 bg-rose-50/70 dark:border-rose-900/70 dark:bg-rose-950/20',
    icon: '❌',
  },
  excused_rejected: {
    label: 'Omluvenka zamítnutá',
    tone: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    accent: 'border-slate-200 bg-slate-100/90 dark:border-slate-700 dark:bg-slate-900/50',
    icon: '⚪',
  },
}

function AttendeeList({
  attendees,
  summary,
  showModeration = false,
  onModerate,
  busyId,
  showPing = false,
  onPing,
  pingBusyId,
  canPing = true,
  currentName = '',
  showDelete = false,
  onDelete,
  deleteBusyId,
}) {
  const normalizedCurrentName = currentName.trim().toLocaleLowerCase('cs-CZ')

  return (
    <section className="panel">
      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="accent-copy text-sm font-semibold uppercase tracking-[0.2em]">Guest roster</p>
          <h2 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">Kdo je v tom s tebou</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{summaryText(summary)}</p>
        </div>
        <div className="flex flex-wrap gap-2 text-sm font-medium text-slate-500 dark:text-slate-400">
          <span className="status-chip bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">✅ {summary.confirmed} přijde</span>
          <span className="status-chip bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">⏳ {summary.excused} omluvenky</span>
          <span className="status-chip bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">⚪ {summary.rejected} zamítnuté</span>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        {attendees.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 px-4 py-10 text-center text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Zatím nikdo neodpověděl. První jméno čeká právě na tebe.
          </div>
        ) : null}

        {attendees.map((attendee) => {
          const config = statusConfig[attendee.status]
          const rejected = attendee.status === 'excused_rejected'
          const acceptedExcuse = attendee.status === 'excused_accepted'
          const pingCount = attendee.ping_count ?? 0
          const pingLastMessage = attendee.ping_last_message
          const pingable = attendee.status === 'excused' || attendee.status === 'excused_rejected'
          const isSelf = normalizedCurrentName !== '' && attendee.name.trim().toLocaleLowerCase('cs-CZ') === normalizedCurrentName
          const showPingAction = showPing && pingable && !isSelf

          return (
            <article
              key={attendee.id}
              className={`rounded-[1.75rem] border p-4 shadow-sm transition hover:-translate-y-0.5 ${config.accent}`}
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`text-lg font-semibold ${acceptedExcuse ? 'text-rose-700 line-through dark:text-rose-300' : ''} ${rejected ? 'text-slate-500 dark:text-slate-400' : 'text-slate-900 dark:text-slate-50'}`}
                    >
                      {config.icon} {attendee.name}
                    </span>
                    <span className={`status-chip ${config.tone}`}>{config.label}</span>
                  </div>
                  {attendee.excuse_reason ? (
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                      „{attendee.excuse_reason}“
                    </p>
                  ) : null}

                  {pingCount > 0 ? (
                    <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                      Šťouchnutí: {pingCount}
                    </p>
                  ) : null}

                  {pingLastMessage ? (
                    <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
                      Poslední vzkaz: „{pingLastMessage}“
                    </p>
                  ) : null}

                  {rejected && pingCount > 0 ? (
                    <p className="mt-2 text-sm font-medium text-rose-700 dark:text-rose-300">Skupina tě šťouchla.</p>
                  ) : null}
                </div>

                {showModeration && attendee.status === 'excused' ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="secondary-button border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
                      disabled={busyId === attendee.id}
                      onClick={() => onModerate(attendee.id, 'excused_accepted')}
                    >
                      ✅ Schválit
                    </button>
                    <button
                      type="button"
                      className="secondary-button border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      disabled={busyId === attendee.id}
                      onClick={() => onModerate(attendee.id, 'excused_rejected')}
                    >
                      ❌ Zamítnout
                    </button>
                    {showDelete ? (
                      <button
                        type="button"
                        className="secondary-button border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                        disabled={deleteBusyId === attendee.id}
                        onClick={() => onDelete(attendee.id, attendee.name)}
                      >
                        Smazat
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {showModeration && attendee.status !== 'excused' && showDelete ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="secondary-button border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                      disabled={deleteBusyId === attendee.id}
                      onClick={() => onDelete(attendee.id, attendee.name)}
                    >
                      Smazat
                    </button>
                  </div>
                ) : null}

                {showPingAction ? (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      className="secondary-button border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800 hover:bg-fuchsia-100 dark:border-fuchsia-900 dark:bg-fuchsia-950/40 dark:text-fuchsia-200"
                      disabled={!canPing || pingBusyId === attendee.id}
                      onClick={() => onPing(attendee.id)}
                    >
                      {pingBusyId === attendee.id ? 'Šťouchám…' : 'Šťouchnout'}
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