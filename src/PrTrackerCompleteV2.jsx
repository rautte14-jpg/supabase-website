import { receiptTone, receiptStage, summarizeReceiptLines } from './lib/receipts.js'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import { maldivesDateIso, submissionDateIso, submissionWeekStart } from './lib/prSubmissionActivity'

const clean = (v) => String(v ?? '').trim()
const lower = (v) => clean(v).toLowerCase()
const CURRENT_YEAR = Number(maldivesDateIso().slice(0, 4))
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - i)
const PAGE_SIZE = 200

function parseDate(value) {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.valueOf())) return direct
  const text = clean(value)
  const m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i)
  if (!m) return null
  let [, month, day, year, hour, minute, second, meridiem] = m
  hour = Number(hour)
  if (meridiem.toLowerCase() === 'pm' && hour !== 12) hour += 12
  if (meridiem.toLowerCase() === 'am' && hour === 12) hour = 0
  const d = new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second))
  return Number.isNaN(d.valueOf()) ? null : d
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

function poNumber(row) {
  return clean(row?.po_no || rawField(row, ['PO Number', 'PO No', 'Purchase Order']))
}

function statusGroup(status) {
  const text = lower(status)
  if (text.includes('reject')) return 'REJECTED'
  if (text.includes('cancel')) return 'CANCELLED'
  if (text.includes('approv') || text.includes('complete')) return 'APPROVED'
  return 'IN_REVIEW'
}

function latestStage(detail, status, summary) {
  if (!detail) return 'Sync Pending'
  const po = Number(detail.po_count || 0)
  const rfq = Number(detail.rfq_count || 0)
  const group = statusGroup(status)
  const receiving = receiptStage(detail, summary)
  if (receiving) return receiving
  if (po > 0) return 'PO Stage'
  if (rfq > 0) return 'RFQ Stage'
  if (group === 'REJECTED') return 'Rejected'
  if (group === 'CANCELLED') return 'Cancelled'
  if (group === 'APPROVED') return 'Awaiting RFQ'
  return 'PR Approval'
}

function workflowDates(detail) {
  const dates = []
  for (const s of Array.isArray(detail?.pr_workflow) ? detail.pr_workflow : []) {
    const d = parseDate(s?.ApprovedDateTime || s?.ApprovedDate)
    if (d) dates.push(d)
  }
  for (const g of Array.isArray(detail?.po_workflow) ? detail.po_workflow : []) {
    for (const s of Array.isArray(g?.Workflow) ? g.Workflow : []) {
      const d = parseDate(s?.ApprovedDateTime || s?.ApprovedDate)
      if (d) dates.push(d)
    }
  }
  return dates
}

function stageStart(detail, header, stage) {
  if (/Received|Receipt/.test(stage)) {
    const dates = (Array.isArray(detail?.product_receipts) ? detail.product_receipts : []).map((r) => parseDate(r?.createdAt)).filter(Boolean)
    if (dates.length) return new Date(Math.max(...dates.map((d) => d.valueOf())))
  }
  const dates = workflowDates(detail)
  if (dates.length) return new Date(Math.max(...dates.map((d) => d.valueOf())))
  return parseDate(header?.created_at || header?.created_at_raw)
}

function daysSince(date) {
  if (!date) return null
  return Math.max(0, Math.floor((Date.now() - date.valueOf()) / 86400000))
}

function currentHolder(detail, stage) {
  if (!detail) return 'Sync pending'
  if (stage === 'PO Stage') {
    const approvers = (Array.isArray(detail.purchase_orders) ? detail.purchase_orders : []).flatMap((p) => Array.isArray(p?.PendingApprovers) ? p.PendingApprovers : clean(p?.PendingApprovers) ? [p.PendingApprovers] : []).map(clean).filter(Boolean)
    if (approvers.length) return [...new Set(approvers)].join(', ')
  }
  if (stage === 'PR Approval') return clean(detail.current_approver) || '—'
  if (['Fully Received', 'Rejected', 'Cancelled'].includes(stage)) return 'Completed'
  if (stage === 'Part Received') return 'Awaiting remaining receipt'
  if (stage === 'Receipt Needs Review') return 'Reconcile ERP receipt quantities'
  return clean(detail.current_approver) || '—'
}

