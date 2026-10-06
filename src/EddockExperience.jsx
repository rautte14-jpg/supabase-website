import { useEffect } from 'react'

const clean = (v) => String(v ?? '').trim()

function routeName() {
  return clean(document.querySelector('.topbar-context strong')?.textContent)
}

function applyBrand() {
  const brand = document.querySelector('.brand')
  if (!brand) return
  const box = brand.querySelector('.brand-box')
  const strong = brand.querySelector('strong')
  const span = brand.querySelector('span')
  if (box) box.textContent = 'ED'
  if (strong) strong.textContent = 'EDDOCK'
  if (span) span.textContent = 'Materials & Operations'
}

function enhanceVessel() {
  const route = routeName()
  if (route !== 'Vessel / SR View') return
  const input = document.querySelector('.vessel-search input')
  const empty = document.querySelector('.empty-state')
  if (!input || !empty || document.querySelector('.eddock-vessel-guide')) return

  empty.classList.add('vessel-empty-state')
  const guide = document.createElement('div')
  guide.className = 'eddock-vessel-guide'
  guide.innerHTML = `
    <div class="eddock-vessel-guide-head">
      <span>UNIFIED TRACE</span>
      <strong>Find the complete material trail in one search</strong>
      <small>Search across procurement, transfer, MRN and ERP issue activity.</small>
    </div>
    <div class="eddock-vessel-guide-grid">
      <button type="button" data-hint="vessel"><b>Vessel</b><span>Track all material activity for one vessel</span></button>
      <button type="button" data-hint="sr"><b>Service Request</b><span>Trace procurement and issue activity by SR</span></button>
      <button type="button" data-hint="wo"><b>Work Order</b><span>Follow materials linked to a work order</span></button>
      <button type="button" data-hint="asset"><b>Asset / Reference</b><span>Search using an asset or source reference</span></button>
    </div>
  `
  empty.parentElement?.insertBefore(guide, empty)
  guide.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      input.focus()
      input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  })
}

function applyRouteClass() {
  const route = routeName()
  document.body.dataset.eddockRoute = route || ''
}

export default function EddockExperience() {
  useEffect(() => {
    let raf = 0
    const apply = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        applyBrand()
        applyRouteClass()
        enhanceVessel()
      })
    }

    apply()
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      delete document.body.dataset.eddockRoute
    }
  }, [])
  return null
}
