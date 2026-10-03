import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

const ACTIVE_KEY = 'srd-prf-active-tab'
const clean = (v) => String(v ?? '').trim()
const upper = (v) => clean(v).toUpperCase()

function findSection(text) {
  const leaf = [...document.querySelectorAll('body *')].find((el) =>
    el.children.length === 0 && upper(el.textContent).includes(text),
  )
  return leaf?.closest('section') || null
}

function findPrfTable() {
  return [...document.querySelectorAll('table')].find((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((th) => upper(th.textContent))
    return heads.some((h) => h.includes('PRF / IPF')) && heads.some((h) => h === 'STATUS')
  }) || null
}

function getStatusCards(section) {
  if (!section) return []
  const candidates = [...section.querySelectorAll('button, [role="button"], .metric-card, .prf-status-card, div')]
  const wanted = [
    ['NOT ATTENDED', 'Needs initial action', 'red'],
    ['ITEM CREATION', 'Item master / creation is pending', 'amber'],
    ['BUDGET ENTRY', 'Budget entry is still pending', 'violet'],
    ['HOLD', 'PRFs currently placed on hold', 'slate'],
    ['CANCEL/REJECT', 'Cancelled or rejected requests', 'rose'],
  ]

  return wanted.map(([label, helper, tone]) => {
    const el = candidates.find((node) => {
      const text = upper(node.textContent)
      return text.startsWith(label) || text.includes(` ${label} `) || text === label
    })
    if (!el) return { label, helper, tone, value: 0, target: null }
    const text = clean(el.textContent)
    const match = text.match(/\b(\d{1,5})\b/)
    return { label, helper, tone, value: match ? Number(match[1]) : 0, target: el }
  })
}

function TabButton({ value, active, icon, children, onClick }) {
  return (
    <button type="button" className={`prfw-tab ${active === value ? 'active' : ''}`} onClick={() => onClick(value)}>
      <span className="prfw-tab-icon">{icon}</span><span>{children}</span>
    </button>
  )
}

