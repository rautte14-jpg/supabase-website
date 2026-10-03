import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PrDetailOverlay from './PrDetailOverlay.jsx'
import PrTrackerComplete from './PrTrackerComplete.jsx'
import './styles.css'
import './tailwind.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PrDetailOverlay />
    <PrTrackerComplete />
  </StrictMode>,
)
