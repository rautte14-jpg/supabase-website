import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import AppCrashBoundary from './AppCrashBoundary.jsx'
import PerformanceLayer from './PerformanceLayer.jsx'
import './styles.css'
import './tailwind.css'
import './eddock-ui.css'
import './eddock-ui-v2.css'
import './eddock-ui-v3.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppCrashBoundary>
      <App />
    </AppCrashBoundary>
    <PerformanceLayer />
  </StrictMode>,
)