function actualPoStatus(detail) {
  if (clean(detail?.po_status_text)) return clean(detail.po_status_text)
  const rows = Array.isArray(detail?.purchase_orders) ? detail.purchase_orders : []
  if (!rows.length) return Number(detail?.po_count || 0) > 0 ? `PO Created (${Number(detail.po_count || 0)})` : 'No PO Yet'
  const statuses = [...new Set(rows.map((p) => clean(p?.PurchStatus)).filter(Boolean))]
  return statuses.length ? statuses.join(' / ') : `PO Created (${rows.length})`
}

function summarizeLines(lines) {
  const { requested, received } = summarizeReceiptLines(lines)
  const poNos = new Set(lines.map(poNumber).filter(Boolean))
  let receipt = 'No ERP data'
  if (lines.length) {
    if (requested > 0 && received >= requested) receipt = `Fully Received (${received.toLocaleString()}/${requested.toLocaleString()})`
    else if (received > 0) receipt = `Part Received (${received.toLocaleString()}/${requested.toLocaleString()})`
    else receipt = requested > 0 ? `Not Received (0/${requested.toLocaleString()})` : 'Not Received'
  }
  return { requested, received, poNos, receipt }
}

function lifecycleMatches(detail, status, filter) {
  if (filter === 'ALL') return true
  if (!detail) return filter === 'SYNC_PENDING'
  const rfq = Number(detail.rfq_count || 0)
  const po = Number(detail.po_count || 0)
  const receipt = Number(detail.receipt_count || 0)
  const group = statusGroup(status)
  if (filter === 'PR_APPROVAL') return group === 'IN_REVIEW' && rfq === 0 && po === 0 && receipt === 0
  if (filter === 'NO_RFQ') return group === 'APPROVED' && rfq === 0
  if (filter === 'HAS_RFQ') return rfq > 0
  if (filter === 'NO_PO') return rfq > 0 && po === 0
  if (filter === 'HAS_PO') return po > 0
  if (filter === 'NO_RECEIPT') return po > 0 && receipt === 0
  if (filter === 'RECEIVED') return receipt > 0
  if (filter === 'PENDING_APPROVER') return Boolean(clean(detail.current_approver)) || (Array.isArray(detail.purchase_orders) && detail.purchase_orders.some((p) => Array.isArray(p?.PendingApprovers) ? p.PendingApprovers.length : clean(p?.PendingApprovers)))
  return false
}

const pillTone = receiptTone

function formatDate(value) {
  const d = parseDate(value)
  return d ? d.toLocaleString() : clean(value) || '—'
}

