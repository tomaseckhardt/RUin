import { useId } from 'react'
import ModalOverlay from './ModalOverlay.jsx'
import { useI18n } from '../lib/i18n.js'

// The organizer also sees who is only invited, and phone numbers.
const GUEST_STATUS_GROUPS = ['confirmed', 'excused', 'excused_accepted', 'excused_rejected']
const ORGANIZER_STATUS_GROUPS = ['invited', ...GUEST_STATUS_GROUPS]

function EventOverviewModal({ open, onClose, event, attendees, forOrganizer = false }) {
  const { t } = useI18n()
  const titleId = useId()

  return (
    <ModalOverlay open={open} onClose={onClose} labelledBy={titleId}>
      <div className="modal-card sm:max-w-lg">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.22em]">{t('overview.title')}</p>
            <h3 id={titleId} className="mt-2 text-2xl font-black tracking-[-0.02em] text-slate-900 dark:text-slate-50">
              {event.name}
            </h3>
          </div>
          <button type="button" className="secondary-button shrink-0" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>

        <div className="max-h-[60vh] space-y-5 overflow-y-auto">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">{t('overview.note')}</p>
            <p className="rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-3 text-sm leading-6 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-200">
              {event.description || t('overview.noNote')}
            </p>
          </div>
          {(forOrganizer ? ORGANIZER_STATUS_GROUPS : GUEST_STATUS_GROUPS).map((statusGroup) => {
            const group = attendees.filter((attendee) => attendee.status === statusGroup)

            if (group.length === 0) {
              return null
            }

            return (
              <div key={statusGroup}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 dark:text-slate-400">
                  {t(`overview.groups.${statusGroup}`)} ({group.length})
                </p>
                <ul className="space-y-2">
                  {group.map((attendee) => (
                    <li
                      key={attendee.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/80 px-4 py-2 dark:border-slate-700 dark:bg-slate-800/60">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{attendee.name}</span>
                      {forOrganizer && (event.requirePhone || attendee.status === 'invited') && attendee.phone ? (
                        <a
                          href={`tel:${attendee.phone}`}
                          className="text-sm font-medium text-fuchsia-700 underline underline-offset-2 dark:text-fuchsia-300">
                          {attendee.phone}
                        </a>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </ModalOverlay>
  )
}

export default EventOverviewModal
