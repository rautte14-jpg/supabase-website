import { Component, lazy, Suspense, useEffect, useState } from 'react'

const PrDetailOverlayComplete = lazy(() => import('./PrDetailOverlayComplete.jsx'))
const PrTrackerCompleteV2 = lazy(() => import('./PrTrackerCompleteV2.jsx'))
const PrOpenPositionV2 = lazy(() => import('./PrOpenPositionV2.jsx'))
const PrPoSectionTabs = lazy(() => import('./PrPoSectionTabs.jsx'))
const PrMonthlyChart = lazy(() => import('./PrMonthlyChart.jsx'))
const PrfWorkspace = lazy(() => import('./PrfWorkspace.jsx'))
const PendingPaymentsWorkspace = lazy(() => import('./PendingPaymentsWorkspace.jsx'))
const MtrWorkspace = lazy(() => import('./MtrWorkspace.jsx'))
const MtrFastUpload = lazy(() => import('./MtrFastUpload.jsx'))

const clean = (v) => String(v ?? '').trim()

function readRoute() {
  return clean(document.querySelector('.topbar-context strong')?.textContent)
}

function routeReady(route) {
  if (!route) return false
  const expected = route === 'PR & PO Tracker' ? 'Purchase Requests' : route
  return [...document.querySelectorAll('h1,h2,h3')].some((el) => clean(el.textContent) === expected)
}

class EnhancerBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) { console.error('Route enhancer failed; base page kept visible.', error) }
  componentDidUpdate(prevProps) {
    if (prevProps.routeKey !== this.props.routeKey && this.state.failed) this.setState({ failed: false })
  }
  render() { return this.state.failed ? null : this.props.children }
}

export default function RouteEnhancers() {
  const [desiredRoute, setDesiredRoute] = useState('')
  const [mountedRoute, setMountedRoute] = useState('')

  useEffect(() => {
    let disposed = false
    let observer = null
    let observedTarget = null
    let settleTimer = null

    const mountWhenReady = (route) => {
      window.clearTimeout(settleTimer)
      if (!route) { setMountedRoute(''); return }
      let attempts = 0
      const tryMount = () => {
        if (disposed) return
        attempts += 1
        if (readRoute() === route && routeReady(route)) {
          requestAnimationFrame(() => requestAnimationFrame(() => {
            if (!disposed && readRoute() === route && routeReady(route)) setMountedRoute(route)
          }))
          return
        }
        if (attempts < 20) settleTimer = window.setTimeout(tryMount, 50)
      }
      settleTimer = window.setTimeout(tryMount, 40)
    }

    const sync = () => {
      if (disposed) return
      const next = readRoute()
      setDesiredRoute((old) => old === next ? old : next)
      setMountedRoute((old) => old === next ? old : '')
      mountWhenReady(next)
    }

    const attachObserver = () => {
      const target = document.querySelector('.topbar-context strong') || document.querySelector('.topbar-context')
      if (!target || target === observedTarget) return
      observer?.disconnect()
      observedTarget = target
      observer = new MutationObserver(sync)
      observer.observe(target, { childList: true, subtree: true, characterData: true })
      sync()
    }

    const onNavClick = (event) => {
      const item = event.target.closest('.nav-item')
      if (!item) return
      // Unmount the current enhancer before App swaps the page DOM. This avoids
      // cleanup code from the previous module touching the next module's nodes.
      setMountedRoute('')
      window.clearTimeout(settleTimer)
      requestAnimationFrame(() => {
        attachObserver()
        sync()
      })
    }

    attachObserver()
    document.addEventListener('click', onNavClick, true)

    const bootTimer = window.setInterval(() => {
      if (observedTarget?.isConnected) { window.clearInterval(bootTimer); return }
      attachObserver()
    }, 120)

    return () => {
      disposed = true
      observer?.disconnect()
      document.removeEventListener('click', onNavClick, true)
      window.clearInterval(bootTimer)
      window.clearTimeout(settleTimer)
    }
  }, [])

  const route = mountedRoute
  const purchaseRequests = route === 'Purchase Requests' || route === 'PR & PO Tracker'
  const prf = route === 'PRF Tracker'
  const payments = route === 'Pending Payments'
  const mtr = route === 'MTR Tracker'
  const updates = route === 'Update Centre'

  return (
    <EnhancerBoundary routeKey={desiredRoute || route}>
      <Suspense fallback={null}>
        {purchaseRequests && <>
          <PrDetailOverlayComplete />
          <PrTrackerCompleteV2 />
          <PrOpenPositionV2 />
          <PrPoSectionTabs />
          <PrMonthlyChart />
        </>}
        {prf && <PrfWorkspace />}
        {payments && <PendingPaymentsWorkspace />}
        {mtr && <MtrWorkspace />}
        {updates && <MtrFastUpload />}
      </Suspense>
    </EnhancerBoundary>
  )
}
