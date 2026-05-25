import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

function getInitialTheme() {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const savedTheme = window.localStorage.getItem('ruin-theme')

  if (savedTheme === 'light' || savedTheme === 'dark') {
    return savedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function PageShell({ eyebrow, title, subtitle, children, actions }) {
  const [theme, setTheme] = useState(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('ruin-theme', theme)
  }, [theme])

  return (
    <div className="relative overflow-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header
          className="mb-8 flex flex-col gap-6 rounded-[1.75rem] border px-6 py-6 backdrop-blur-xl sm:px-8 lg:flex-row lg:items-end lg:justify-between"
          style={{
            background: 'var(--header-bg)',
            borderColor: 'var(--header-border)',
            color: 'var(--header-text)',
            boxShadow: 'var(--panel-shadow)',
          }}
        >
          <div className="max-w-2xl">
            <Link
              to="/"
              className="inline-flex rounded-full border px-3 py-1 text-sm font-medium tracking-[0.16em] uppercase transition"
              style={{ borderColor: 'var(--header-border)', color: 'var(--brand-soft)' }}
            >
              R U in?
            </Link>
            <p className="mt-4 text-sm font-medium uppercase tracking-[0.28em]" style={{ color: 'var(--brand-soft)' }}>
              {eyebrow}
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 sm:text-lg" style={{ color: 'var(--text-soft)' }}>
              {subtitle}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setTheme((currentTheme) => (currentTheme === 'dark' ? 'light' : 'dark'))}
            >
              {theme === 'dark' ? 'Světlý režim' : 'Tmavý režim'}
            </button>
            {actions}
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}

export default PageShell