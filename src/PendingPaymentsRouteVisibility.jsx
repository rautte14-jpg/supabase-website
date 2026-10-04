import { useEffect } from 'react'

const clean = (v) => String(v ?? '').trim()

function currentViewLabel() {
  return clean(document.querySelector('.topbar-context strong')?.textContent)
}

function syncVisibility() {
  const active = currentViewLabel() === 'Pending Payments'
  document.querySelectorAll('.ppw-host').forEach((host) => {
    if (active) host.style.removeProperty('display')
    else host.style.setProperty('display', 'none', 'important')
  })
}

export default function PendingPaymentsRouteVisibility() {
  useEffect(() => {
    syncVisibility()
    const target = document.querySelector('.topbar-context') || document.body
    const observer = new MutationObserver(syncVisibility)
    observer.observe(target, { childList: true, subtree: true, characterData: true })

    const onNavClick = (event) => {
      const item = event.target.closest('.nav-item')
      if (!item) return
      if (clean(item.textContent) !== 'Pending Payments') {
        document.querySelectorAll('.ppw-host').forEach((host) => {
          host.style.setProperty('display', 'none', 'important')
        })
      }
    }

    document.addEventListener('click', onNavClick, true)
    const timer = window.setInterval(syncVisibility, 150)
    return () => {
      observer.disconnect()
      document.removeEventListener('click', onNavClick, true)
      window.clearInterval(timer)
    }
  }, [])

  return null
}
