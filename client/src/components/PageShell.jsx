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
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.22),transparent_62%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_58%)]" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header
          className="hero-panel mb-6 flex flex-col gap-4 px-4 py-5 sm:mb-8 sm:gap-6 sm:px-8 sm:py-6 lg:flex-row lg:items-end lg:justify-between"
          style={{
            color: 'var(--header-text)',
          }}
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(111,76,255,0.34),transparent_70%)] blur-2xl" />
          <div className="pointer-events-none absolute -bottom-12 left-8 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(122,28,63,0.22),transparent_70%)] blur-2xl" />
          <div className="max-w-2xl">
            <Link to="/" className="floating-badge">
              R U in?
            </Link>
            <p className="mt-5 text-sm font-medium uppercase tracking-[0.28em]" style={{ color: 'var(--brand-soft)' }}>
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-[-0.03em] text-balance sm:text-6xl">
              {title}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 sm:mt-4 sm:text-lg sm:leading-7" style={{ color: 'var(--text-soft)' }}>
              {subtitle}
            </p>
          </div>
          <div className="relative z-10 flex flex-wrap items-center gap-2 sm:gap-3">
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