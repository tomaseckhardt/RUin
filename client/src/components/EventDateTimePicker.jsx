import { useEffect, useRef, useState } from 'react'
import { formatDateTime, parseLocalDateTime, toDateTimeLocalValue } from '../lib/format.js'

const WEEKDAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
const MONTH_LABELS = [
  'leden', 'únor', 'březen', 'duben', 'květen', 'červen',
  'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec',
]
const DEFAULT_TIME = '18:00'

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function getMonthMatrix(year, month) {
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []

  for (let i = 0; i < firstWeekday; i += 1) {
    cells.push(null)
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day))
  }

  while (cells.length % 7 !== 0) {
    cells.push(null)
  }

  const weeks = []

  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7))
  }

  return weeks
}

function isSameDay(a, b) {
  return Boolean(a) && Boolean(b)
    && a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function combineDateAndTime(date, timeStr) {
  const [hours, minutes] = (timeStr || DEFAULT_TIME).split(':').map(Number)
  const combined = new Date(date)
  combined.setHours(hours, minutes, 0, 0)
  return toDateTimeLocalValue(combined)
}

function nextOccurrence(targetDow, hours, minutes) {
  const now = new Date()
  const diff = (targetDow - now.getDay() + 7) % 7
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff, hours, minutes, 0, 0)

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7)
  }

  return candidate
}

function buildPresets() {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 18, 0, 0, 0)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 18, 0, 0, 0)

  const presets = [
    { key: 'today', label: 'Dnes 18:00', date: today },
    { key: 'tomorrow', label: 'Zítra 18:00', date: tomorrow },
    { key: 'friday', label: 'Pátek 19:00', date: nextOccurrence(5, 19, 0) },
    { key: 'saturday', label: 'Sobota 14:00', date: nextOccurrence(6, 14, 0) },
  ]

  return presets.filter((preset) => preset.date.getTime() > now.getTime())
}

function EventDateTimePicker({ value, onChange }) {
  const selectedDate = parseLocalDateTime(value)
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(selectedDate || new Date()))
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)

  const presets = buildPresets()
  const timeValue = selectedDate
    ? `${String(selectedDate.getHours()).padStart(2, '0')}:${String(selectedDate.getMinutes()).padStart(2, '0')}`
    : DEFAULT_TIME
  const weeks = getMonthMatrix(viewMonth.getFullYear(), viewMonth.getMonth())
  const today = new Date()
  const todayStart = startOfDay(today)

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  function openPanel() {
    setViewMonth(startOfMonth(selectedDate || new Date()))
    setIsOpen(true)
  }

  function handlePresetClick(date) {
    onChange(toDateTimeLocalValue(date))
    setViewMonth(startOfMonth(date))
    setIsOpen(false)
  }

  function handleDayClick(date) {
    if (startOfDay(date) < todayStart) {
      return
    }

    onChange(combineDateAndTime(date, timeValue))
  }

  function handleTimeChange(event) {
    onChange(combineDateAndTime(selectedDate || today, event.target.value))
  }

  function goToMonth(offset) {
    setViewMonth((current) => new Date(current.getFullYear(), current.getMonth() + offset, 1))
  }

  return (
    <div ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        id="event-datetime-trigger"
        className="field inline-block w-auto text-left"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        onClick={() => (isOpen ? setIsOpen(false) : openPanel())}
      >
        {value ? formatDateTime(value) : 'Vyber datum'}
      </button>

      {isOpen ? (
        <div
          role="dialog"
          aria-labelledby="event-datetime-trigger"
          className="mt-3 rounded-2xl border border-slate-200 bg-white/60 p-4 dark:border-slate-700 dark:bg-slate-950/30"
          style={{ animation: 'scale-in 0.25s ease both' }}
        >
          <div className="flex flex-wrap gap-2" style={{ animation: 'fade-up 0.3s ease both' }}>
            {presets.map((preset) => {
              const isActive = isSameDay(selectedDate, preset.date)
                && selectedDate?.getHours() === preset.date.getHours()
                && selectedDate?.getMinutes() === preset.date.getMinutes()

              return (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => handlePresetClick(preset.date)}
                  className={isActive ? 'primary-button px-3 py-1.5 text-xs' : 'secondary-button px-3 py-1.5 text-xs'}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          <div
            className="mx-auto mt-3 flex flex-col rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-700 dark:bg-slate-950/40"
            style={{ width: '6cm', height: '6cm', animation: 'scale-in 0.3s ease 0.05s both' }}
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="Předchozí měsíc"
                className="flex h-8 w-8 items-center justify-center text-base text-slate-500 dark:text-slate-300"
                onClick={() => goToMonth(-1)}
              >
                ‹
              </button>
              <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                {MONTH_LABELS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
              </p>
              <button
                type="button"
                aria-label="Následující měsíc"
                className="flex h-8 w-8 items-center justify-center text-base text-slate-500 dark:text-slate-300"
                onClick={() => goToMonth(1)}
              >
                ›
              </button>
            </div>

            <div className="mt-1 grid grid-cols-7 text-center text-[8px] font-semibold uppercase text-slate-400 dark:text-slate-500">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>

            <div
              className="mt-0.5 grid flex-1 grid-cols-7 gap-0.5"
              style={{ gridTemplateRows: `repeat(${weeks.length}, 1fr)` }}
            >
              {weeks.flatMap((week, weekIndex) => week.map((date, dayIndex) => {
                if (!date) {
                  return <span key={`${weekIndex}-${dayIndex}`} />
                }

                const isSelected = isSameDay(date, selectedDate)
                const isToday = isSameDay(date, today)
                const isPast = startOfDay(date) < todayStart

                return (
                  <button
                    key={date.toISOString()}
                    type="button"
                    disabled={isPast}
                    aria-current={isToday ? 'date' : undefined}
                    aria-pressed={isSelected}
                    onClick={() => handleDayClick(date)}
                    className={`flex items-center justify-center rounded text-[10px] font-medium transition ${
                      isPast
                        ? 'cursor-not-allowed text-slate-300 dark:text-slate-700'
                        : isSelected
                          ? 'primary-button'
                          : isToday
                            ? 'border border-[--accent-text] text-slate-800 dark:text-slate-100'
                            : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-white/5'
                    }`}
                  >
                    {date.getDate()}
                  </button>
                )
              }))}
            </div>
          </div>

          <div className="mt-3" style={{ animation: 'fade-up 0.3s ease 0.1s both' }}>
            <label htmlFor="event-datetime-time" className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Čas
            </label>
            <input
              id="event-datetime-time"
              type="time"
              className="field"
              value={timeValue}
              onChange={handleTimeChange}
            />
          </div>

          <button
            type="button"
            className="primary-button mt-3 w-full justify-center"
            onClick={() => {
              setIsOpen(false)
              triggerRef.current?.focus()
            }}
            style={{ animation: 'fade-up 0.3s ease 0.15s both' }}
          >
            Hotovo
          </button>
        </div>
      ) : null}
    </div>
  )
}

export default EventDateTimePicker
