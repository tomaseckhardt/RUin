import { Link } from 'react-router-dom'
import PageShell from '../components/PageShell.jsx'
import { useI18n } from '../lib/i18n.js'

const RUDY_HUNGOVER_GIF = `${import.meta.env.BASE_URL || '/'}RUdy/RUdy-hungover.gif`

function NotFoundPage() {
  const { t } = useI18n()

  return (
    <PageShell eyebrow="404" title={t('notFound.title')} subtitle={t('notFound.subtitle')}>
      <section className="panel mx-auto max-w-xl py-10 text-center">
        <img src={RUDY_HUNGOVER_GIF} alt={t('notFound.imageAlt')} width={180} height={210} className="mx-auto rounded-[1.5rem]" />
        <p className="mt-6 text-slate-600 dark:text-slate-300">{t('notFound.text')}</p>
        <Link to="/" replace className="primary-button mt-6">
          {t('notFound.home')}
        </Link>
      </section>
    </PageShell>
  )
}

export default NotFoundPage
