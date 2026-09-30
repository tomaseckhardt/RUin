import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import App from './App.jsx'
import { installEnterToSubmit } from './lib/enterToSubmit.js'
import { installErrorReporting } from './lib/errorReporting.js'
import { ensurePushServiceWorker } from './lib/push.js'

installErrorReporting()
ensurePushServiceWorker().catch(() => {})
installEnterToSubmit()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <HashRouter>
      <App />
      <Toaster richColors position="top-center" />
    </HashRouter>
  </StrictMode>,
)
