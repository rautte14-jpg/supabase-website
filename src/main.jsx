import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import AppCrashBoundary from './AppCrashBoundary.jsx'
import PerformanceLayer from './PerformanceLayer.jsx'
import PurchaseRequestsRename from './PurchaseRequestsRename.jsx'
import MtrNavPlacement from './MtrNavPlacement.jsx'
import SidebarCollapse from './SidebarCollapse.jsx'
import RouteEnhancers from './RouteEnhancers.jsx'
import EddockExperience from './EddockExperience.jsx'
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
    <PurchaseRequestsRename />
    <MtrNavPlacement />
    <SidebarCollapse />
    <RouteEnhancers />
    <EddockExperience />
  </StrictMode>,
)
