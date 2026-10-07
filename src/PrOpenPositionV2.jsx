import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const lower = (v) => clean(v).toLowerCase()
const YEAR = new Date().getFullYear()

function parseDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.valueOf()) ? null : d
}

function ageDays(value) {
  const d = parseDate(value)
  return d ? Math.max(0, Math.floor((Date.now() - d.valueOf()) / 86400000)) : null
}

function statusGroup(status) {
  const s = lower(status)
  if (s.includes('reject')) return 'REJECTED'
  if (s.includes('cancel')) return 'CANCELLED'
  if (s.includes('approv') || s.includes('complete')) return 'APPROVED'
  return 'IN_REVIEW'
}

function num(value) {
  if (value === null || value === undefined || clean(value) === '') return 0
  const n = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function rawField(row, names) {
  const raw = row?.raw_source
  if (!raw || typeof raw !== 'object') return ''
  const entries = Object.entries(raw)
  for (const name of names) {
    const wanted = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '')
    const hit = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, '') === wanted)
    if (hit && clean(hit[1])) return hit[1]
  }
  return ''
}

function requestedQty(row) {
  return Math.max(0, num(row?.qty_requested || rawField(row, ['Quantity','Requested Qty','PR Qty'])))
}

function receivedQty(row) {
  const direct = row?.qty_received
  if (direct !== null && direct !== undefined && clean(direct) !== '') return Math.max(0, num(direct))
  const raw = rawField(row, ['Received Qty','Received Quantity','Receipt Qty','Delivered Qty'])
  if (clean(raw)) return Math.max(0, num(raw))
  const s = lower([row?.status, row?.delivery_status, rawField(row, ['PO ERP Status','Receipt Status'])].filter(Boolean).join(' '))
  if (/fully\s*receiv|completed|delivered|received/.test(s) && !/not\s*received|partial|part\s*receiv|pending/.test(s)) return requestedQty(row)
  return 0
}

function isUrgent(row) {
  return /(urgent|critical|high)/i.test(clean(row?.priority || rawField(row, ['Priority'])))
}

function isClosedLine(row) {
  const s = lower([row?.status, row?.delivery_status, rawField(row, ['PO ERP Status'])].filter(Boolean).join(' '))
  return /(cancel|reject|closed|fully received|completed)/.test(s) || (requestedQty(row) > 0 && receivedQty(row) >= requestedQty(row))
}

function MetricCard({ label, value, helper, tone, onClick, badge }) {
  return (
    <button type="button" className={`opv2-card ${tone || ''}`} onClick={onClick}>
      <div className="opv2-card-top">
        <span>{label}</span>
        {badge ? <em>{badge}</em> : null}
      </div>
      <strong>{Number(value || 0).toLocaleString()}</strong>
      <p>{helper}</p>
      <span className="opv2-open">View details →</span>
    </button>
  )
}