export default function PrfWorkspace() {
  const [host, setHost] = useState(null)
  const [weekly, setWeekly] = useState(null)
  const [status, setStatus] = useState(null)
  const [tableWrap, setTableWrap] = useState(null)
  const [attentionHost, setAttentionHost] = useState(null)
  const [active, setActive] = useState(() => {
    try { return sessionStorage.getItem(ACTIVE_KEY) || 'activity' } catch { return 'activity' }
  })
  const [statusCards, setStatusCards] = useState([])

  useEffect(() => {
    let disposed = false
    const setup = () => {
      if (disposed || host) return
      const weeklySection = findSection('WEEKLY SUBMISSIONS')
      const statusSection = findSection('STATUS SUMMARY')
      const table = findPrfTable()
      if (!weeklySection || !statusSection || !table || !weeklySection.parentElement) return

      const parent = weeklySection.parentElement
      let navHost = parent.querySelector(':scope > .prfw-nav-host')
      if (!navHost) {
        navHost = document.createElement('div')
        navHost.className = 'prfw-nav-host'
        parent.insertBefore(navHost, weeklySection)
      }

      let attHost = parent.querySelector(':scope > .prfw-attention-host')
      if (!attHost) {
        attHost = document.createElement('div')
        attHost.className = 'prfw-attention-host'
        statusSection.insertAdjacentElement('afterend', attHost)
      }

      const wrap = table.closest('.table-wrap, .data-table, .overflow-x-auto') || table.parentElement
      setWeekly(weeklySection)
      setStatus(statusSection)
      setTableWrap(wrap)
      setAttentionHost(attHost)
      setStatusCards(getStatusCards(statusSection))
      setHost(navHost)
    }
    setup()
    const id = window.setInterval(setup, 500)
    return () => { disposed = true; window.clearInterval(id) }
  }, [host])

  useEffect(() => {
    if (!weekly || !status || !attentionHost || !tableWrap) return
    const safe = ['activity', 'status', 'attention'].includes(active) ? active : 'activity'
    weekly.style.display = safe === 'activity' ? '' : 'none'
    status.style.display = safe === 'status' ? '' : 'none'
    attentionHost.style.display = safe === 'attention' ? '' : 'none'
    tableWrap.style.display = ''
    try { sessionStorage.setItem(ACTIVE_KEY, safe) } catch {}
  }, [active, weekly, status, attentionHost, tableWrap])

  useEffect(() => {
    if (!status) return
    const id = window.setInterval(() => setStatusCards(getStatusCards(status)), 2000)
    return () => window.clearInterval(id)
  }, [status])

  const totalAttention = useMemo(
    () => statusCards.filter((c) => !['CANCEL/REJECT'].includes(c.label)).reduce((sum, c) => sum + Number(c.value || 0), 0),
    [statusCards],
  )

  const openCard = (card) => {
    if (card.target) {
      card.target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    }
  }

  if (!host) return null

  return createPortal(<>
    <div className="prfw-tabs" role="tablist" aria-label="PRF tracker sections">
      <TabButton value="activity" active={active} icon="▤" onClick={setActive}>PRF Activity</TabButton>
      <TabButton value="status" active={active} icon="◫" onClick={setActive}>Status & Progress</TabButton>
      <TabButton value="attention" active={active} icon="!" onClick={setActive}>Attention Needed</TabButton>
    </div>

    {attentionHost && createPortal(
      <section className="prfw-attention">
        <div className="prfw-attention-head">
          <div>
            <span className="prfw-kicker">OPERATIONAL ATTENTION</span>
            <h3>What needs follow-up?</h3>
            <p>PRFs grouped by statuses that normally require action or review.</p>
          </div>
          <div className="prfw-attention-total"><strong>{totalAttention.toLocaleString()}</strong><span>open attention items</span></div>
        </div>
        <div className="prfw-attention-grid">
          {statusCards.map((card) => (
            <button key={card.label} type="button" className={`prfw-att-card ${card.tone}`} onClick={() => openCard(card)}>
              <span>{card.label}</span>
              <strong>{Number(card.value || 0).toLocaleString()}</strong>
              <p>{card.helper}</p>
              <em>Show matching PRFs →</em>
            </button>
          ))}
        </div>
        <div className="prfw-att-note">The detailed PRF list below remains available in every tab, so weekly and status selections can still be reviewed without changing the existing PRF logic.</div>
      </section>,
      attentionHost,
    )}

    <style>{`
      .prfw-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:2px 0 16px;background:#fff;border:1px solid #dbe5f0;border-radius:12px;overflow:hidden;box-shadow:0 1px 2px rgba(15,23,42,.04)}
      .prfw-tab{min-height:50px;border:0;border-right:1px solid #e2e8f0;background:#fff;color:#475569;font-size:12px;font-weight:750;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:9px;position:relative}.prfw-tab:last-child{border-right:0}.prfw-tab:hover{background:#f8fafc;color:#1e3a5f}.prfw-tab.active{background:#eff6ff;color:#174ea6;box-shadow:inset 0 -3px 0 #2563eb}.prfw-tab-icon{font-size:14px;color:#64748b}.prfw-tab.active .prfw-tab-icon{color:#2563eb}
      .prfw-attention{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;box-shadow:0 1px 2px rgba(15,23,42,.04);margin-bottom:14px}.prfw-attention-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}.prfw-kicker{font-size:9px;font-weight:800;letter-spacing:.11em;color:#1d4ed8}.prfw-attention h3{margin:5px 0 3px;font-size:16px;color:#0f172a}.prfw-attention p{margin:0;font-size:11px;color:#64748b}.prfw-attention-total{display:flex;flex-direction:column;align-items:flex-end}.prfw-attention-total strong{font-size:22px;line-height:1;color:#0f172a}.prfw-attention-total span{margin-top:5px;font-size:10px;color:#64748b}
      .prfw-attention-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.prfw-att-card{text-align:left;border:1px solid #e2e8f0;border-top-width:3px;border-radius:11px;background:#fff;padding:12px;cursor:pointer;min-height:118px}.prfw-att-card>span{font-size:9px;font-weight:800;letter-spacing:.055em;color:#64748b}.prfw-att-card strong{display:block;font-size:23px;margin:12px 0 7px;color:#0f172a}.prfw-att-card p{min-height:30px;line-height:1.35}.prfw-att-card em{display:block;margin-top:8px;font-size:9px;font-style:normal;font-weight:800;color:#2563eb}.prfw-att-card.red{border-top-color:#ef4444}.prfw-att-card.amber{border-top-color:#f59e0b}.prfw-att-card.violet{border-top-color:#8b5cf6}.prfw-att-card.slate{border-top-color:#64748b}.prfw-att-card.rose{border-top-color:#e11d48}.prfw-att-card:hover{box-shadow:0 4px 14px rgba(15,23,42,.08);transform:translateY(-1px)}
      .prfw-att-note{margin-top:12px;padding:9px 10px;border-radius:9px;background:#f8fafc;color:#64748b;font-size:10px;border:1px solid #edf2f7}
      @media(max-width:1100px){.prfw-attention-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.prfw-tabs{grid-template-columns:1fr}.prfw-tab{border-right:0;border-bottom:1px solid #e2e8f0}.prfw-tab:last-child{border-bottom:0}.prfw-attention-head{flex-direction:column}.prfw-attention-total{align-items:flex-start}.prfw-attention-grid{grid-template-columns:1fr}}
    `}</style>
  </>, host)
}
