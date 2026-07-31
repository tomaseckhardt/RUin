import { Navigate, Route, Routes } from 'react-router-dom'
import CreateEventPage from './pages/CreateEventPage.jsx'
import EventPage from './pages/EventPage.jsx'
import ManageEventPage from './pages/ManageEventPage.jsx'
import CreatePollPage from './pages/CreatePollPage.jsx'
import PollPage from './pages/PollPage.jsx'
import FeedbackPage from './pages/FeedbackPage.jsx'
import FloatingBugReportButton from './components/FloatingBugReportButton.jsx'

function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<CreateEventPage />} />
        <Route path="/event/:id" element={<EventPage />} />
        <Route path="/event/:id/manage" element={<ManageEventPage />} />
        <Route path="/poll/new" element={<CreatePollPage />} />
        <Route path="/poll/:id" element={<PollPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <FloatingBugReportButton />
    </>
  )
}

export default App