function exportRows(rows, year) {
  const headers = ['PR Number','PR Description','Submitted Date','Requested By','Site','ERP Status','Current Approver','Stage Age','Latest Stage','RFQ','PO Status','Receipt Progress','Data Check']
  const body = rows.map((r) => [r.pr,r.description,r.dateText,r.createdBy,r.site,r.status,r.holder,r.ageText,r.stage,r.rfqCount,r.poStatus,r.receipt,r.check])
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [headers, ...body].map((r) => r.map(esc).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = `SRD_PR_PO_Tracker_${year}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
}

function Pill({ children, tone = 'neutral' }) { return <span className={`prv2-pill ${tone}`}>{children}</span> }

export default function PrTrackerCompleteV2({ selectedYear = CURRENT_YEAR, onYearChange, submissionWeek = 'ALL', onSubmissionData, refreshKey = 0 }) {
  const [host, setHost] = useState(null)
  const [headers, setHeaders] = useState([])
  const [details, setDetails] = useState(new Map())
  const [lines, setLines] = useState(new Map())
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [lifecycleFilter, setLifecycleFilter] = useState('ALL')
  const [query, setQuery] = useState('')
  const weekFilter = submissionWeek !== 'ALL'
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)

  useEffect(() => {
    const el = document.getElementById('prpo-lifecycle-host')
    if (el) setHost(el)
  }, [])

  useEffect(() => {
    if (!host) return
    const id = window.setInterval(() => {
      const input = document.querySelector('input[placeholder*="Search PRF"]')
      const next = clean(input?.value)
      setQuery((old) => old === next ? old : next)
    }, 600)
    return () => window.clearInterval(id)
  }, [host, selectedYear])

  useEffect(() => {
    let active = true
    let inFlight = false
    async function load() {
      if (inFlight) return
      inFlight = true
      setLoading(true)
      setLoadError(false)
      onSubmissionData?.({ headers: [], loading: true, error: false })
      try {
        const start = `${selectedYear}-01-01T00:00:00+05:00`
        const end = `${selectedYear + 1}-01-01T00:00:00+05:00`
        const out = []
        let from = 0

        while (active) {
          const { data, error } = await supabase
            .from('pr_lifecycle_fast')
            .select('purch_req_id,description,created_at,created_at_raw,created_by,site,status,current_approver,current_workflow_status,rfq_count,po_count,receipt_count,detail_synced,line_count,requested_qty,received_qty,erp_po_count,po_status_text')
            .gte('created_at', start)
            .lt('created_at', end)
            .order('created_at', { ascending: false })
            .order('purch_req_id', { ascending: true })
            .range(from, from + 999)

          if (error) throw error
          out.push(...(data || []))
          if (!data || data.length < 1000) break
          from += 1000
        }

        if (!active) return

        const headerRows = []
        const detailMap = new Map()
        const lineMap = new Map()

        for (const row of out) {
          const pr = clean(row.purch_req_id).toUpperCase()
          if (!pr) continue
          headerRows.push({
            purch_req_id: row.purch_req_id,
            description: row.description,
            created_at: row.created_at,
            created_at_raw: row.created_at_raw,
            created_by: row.created_by,
            site: row.site,
            status: row.status,
          })
          if (row.detail_synced) {
            detailMap.set(pr, {
              purch_req_id: row.purch_req_id,
              current_approver: row.current_approver,
              current_workflow_status: row.current_workflow_status,
              rfq_count: row.rfq_count,
              po_count: row.po_count,
              receipt_count: row.receipt_count,
              po_status_text: row.po_status_text,
            })
          }
          if (Number(row.line_count || 0) > 0) {
            lineMap.set(pr, [{
              qty_requested: Number(row.requested_qty || 0),
              qty_received: Number(row.received_qty || 0),
              po_no: Number(row.erp_po_count || 0) > 0 ? '__AGGREGATED_PO__' : '',
            }])
          }
        }

        if (active) {
          setHeaders(headerRows)
          setDetails(detailMap)
          setLines(lineMap)
          setLoading(false)
          setPage(1)
          onSubmissionData?.({ headers: headerRows, loading: false, error: false })
        }
      } catch (error) {
        if (!active) return
        console.warn('Fast PR lifecycle load failed', error.message)
        setLoadError(true)
        setLoading(false)
        onSubmissionData?.({ headers: [], loading: false, error: true })
      } finally {
        inFlight = false
      }
    }

    load()
    const timer = window.setInterval(load, 120000)
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [selectedYear, refreshKey, onSubmissionData])

  useEffect(() => { setPage(1) }, [statusFilter, lifecycleFilter, query, submissionWeek, selectedYear])

  const rows = useMemo(() => headers.map((h) => {
    const pr = clean(h.purch_req_id).toUpperCase()
    const detail = details.get(pr)
    const lineSummary = summarizeLines(lines.get(pr) || [])
    const stage = latestStage(detail, h.status, lineSummary)
    const age = daysSince(stageStart(detail, h, stage))
    const simplixPo = Number(detail?.po_count || 0) > 0
    const erpPo = lineSummary.poNos.size > 0
    const simplixReceipt = Number(detail?.receipt_count || 0) > 0
    const erpReceipt = lineSummary.received > 0
    let check = 'Matched'
    if (!(lines.get(pr) || []).length) check = 'No ERP lines'
    else if (simplixPo !== erpPo || simplixReceipt !== erpReceipt) check = 'Needs Review'
    return {
      pr, description: clean(h.description) || '—', submissionWeek: submissionWeekStart(submissionDateIso(h)), dateText: formatDate(h.created_at_raw || h.created_at), createdBy: clean(h.created_by) || '—', site: clean(h.site) || '—', status: clean(h.status) || '—', detail,
      holder: currentHolder(detail, stage), age, ageText: age === null ? '—' : age === 0 ? 'Today' : `${age}d`, stage, rfqCount: detail ? Number(detail.rfq_count || 0) : '—', poStatus: detail ? actualPoStatus(detail) : 'Sync pending', receipt: lineSummary.receipt, check,
    }
  }), [headers, details, lines])

  const filteredRows = useMemo(() => {
    const q = lower(query)
    return rows.filter((r) => {
      if (statusFilter !== 'ALL' && statusGroup(r.status) !== statusFilter) return false
      if (!lifecycleMatches(r.detail, r.status, lifecycleFilter)) return false
      if (weekFilter && r.submissionWeek !== submissionWeek) return false
      if (q && !lower([r.pr,r.description,r.createdBy,r.site,r.status,r.holder,r.stage,r.poStatus,r.receipt].join(' ')).includes(q)) return false
      return true
    })
  }, [rows, statusFilter, lifecycleFilter, query, weekFilter, submissionWeek])

  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pages)
  const shown = loading || loadError ? [] : filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const summary = useMemo(() => ({ total: headers.length, synced: details.size, rfq: [...details.values()].filter((d) => Number(d.rfq_count || 0) > 0).length, po: [...details.values()].filter((d) => Number(d.po_count || 0) > 0).length, received: [...details.values()].filter((d) => Number(d.receipt_count || 0) > 0).length }), [headers, details])

  if (!host) return null
  return createPortal(<>
    <div className="prv2-toolbar">
      <div className="prv2-controls">
        <div className="prv2-row"><span className="prv2-label">YEAR</span><select value={selectedYear} onChange={(e) => onYearChange?.(Number(e.target.value))}>{YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}</select>{weekFilter && <span className="prv2-week">Weekly filter active</span>}</div>
        <div className="prv2-row"><span className="prv2-label">PR STATUS</span>{[['ALL','All'],['IN_REVIEW','In Review'],['APPROVED','Approved'],['REJECTED','Rejected'],['CANCELLED','Cancelled']].map(([v,t]) => <button key={v} className={statusFilter===v?'active':''} onClick={() => setStatusFilter(v)}>{t}</button>)}</div>
        <div className="prv2-row"><span className="prv2-label">LIFECYCLE</span>{[['ALL','All'],['PR_APPROVAL','PR Approval'],['NO_RFQ','No RFQ Yet'],['HAS_RFQ','RFQ Created'],['NO_PO','No PO Yet'],['HAS_PO','PO Created'],['NO_RECEIPT','No Receipt Yet'],['RECEIVED','Received'],['PENDING_APPROVER','Pending Approver'],['SYNC_PENDING','Sync Pending']].map(([v,t]) => <button key={v} className={lifecycleFilter===v?'active':''} onClick={() => setLifecycleFilter(v)}>{t}</button>)}</div>
      </div>
      <div className="prv2-right"><div>{loadError ? 'PR data unavailable' : loading ? 'Loading PR data…' : `${selectedYear}: ${summary.total.toLocaleString()} PRs · ${summary.synced.toLocaleString()} synced · ${summary.rfq.toLocaleString()} RFQ · ${summary.po.toLocaleString()} PO · ${summary.received.toLocaleString()} received`}</div><button className="export" disabled={loading || loadError} onClick={() => exportRows(filteredRows, selectedYear)}>Export visible CSV</button></div>
    </div>
    <div className="prv2-resultbar"><div>{loadError ? <strong role="alert">Unable to load PRs. Use Retry above.</strong> : loading ? <strong role="status">Loading PRs…</strong> : <><strong>{filteredRows.length.toLocaleString()}</strong> PRs shown{query ? ` · Search: “${query}”` : ''}</>}</div>{!loading && !loadError && pages > 1 && <div className="prv2-pages"><button disabled={safePage<=1} onClick={() => setPage((p)=>Math.max(1,p-1))}>Previous</button><span>Page {safePage} of {pages}</span><button disabled={safePage>=pages} onClick={() => setPage((p)=>Math.min(pages,p+1))}>Next</button></div>}</div>
    <div className="prv2-tablewrap"><table><thead><tr>{['PR Number','PR Description','Submitted Date','Requested By','Site','ERP Status','Current Approver','Stage Age','Latest Stage','RFQ','PO Status','Receipt Progress','Data Check'].map((h)=><th key={h}>{h}</th>)}</tr></thead><tbody>{shown.map((r)=><tr key={r.pr}>
      <td><strong>{r.pr}</strong></td><td>{r.description}</td><td>{r.dateText}</td><td>{r.createdBy}</td><td>{r.site}</td><td><Pill>{r.status}</Pill></td><td className="holder">{r.holder}</td><td><Pill tone={r.age===null?'neutral':r.age>=30?'bad':r.age>=14?'waiting':r.age>=7?'violet':'good'}>{r.ageText}</Pill></td><td><Pill tone={pillTone(r.stage)}>{r.stage}</Pill></td><td><Pill tone={Number(r.rfqCount)>0?'blue':'neutral'}>{r.rfqCount}</Pill></td><td><Pill tone={pillTone(r.poStatus)}>{r.poStatus}</Pill></td><td><Pill tone={pillTone(r.receipt)}>{r.receipt}</Pill></td><td><Pill tone={r.check==='Needs Review'?'bad':r.check==='Matched'?'good':'neutral'}>{r.check}</Pill></td>
    </tr>)}</tbody></table></div>
    <style>{`
      .prv2-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:12px 0;padding:11px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}.prv2-controls{display:flex;flex-direction:column;gap:8px}.prv2-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.prv2-label{font-size:10px;font-weight:800;letter-spacing:.08em;color:#64748b;min-width:68px}.prv2-row select{border:1px solid #cbd5e1;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700}.prv2-toolbar button,.prv2-pages button{border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer}.prv2-toolbar button.active{background:#0f172a;border-color:#0f172a;color:#fff}.prv2-right{display:flex;align-items:flex-end;gap:9px;flex-direction:column;font-size:11px;font-weight:700;color:#64748b}.prv2-right .export{border-radius:8px;color:#1d4ed8;border-color:#bfdbfe;background:#eff6ff}.prv2-week{font-size:10px;font-weight:700;color:#1d4ed8;background:#eff6ff;border-radius:999px;padding:4px 8px}.prv2-resultbar{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:10px 10px 0 0;font-size:11px;color:#334155}.prv2-pages{display:flex;align-items:center;gap:8px}.prv2-pages button:disabled{opacity:.4;cursor:not-allowed}.prv2-tablewrap{overflow:auto;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;background:#fff}.prv2-tablewrap table{width:100%;border-collapse:collapse;font-size:11px;min-width:1500px}.prv2-tablewrap th{padding:10px 11px;text-align:left;background:#f8fafc;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;border-bottom:1px solid #e2e8f0}.prv2-tablewrap td{padding:10px 11px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}.prv2-tablewrap tbody tr:hover{background:#f8fafc}.prv2-tablewrap .holder{font-weight:700;color:#0f172a}.prv2-pill{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap;background:#f1f5f9;color:#64748b}.prv2-pill.good{background:#dcfce7;color:#166534}.prv2-pill.bad{background:#fee2e2;color:#b91c1c}.prv2-pill.waiting{background:#fef3c7;color:#92400e}.prv2-pill.violet{background:#ede9fe;color:#6d28d9}.prv2-pill.blue{background:#dbeafe;color:#1d4ed8}@media(max-width:1100px){.prv2-toolbar{flex-direction:column}.prv2-right{align-items:flex-start}.prv2-resultbar{align-items:flex-start;gap:10px;flex-direction:column}}
    `}</style>
  </>, host)
}
