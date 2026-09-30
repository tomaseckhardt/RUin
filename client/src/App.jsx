import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import CreateEventPage from './pages/CreateEventPage.jsx'
import FloatingBugReportButton from './components/FloatingBugReportButton.jsx'
import PageShell from './components/PageShell.jsx'
import { useI18n } from './lib/i18n.js'

// The landing page stays in the main bundle, the rest load on first visit.
const EventPage = lazy(() => import('./pages/EventPage.jsx'))
const ManageEventPage = lazy(() => import('./pages/ManageEventPage.jsx'))
const CreatePollPage = lazy(() => import('./pages/CreatePollPage.jsx'))
const PollPage = lazy(() => import('./pages/PollPage.jsx'))
const OwnerDashboardPage = lazy(() => import('./pages/OwnerDashboardPage.jsx'))
const FeedbackPage = lazy(() => import('./pages/FeedbackPage.jsx'))

function PageFallback() {
  const { t } = useI18n()
  return <PageShell title={t('common.loading')} />
}

// Remounts the page when the route id changes, so switching events or polls
// in the same tab never shows the previous one's state.
function KeyedById({ Page }) {
  const { id } = useParams()
  return <Page key={id} />
}

function App() {
  return (
    <>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route path="/" element={<CreateEventPage />} />
          <Route path="/event/:id" element={<KeyedById Page={EventPage} />} />
          <Route path="/event/:id/manage" element={<KeyedById Page={ManageEventPage} />} />
          <Route path="/poll/new" element={<CreatePollPage />} />
          <Route path="/poll/:id" element={<KeyedById Page={PollPage} />} />
          <Route path="/moje" element={<OwnerDashboardPage />} />
          <Route path="/feedback" element={<FeedbackPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <FloatingBugReportButton />
    </>
  )
}

export default App
