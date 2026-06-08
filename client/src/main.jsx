import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.jsx'
import { ensurePushServiceWorker } from './lib/push.js'

if (typeof window !== 'undefined') {
  ensurePushServiceWorker().catch(() => {})
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
      <Toaster richColors position="top-center" />
    </HashRouter>
  </StrictMode>,
)
