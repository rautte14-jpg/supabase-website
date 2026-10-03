import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PrDetailOverlayComplete from './PrDetailOverlayComplete.jsx'
import PrTrackerCompleteV2 from './PrTrackerCompleteV2.jsx'
import PrOpenPositionV2 from './PrOpenPositionV2.jsx'
import PrPoSectionTabs from './PrPoSectionTabs.jsx'
import PrMonthlyChart from './PrMonthlyChart.jsx'
import './styles.css'
import './tailwind.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
    <PrDetailOverlayComplete />
    <PrTrackerCompleteV2 />
    <PrOpenPositionV2 />
    <PrPoSectionTabs />
    <PrMonthlyChart />
  </StrictMode>,
)
