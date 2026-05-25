import { Navigate, Route, Routes } from 'react-router-dom'
import CreateEventPage from './pages/CreateEventPage.jsx'
import EventPage from './pages/EventPage.jsx'
import ManageEventPage from './pages/ManageEventPage.jsx'

function App() {
  return (
    <Routes>
      <Route path="/" element={<CreateEventPage />} />
      <Route path="/event/:id" element={<EventPage />} />
      <Route path="/event/:id/manage" element={<ManageEventPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
