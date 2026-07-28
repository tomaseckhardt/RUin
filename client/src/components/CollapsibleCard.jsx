import { useState } from 'react'

function CollapsibleCard({ eyebrow, title, headerActions, defaultOpen = true, children }) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <section className="panel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          className="flex flex-1 items-start gap-3 text-left"
          onClick={() => setIsOpen((current) => !current)}
          aria-expanded={isOpen}
        >
          <svg
            viewBox="0 0 20 20"
            fill="none"
            className={`mt-1.5 h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ${isOpen ? 'rotate-90' : ''}`}
          >
            <path d="M7 4.5L13 10L7 15.5" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>
            <p className="accent-copy text-sm font-semibold uppercase tracking-[0.24em]">{eyebrow}</p>
            <h3 className="mt-2 text-2xl font-black tracking-[-0.03em] text-slate-950 dark:text-slate-50">{title}</h3>
          </span>
        </button>
        {headerActions ? <div className="shrink-0">{headerActions}</div> : null}
      </div>

      {isOpen ? <div className="mt-4">{children}</div> : null}
    </section>
  )
}

export default CollapsibleCard
