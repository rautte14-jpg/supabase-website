import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import PrDetailOverlayComplete from './PrDetailOverlayComplete.jsx'
import PrTrackerCompleteV2 from './PrTrackerCompleteV2.jsx'
import PrOpenPositionV2 from './PrOpenPositionV2.jsx'
import PrPoSectionTabs from './PrPoSectionTabs.jsx'
import PrMonthlyChart from './PrMonthlyChart.jsx'
import PurchaseRequestsRename from './PurchaseRequestsRename.jsx'
import PrfWorkspace from './PrfWorkspace.jsx'
import PendingPaymentsWorkspace from './PendingPaymentsWorkspace.jsx'
import MtrNavPlacement from './MtrNavPlacement.jsx'
import SidebarCollapse from './SidebarCollapse.jsx'
import MtrWorkspace from './MtrWorkspace.jsx'
import MtrFastUpload from './MtrFastUpload.jsx'
import MtrLegacyHider from './MtrLegacyHider.jsx'
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
    <PurchaseRequestsRename />
    <PrfWorkspace />
    <PendingPaymentsWorkspace />
    <MtrNavPlacement />
    <SidebarCollapse />
    <MtrWorkspace />
    <MtrFastUpload />
    <MtrLegacyHider />
  </StrictMode>,
)
