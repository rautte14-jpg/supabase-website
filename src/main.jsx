import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PrDetailOverlayComplete from './PrDetailOverlayComplete.jsx'
import PrTrackerComplete from './PrTrackerComplete.jsx'
import './styles.css'
import './tailwind.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PrDetailOverlayComplete />
    <PrTrackerComplete />
  </StrictMode>,
)
