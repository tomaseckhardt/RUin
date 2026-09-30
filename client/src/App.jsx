import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import CreateEventPage from './pages/CreateEventPage.jsx'
import EventPage from './pages/EventPage.jsx'
import ManageEventPage from './pages/ManageEventPage.jsx'
import CreatePollPage from './pages/CreatePollPage.jsx'
import PollPage from './pages/PollPage.jsx'
import OwnerDashboardPage from './pages/OwnerDashboardPage.jsx'
import FeedbackPage from './pages/FeedbackPage.jsx'
import FloatingBugReportButton from './components/FloatingBugReportButton.jsx'

// Remounts the page when the route id changes, so switching events or polls
// in the same tab never shows the previous one's state.
function KeyedById({ Page }) {
  const { id } = useParams()
  return <Page key={id} />
}

function App() {
  return (
    <>
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
      <FloatingBugReportButton />
    </>
  )
}

export default App
