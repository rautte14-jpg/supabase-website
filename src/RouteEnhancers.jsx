import { lazy, Suspense, useEffect, useState } from 'react'

const PrDetailOverlayComplete = lazy(() => import('./PrDetailOverlayComplete.jsx'))
const PrTrackerCompleteV2 = lazy(() => import('./PrTrackerCompleteV2.jsx'))
const PrOpenPositionV2 = lazy(() => import('./PrOpenPositionV2.jsx'))
const PrPoSectionTabs = lazy(() => import('./PrPoSectionTabs.jsx'))
const PrMonthlyChart = lazy(() => import('./PrMonthlyChart.jsx'))
const PrfWorkspace = lazy(() => import('./PrfWorkspace.jsx'))
const PendingPaymentsWorkspace = lazy(() => import('./PendingPaymentsWorkspace.jsx'))
const PendingPaymentsRouteVisibility = lazy(() => import('./PendingPaymentsRouteVisibility.jsx'))
const MtrWorkspace = lazy(() => import('./MtrWorkspace.jsx'))
const MtrLegacyHider = lazy(() => import('./MtrLegacyHider.jsx'))
const MtrRouteVisibility = lazy(() => import('./MtrRouteVisibility.jsx'))
const MtrFastUpload = lazy(() => import('./MtrFastUpload.jsx'))

const clean = (v) => String(v ?? '').trim()

function readRoute() {
  return clean(document.querySelector('.topbar-context strong')?.textContent)
}

export default function RouteEnhancers() {
  const [route, setRoute] = useState('')

  useEffect(() => {
    let disposed = false
    const sync = () => {
      if (disposed) return
      const next = readRoute()
      setRoute((old) => (old === next ? old : next))
    }

    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    const onClick = () => requestAnimationFrame(sync)
    document.addEventListener('click', onClick, true)
    const timer = window.setInterval(sync, 1000)

    return () => {
      disposed = true
      observer.disconnect()
      document.removeEventListener('click', onClick, true)
      window.clearInterval(timer)
    }
  }, [])

  const purchaseRequests = route === 'Purchase Requests' || route === 'PR & PO Tracker'
  const prf = route === 'PRF Tracker'
  const payments = route === 'Pending Payments'
  const mtr = route === 'MTR Tracker'
  const updates = route === 'Update Centre'

  return (
    <Suspense fallback={null}>
      {purchaseRequests && <>
        <PrDetailOverlayComplete />
        <PrTrackerCompleteV2 />
        <PrOpenPositionV2 />
        <PrPoSectionTabs />
        <PrMonthlyChart />
      </>}
      {prf && <PrfWorkspace />}
      {payments && <>
        <PendingPaymentsWorkspace />
        <PendingPaymentsRouteVisibility />
      </>}
      {mtr && <>
        <MtrWorkspace />
        <MtrLegacyHider />
        <MtrRouteVisibility />
      </>}
      {updates && <MtrFastUpload />}
    </Suspense>
  )
}
