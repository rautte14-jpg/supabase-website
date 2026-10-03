import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PrDetailOverlay from './PrDetailOverlay.jsx'
import PrTrackerEnhancer from './PrTrackerEnhancer.jsx'
import PrCountFix from './PrCountFix.jsx'
import './styles.css'
import './tailwind.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PrDetailOverlay />
    <PrTrackerEnhancer />
    <PrCountFix />
  </StrictMode>,
)