function DetailPanel({ selection, onClose }) {
  if (!selection) return null
  const rows = selection.rows || []
  return (
    <div className="opv2-detail">
      <div className="opv2-detail-head">
        <div>
          <span className="opv2-kicker">DETAIL VIEW</span>
          <h4>{selection.title}</h4>
          <p>{selection.subtitle}</p>
        </div>
        <button type="button" onClick={onClose}>Close</button>
      </div>
      <div className="opv2-table-wrap">
        <table>
          <thead>
            <tr>{selection.columns.map((c) => <th key={c.key}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {rows.slice(0, 150).map((row, i) => (
              <tr key={`${row.pr || row.purch_req_id || 'row'}-${i}`}>
                {selection.columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : (clean(row[c.key]) || '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 150 ? <div className="opv2-more">Showing first 150 of {rows.length.toLocaleString()} records.</div> : null}
    </div>
  )
}

export default function PrOpenPositionV2() {
  const [host, setHost] = useState(null)
  const [headers, setHeaders] = useState([])
  const [details, setDetails] = useState(new Map())
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [selection, setSelection] = useState(null)

  useEffect(() => {
    let disposed = false
    const find = () => {
      if (disposed || host) return
      const eyebrow = [...document.querySelectorAll('.eyebrow, body *')].find((el) =>
        el.children.length === 0 && clean(el.textContent).toUpperCase().includes('02 · CURRENT OPEN POSITION')
      )
      const section = eyebrow?.closest('section')
      if (!section?.parentElement) return
      const el = document.createElement('div')
      el.className = 'opv2-host'
      section.parentElement.insertBefore(el, section)
      section.style.display = 'none'
      setHost(el)
    }
    find()
    const id = window.setInterval(find, 600)
    return () => { disposed = true; window.clearInterval(id) }
  }, [host])

  useEffect(() => {
    if (!host) return
    let active = true

    async function load() {
      setLoading(true)
      const start = `${YEAR}-01-01T00:00:00.000Z`
      const end = `${YEAR + 1}-01-01T00:00:00.000Z`

      const [lifecycleResult, urgentResult] = await Promise.all([
        supabase
          .from('pr_lifecycle_fast')
          .select('purch_req_id,description,created_at,created_at_raw,created_by,status,site,current_approver,current_workflow_status,rfq_count,po_count,receipt_count,detail_synced')
          .gte('created_at', start)
          .lt('created_at', end)
          .order('created_at', { ascending: false }),
        supabase
          .from('procurement_records')
          .select('pr_no,po_no,priority,item_code,item_description,qty_requested,qty_received,unit,status,delivery_status,raw_source')
          .eq('source_type','PR')
          .or('priority.ilike.%urgent%,priority.ilike.%critical%,priority.ilike.%high%')
          .limit(400),
      ])

      if (!active) return
      if (lifecycleResult.error) {
        console.warn('PR open-position lifecycle load failed', lifecycleResult.error.message)
        setLoading(false)
        return
      }

      const headerRows = []
      const detailMap = new Map()
      for (const row of lifecycleResult.data || []) {
        const pr = clean(row.purch_req_id).toUpperCase()
        headerRows.push({
          purch_req_id: row.purch_req_id,
          description: row.description,
          created_at: row.created_at,
          created_at_raw: row.created_at_raw,
          created_by: row.created_by,
          status: row.status,
          site: row.site,
        })
        if (row.detail_synced) {
          detailMap.set(pr, {
            purch_req_id: row.purch_req_id,
            current_approver: row.current_approver,
            current_workflow_status: row.current_workflow_status,
            rfq_count: row.rfq_count,
            po_count: row.po_count,
            receipt_count: row.receipt_count,
          })
        }
      }

      setHeaders(headerRows)
      setDetails(detailMap)
      setLines(urgentResult.error ? [] : (urgentResult.data || []))
      setLoading(false)
    }

    load()
    const id = window.setInterval(load, 120000)
    return () => {
      active = false
      window.clearInterval(id)
    }
  }, [host])

  const model = useMemo(() => {
    const headerMap = new Map(headers.map((h) => [clean(h.purch_req_id).toUpperCase(), h]))
    const linesByPr = new Map()
    for (const line of lines) {
      const pr = clean(line.pr_no).toUpperCase()
      if (!pr) continue
      if (!linesByPr.has(pr)) linesByPr.set(pr, [])
      linesByPr.get(pr).push(line)
    }

    const pendingApproval = []
    const awaitingRfq = []
    const rfqNoPo = []
    const poNoReceipt = []
    const syncPending = []

    for (const h of headers) {
      const pr = clean(h.purch_req_id).toUpperCase()
      const d = details.get(pr)
      const group = statusGroup(h.status)
      const rfq = Number(d?.rfq_count || 0)
      const po = Number(d?.po_count || 0)
      const receipt = Number(d?.receipt_count || 0)
      const age = ageDays(h.created_at || h.created_at_raw)
      const common = { ...h, pr, detail: d, age }
      if (!d) syncPending.push(common)
      if (group === 'IN_REVIEW' && rfq === 0 && po === 0 && receipt === 0) pendingApproval.push(common)
      if (group === 'APPROVED' && rfq === 0) awaitingRfq.push(common)
      if (rfq > 0 && po === 0) rfqNoPo.push(common)
      if (po > 0 && receipt === 0) poNoReceipt.push(common)
    }

    const urgentLines = lines.filter((r) => isUrgent(r) && !isClosedLine(r)).map((r) => {
      const pr = clean(r.pr_no).toUpperCase()
      const req = requestedQty(r)
      const rec = receivedQty(r)
      return { ...r, pr, openQty: Math.max(0, req - rec), header: headerMap.get(pr) }
    })

    return {
      pendingApproval,
      awaitingRfq,
      rfqNoPo,
      poNoReceipt,
      urgentLines,
      syncPending,
      approval7: pendingApproval.filter((r) => (r.age ?? 0) >= 7).length,
      approval14: pendingApproval.filter((r) => (r.age ?? 0) >= 14).length,
      po14: poNoReceipt.filter((r) => (r.age ?? 0) >= 14).length,
      synced: headers.filter((h) => details.has(clean(h.purch_req_id).toUpperCase())).length,
      linesByPr,
    }
  }, [headers, details, lines])

  if (!host) return null

  const prColumns = [
    { key: 'pr', label: 'PR Number' },
    { key: 'description', label: 'Description' },
    { key: 'created_at', label: 'Submitted', render: (r) => parseDate(r.created_at || r.created_at_raw)?.toLocaleDateString() || '—' },
    { key: 'age', label: 'Age', render: (r) => r.age == null ? '—' : `${r.age}d` },
    { key: 'current', label: 'Current Position', render: (r) => clean(r.detail?.current_approver) || clean(r.detail?.current_workflow_status) || '—' },
  ]

  const urgentColumns = [
    { key: 'pr', label: 'PR Number' },
    { key: 'priority', label: 'Priority' },
    { key: 'item_code', label: 'Item ID' },
    { key: 'item_description', label: 'Item Description' },
    { key: 'openQty', label: 'Open Qty', render: (r) => Number(r.openQty || 0).toLocaleString() },
    { key: 'unit', label: 'UOM' },
  ]

  const cards = [
    {
      label: 'PR Approval Pending', value: model.pendingApproval.length, tone: 'amber',
      helper: `${model.approval7} pending 7+ days · ${model.approval14} pending 14+ days`,
      rows: model.pendingApproval, title: 'PR Approval Pending', subtitle: 'PRs still waiting within the PR approval workflow.', columns: prColumns,
    },
    {
      label: 'Approved · No RFQ Yet', value: model.awaitingRfq.length, tone: 'violet',
      helper: 'Approved PRs where an RFQ has not yet been created',
      rows: model.awaitingRfq, title: 'Approved PRs Awaiting RFQ', subtitle: 'Approved PRs with no RFQ recorded in Simplix.', columns: prColumns,
    },
    {
      label: 'RFQ · No PO Yet', value: model.rfqNoPo.length, tone: 'blue',
      helper: 'RFQ exists but a purchase order has not yet been created',
      rows: model.rfqNoPo, title: 'RFQs Awaiting Purchase Order', subtitle: 'PRs that have reached RFQ stage but have no PO.', columns: prColumns,
    },
    {
      label: 'PO · No Receipt Yet', value: model.poNoReceipt.length, tone: 'orange',
      helper: `${model.po14} have been open for 14+ days from PR submission`,
      rows: model.poNoReceipt, title: 'Purchase Orders Awaiting Receipt', subtitle: 'PRs with a PO in Simplix but no product receipt yet.', columns: prColumns,
    },
    {
      label: 'Urgent Open Item Lines', value: model.urgentLines.length, tone: 'red',
      helper: 'Urgent / critical / high-priority item lines still not fully received',
      rows: model.urgentLines, title: 'Urgent Open Item Lines', subtitle: 'Priority item lines still requiring procurement or receipt follow-up.', columns: urgentColumns,
    },
    {
      label: 'Sync Pending', value: model.syncPending.length, tone: 'slate',
      helper: `${model.synced.toLocaleString()} of ${headers.length.toLocaleString()} ${YEAR} PRs have detail sync`,
      rows: model.syncPending, title: 'PR Detail Sync Pending', subtitle: 'Current-year PR headers that do not yet have workflow/detail data.', columns: prColumns,
    },
  ]

  return createPortal(
    <section className="opv2-section">
      <div className="opv2-title">
        <div>
          <span className="opv2-kicker">02 · OPERATIONAL ATTENTION</span>
          <h3>What needs action now?</h3>
          <p>Live {YEAR} procurement exceptions, grouped by where the PR is currently waiting.</p>
        </div>
        <div className="opv2-summary">
          <span>{headers.length.toLocaleString()} PRs</span>
          <span>{model.synced.toLocaleString()} synced</span>
          <span>{loading ? 'Refreshing…' : 'Live position'}</span>
        </div>
      </div>

      <div className="opv2-grid">
        {cards.map((c) => (
          <MetricCard key={c.label} {...c} onClick={() => setSelection({ title: c.title, subtitle: c.subtitle, rows: c.rows, columns: c.columns })} />
        ))}
      </div>

      <DetailPanel selection={selection} onClose={() => setSelection(null)} />

      <style>{`
        .opv2-section{margin-top:20px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px 18px 16px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
        .opv2-title{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}.opv2-kicker{font-size:10px;font-weight:800;letter-spacing:.11em;color:#1d4ed8}.opv2-title h3{margin:6px 0 4px;font-size:18px;color:#0f172a}.opv2-title p{margin:0;font-size:12px;color:#64748b}.opv2-summary{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.opv2-summary span{border:1px solid #dbe5f0;background:#f8fafc;border-radius:999px;padding:5px 9px;font-size:10px;font-weight:700;color:#475569;white-space:nowrap}
        .opv2-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.opv2-card{text-align:left;border:1px solid #e2e8f0;border-radius:12px;background:#fff;padding:14px 14px 12px;cursor:pointer;min-height:120px;transition:.15s ease;box-shadow:0 1px 2px rgba(15,23,42,.03)}.opv2-card:hover{transform:translateY(-1px);box-shadow:0 5px 16px rgba(15,23,42,.08)}.opv2-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.opv2-card-top>span{font-size:10px;font-weight:800;letter-spacing:.055em;text-transform:uppercase;color:#64748b}.opv2-card strong{display:block;font-size:24px;line-height:1;margin:14px 0 7px;color:#0f172a}.opv2-card p{margin:0;min-height:30px;font-size:11px;line-height:1.35;color:#64748b}.opv2-open{display:block;margin-top:9px;font-size:10px;font-weight:800;color:#2563eb}.opv2-card.amber{border-top:3px solid #f59e0b}.opv2-card.violet{border-top:3px solid #8b5cf6}.opv2-card.blue{border-top:3px solid #3b82f6}.opv2-card.orange{border-top:3px solid #f97316}.opv2-card.red{border-top:3px solid #ef4444}.opv2-card.slate{border-top:3px solid #64748b}
        .opv2-detail{margin-top:14px;border:1px solid #dbe5f0;border-radius:12px;overflow:hidden;background:#fff}.opv2-detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding:14px 16px;border-bottom:1px solid #e2e8f0;background:#f8fafc}.opv2-detail-head h4{margin:4px 0 2px;font-size:15px;color:#0f172a}.opv2-detail-head p{margin:0;font-size:11px;color:#64748b}.opv2-detail-head button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:6px 10px;font-size:11px;font-weight:700;color:#475569;cursor:pointer}.opv2-table-wrap{overflow:auto;max-height:420px}.opv2-table-wrap table{width:100%;border-collapse:collapse;font-size:11px}.opv2-table-wrap th{position:sticky;top:0;background:#f8fafc;text-align:left;padding:9px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:9px;letter-spacing:.05em;text-transform:uppercase;z-index:1}.opv2-table-wrap td{padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:top}.opv2-more{padding:8px 12px;font-size:10px;color:#64748b;background:#f8fafc}
        @media(max-width:1100px){.opv2-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){.opv2-title{flex-direction:column}.opv2-summary{justify-content:flex-start}.opv2-grid{grid-template-columns:1fr}}
      `}</style>
    </section>,
    host,
  )
}
