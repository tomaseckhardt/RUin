import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import ToggleSwitch from './ToggleSwitch.jsx'
import { LOCALE_NAMES, LOCALE_SHORT_NAMES, SUPPORTED_LOCALES, useI18n } from '../lib/i18n.js'
import { useOnlineStatus } from '../lib/useOnlineStatus.js'

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

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />
    </svg>
  )
}

function PageShell({ eyebrow, title, subtitle, children, actions, mergeNextPanel = false }) {
  const [theme, setTheme] = useState(getInitialTheme)
  const isOnline = useOnlineStatus()
  const { locale, setLocale, t } = useI18n()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    window.localStorage.setItem('ruin-theme', theme)
  }, [theme])

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.22),transparent_62%)] dark:bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.06),transparent_58%)]" />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <header
          className={`hero-panel px-4 py-5 sm:px-8 sm:py-6 ${
            mergeNextPanel ? 'mb-0 rounded-b-none border-b-0' : 'mb-6 sm:mb-8'
          }`}
          style={{
            color: 'var(--header-text)',
          }}
        >
          <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-[radial-gradient(circle,rgba(111,76,255,0.34),transparent_70%)] blur-2xl" />
          <div className="pointer-events-none absolute -bottom-12 left-8 h-36 w-36 rounded-full bg-[radial-gradient(circle,rgba(122,28,63,0.22),transparent_70%)] blur-2xl" />
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-3">
            <Link to="/" className="floating-badge">
              R U in?
            </Link>
            <div className="flex items-center gap-2">
              <ToggleSwitch
                label={LOCALE_NAMES.en}
                lang="en"
                title={t('shell.language')}
                value={locale}
                onChange={setLocale}
                options={SUPPORTED_LOCALES.map((code) => ({ value: code, lang: code, content: LOCALE_SHORT_NAMES[code] }))}
              />
              <ToggleSwitch
                label={t('shell.darkMode')}
                title={t('shell.theme')}
                value={theme}
                onChange={setTheme}
                options={[
                  { value: 'light', content: <SunIcon /> },
                  { value: 'dark', content: <MoonIcon /> },
                ]}
              />
            </div>
          </div>
          <div className="flex flex-col gap-4 sm:gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
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
            {actions ? <div className="relative z-10 flex flex-wrap items-center gap-2 sm:gap-3">{actions}</div> : null}
          </div>
        </header>
        {!isOnline && (
          <div
            role="status"
            className="mb-6 rounded-2xl border border-amber-200 bg-amber-50/90 px-4 py-3 text-sm font-medium leading-6 text-amber-900 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100"
          >
            {t('shell.offline')}
          </div>
        )}
        <main>{children}</main>
      </div>
    </div>
  )
}

export default PageShell