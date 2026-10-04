import { useEffect } from 'react'

const clean = (v) => String(v ?? '').trim()

function getMtrFrame() {
  const heading = [...document.querySelectorAll('h1,h2,h3')].find(
    (el) => clean(el.textContent) === 'MTR Tracker',
  )
  if (!heading) return null
  const pageHeader = heading.closest('.page-header') || heading.parentElement
  const content = pageHeader?.parentElement
  if (!pageHeader || !content) return null
  const host = content.querySelector(':scope > .mtrw-host') || document.querySelector('.mtrw-host')
  if (!host) return null
  return { content, pageHeader, host }
}

export default function MtrLegacyHider() {
  useEffect(() => {
    let observer = null
    let disposed = false

    const apply = () => {
      if (disposed) return
      const frame = getMtrFrame()
      if (!frame) return
      const { content, pageHeader, host } = frame

      ;[...content.children].forEach((child) => {
        if (child === pageHeader || child === host) return
        if (!child.dataset.mtrLegacyDisplay) {
          child.dataset.mtrLegacyDisplay = child.style.display || '__empty__'
        }
        child.style.setProperty('display', 'none', 'important')
        child.setAttribute('aria-hidden', 'true')
      })

      if (!observer) {
        observer = new MutationObserver(() => apply())
        observer.observe(content, { childList: true, subtree: false })
      }
    }

    apply()
    const id = window.setInterval(apply, 300)

    return () => {
      disposed = true
      window.clearInterval(id)
      observer?.disconnect()
      document.querySelectorAll('[data-mtr-legacy-display]').forEach((el) => {
        const previous = el.dataset.mtrLegacyDisplay
        if (previous === '__empty__') el.style.removeProperty('display')
        else el.style.display = previous || ''
        el.removeAttribute('aria-hidden')
        delete el.dataset.mtrLegacyDisplay
      })
    }
  }, [])

  return null
}
