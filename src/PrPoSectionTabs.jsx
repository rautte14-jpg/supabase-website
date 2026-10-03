import { useEffect } from 'react'

const ACTIVE_KEY = 'srd-prpo-active-tab'

const clean = (v) => String(v ?? '').trim()
const upper = (v) => clean(v).toUpperCase()

function findSectionByText(text) {
  const leaf = [...document.querySelectorAll('body *')].find((el) =>
    el.children.length === 0 && upper(el.textContent).includes(text)
  )
  return leaf?.closest('section') || null
}

function makeButton(label, value, icon) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.prpoTab = value
  button.className = 'prpo-section-tab'
  button.innerHTML = `<span class="prpo-section-tab-icon">${icon}</span><span>${label}</span>`
  return button
}

function applyTab(active, activitySection, attentionHost, lifecycleShell, nav) {
  const safe = ['activity', 'attention', 'lifecycle'].includes(active) ? active : 'activity'

  activitySection.style.display = safe === 'activity' ? '' : 'none'
  attentionHost.style.display = safe === 'attention' ? '' : 'none'
  lifecycleShell.style.display = safe === 'lifecycle' ? '' : 'none'

  nav.querySelectorAll('[data-prpo-tab]').forEach((button) => {
    const selected = button.dataset.prpoTab === safe
    button.classList.toggle('active', selected)
    button.setAttribute('aria-selected', selected ? 'true' : 'false')
  })

  try { sessionStorage.setItem(ACTIVE_KEY, safe) } catch {}
}

export default function PrPoSectionTabs() {
  useEffect(() => {
    let disposed = false
    let active = (() => {
      try { return sessionStorage.getItem(ACTIVE_KEY) || 'activity' } catch { return 'activity' }
    })()

    const setup = () => {
      if (disposed) return

      const activitySection = findSectionByText('01 · PR SUBMISSION ACTIVITY')
      const receiptSection = findSectionByText('03 · RECEIPT ACTIVITY')
      const attentionHost = document.querySelector('.opv2-host')
      const lifecycleHost = document.querySelector('.prv2-host')
      if (!activitySection || !receiptSection || !attentionHost || !lifecycleHost || !activitySection.parentElement) return

      const parent = activitySection.parentElement

      let lifecycleShell = parent.querySelector(':scope > .prpo-tab-lifecycle-shell')
      if (!lifecycleShell) {
        lifecycleShell = document.createElement('div')
        lifecycleShell.className = 'prpo-tab-lifecycle-shell'
        lifecycleShell.style.marginTop = '16px'
        activitySection.insertAdjacentElement('afterend', lifecycleShell)
      }

      // The lifecycle tab owns both the live PR lifecycle table and receipt activity.
      if (lifecycleHost.parentElement !== lifecycleShell) lifecycleShell.appendChild(lifecycleHost)
      if (receiptSection.parentElement !== lifecycleShell) lifecycleShell.appendChild(receiptSection)
      receiptSection.classList.add('prpo-receipt-in-lifecycle')

      let nav = parent.querySelector(':scope > .prpo-section-tabs')
      if (!nav) {
        nav = document.createElement('div')
        nav.className = 'prpo-section-tabs'
        nav.setAttribute('role', 'tablist')
        nav.setAttribute('aria-label', 'PR and PO tracker sections')

        const activityButton = makeButton('PR Activity', 'activity', '▤')
        const attentionButton = makeButton('Operational Attention', 'attention', '◉')
        const lifecycleButton = makeButton('PR Lifecycle', 'lifecycle', '⇢')

        ;[activityButton, attentionButton, lifecycleButton].forEach((button) => {
          button.addEventListener('click', () => {
            active = button.dataset.prpoTab
            applyTab(active, activitySection, attentionHost, lifecycleShell, nav)
            window.scrollTo({ top: Math.max(0, nav.getBoundingClientRect().top + window.scrollY - 88), behavior: 'smooth' })
          })
        })

        nav.append(activityButton, attentionButton, lifecycleButton)
        parent.insertBefore(nav, activitySection)

        const style = document.createElement('style')
        style.dataset.prpoSectionTabsStyle = 'true'
        style.textContent = `
          .prpo-section-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:10px 0 16px;background:#fff;border:1px solid #dbe5f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)}
          .prpo-section-tab{display:flex;align-items:center;justify-content:center;gap:9px;min-height:52px;border:0;border-right:1px solid #e2e8f0;background:#fff;color:#475569;font-size:12px;font-weight:750;cursor:pointer;transition:.16s ease;position:relative}
          .prpo-section-tab:last-child{border-right:0}.prpo-section-tab:hover{background:#f8fafc;color:#1e3a5f}.prpo-section-tab.active{background:#eff6ff;color:#174ea6;box-shadow:inset 0 -3px 0 #2563eb}.prpo-section-tab-icon{font-size:15px;color:#64748b}.prpo-section-tab.active .prpo-section-tab-icon{color:#2563eb}
          .prpo-tab-lifecycle-shell>.prv2-host{margin-top:0!important}.prpo-tab-lifecycle-shell>.prpo-receipt-in-lifecycle{margin-top:16px!important}
          @media(max-width:760px){.prpo-section-tabs{grid-template-columns:1fr}.prpo-section-tab{border-right:0;border-bottom:1px solid #e2e8f0}.prpo-section-tab:last-child{border-bottom:0}}
        `
        document.head.appendChild(style)
      }

      applyTab(active, activitySection, attentionHost, lifecycleShell, nav)
    }

    setup()
    const id = window.setInterval(setup, 500)

    return () => {
      disposed = true
      window.clearInterval(id)
    }
  }, [])

  return null
}
