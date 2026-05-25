import { Link } from 'react-router-dom'

function PageShell({ eyebrow, title, subtitle, children, actions }) {
  return (
    <div className="relative overflow-hidden">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-6 rounded-[2rem] border border-white/70 bg-slate-950 px-6 py-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.25)] sm:px-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <Link
              to="/"
              className="inline-flex rounded-full border border-white/20 px-3 py-1 text-sm font-semibold tracking-[0.2em] text-orange-200 uppercase transition hover:border-orange-300 hover:text-white"
            >
              R U in?
            </Link>
            <p className="mt-4 text-sm font-semibold uppercase tracking-[0.3em] text-orange-200/80">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-4xl font-black tracking-tight text-balance sm:text-5xl">
              {title}
            </h1>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              {subtitle}
            </p>
          </div>
          {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
        </header>
        {children}
      </div>
    </div>
  )
}

export default PageShell