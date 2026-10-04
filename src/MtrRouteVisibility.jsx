import { useEffect } from 'react'

const clean = (v) => String(v ?? '').trim()

function currentViewLabel() {
  return clean(document.querySelector('.topbar-context strong')?.textContent)
}

function restoreLegacyContent() {
  document.querySelectorAll('[data-mtr-legacy-display]').forEach((el) => {
    const previous = el.dataset.mtrLegacyDisplay
    if (previous === '__empty__') el.style.removeProperty('display')
    else el.style.display = previous || ''
    el.removeAttribute('aria-hidden')
    delete el.dataset.mtrLegacyDisplay
  })
}

function syncMtrVisibility() {
  const isMtr = currentViewLabel() === 'MTR Tracker'
  document.querySelectorAll('.mtrw-host').forEach((host) => {
    host.style.setProperty('display', isMtr ? '' : 'none', isMtr ? '' : 'important')
    if (isMtr) host.style.removeProperty('display')
  })

  if (!isMtr) restoreLegacyContent()
}

export default function MtrRouteVisibility() {
  useEffect(() => {
    syncMtrVisibility()

    const topbar = document.querySelector('.topbar-context') || document.body
    const observer = new MutationObserver(syncMtrVisibility)
    observer.observe(topbar, { childList: true, subtree: true, characterData: true })

    const onNavClick = (event) => {
      const item = event.target.closest('.nav-item')
      if (!item) return
      const label = clean(item.textContent)
      if (label !== 'MTR Tracker') {
        document.querySelectorAll('.mtrw-host').forEach((host) => {
          host.style.setProperty('display', 'none', 'important')
        })
        restoreLegacyContent()
      }
    }

    document.addEventListener('click', onNavClick, true)
    const timer = window.setInterval(syncMtrVisibility, 250)

    return () => {
      observer.disconnect()
      document.removeEventListener('click', onNavClick, true)
      window.clearInterval(timer)
    }
  }, [])

  return null
}
