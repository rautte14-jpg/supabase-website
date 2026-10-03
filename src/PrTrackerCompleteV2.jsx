import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const lower = (v) => clean(v).toLowerCase()
const CURRENT_YEAR = new Date().getFullYear()
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

function numberValue(value) {
  if (value === null || value === undefined || clean(value) === '') return null
  const n = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function requestedQty(row) {
  const direct = numberValue(row?.qty_requested)
  if (direct !== null) return Math.max(0, direct)
  return Math.max(0, numberValue(rawField(row, ['Requested Qty', 'Request Qty', 'Quantity', 'PR Qty'])) || 0)
}

function receivedQty(row) {
  const direct = numberValue(row?.qty_received)
  if (direct !== null) return Math.max(0, direct)
  const raw = numberValue(rawField(row, ['Received Qty', 'Received Quantity', 'Receipt Qty', 'PO Received Qty', 'Delivered Qty']))
  if (raw !== null) return Math.max(0, raw)
  const text = lower([row?.status, row?.delivery_status, rawField(row, ['PO ERP Status', 'Receipt Status'])].filter(Boolean).join(' '))
  if (/fully\s*receiv|completely\s*receiv|received|delivered/.test(text) && !/not\s*received|pending|partial|part\s*receiv/.test(text)) return requestedQty(row)
  return 0
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

function latestStage(detail, status) {
  if (!detail) return 'Sync Pending'
  const receipt = Number(detail.receipt_count || 0)
  const po = Number(detail.po_count || 0)
  const rfq = Number(detail.rfq_count || 0)
  const group = statusGroup(status)
  if (receipt > 0) return 'Received'
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
  if (stage === 'Received') {
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
  if (['Received', 'Rejected', 'Cancelled'].includes(stage)) return 'Completed'
  return clean(detail.current_approver) || '—'
}

function actualPoStatus(detail) {
  const rows = Array.isArray(detail?.purchase_orders) ? detail.purchase_orders : []
  if (!rows.length) return 'No PO Yet'
  const statuses = [...new Set(rows.map((p) => clean(p?.PurchStatus)).filter(Boolean))]
  return statuses.length ? statuses.join(' / ') : `PO Created (${rows.length})`
}

function summarizeLines(lines) {
  const requested = lines.reduce((s, r) => s + requestedQty(r), 0)
  const received = lines.reduce((s, r) => s + Math.min(requestedQty(r) || Number.MAX_SAFE_INTEGER, receivedQty(r)), 0)
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

function pillTone(text) {
  if (/needs review|reject|cancel/i.test(text)) return 'bad'
  if (/fully received|received|matched/i.test(text)) return 'good'
  if (/part|rfq/i.test(text)) return 'violet'
  if (/no po|not received|approval|awaiting/i.test(text)) return 'waiting'
  if (/po stage|created/i.test(text)) return 'blue'
  return 'neutral'
}

function formatDate(value) {
  const d = parseDate(value)
  return d ? d.toLocaleString() : clean(value) || '—'
}

function monthNumber(name) {
  return { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 }[lower(name).slice(0,3)]
}

function readWeekFilter(year) {
  const marker = [...document.querySelectorAll('body *')].find((el) => el.children.length === 0 && lower(el.textContent) === 'submitted date filter')
  if (!marker?.parentElement) return null
  const text = clean(marker.parentElement.textContent)
  if (/all pr submission dates/i.test(text)) return null
  const m = text.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s*[–—-]\s*(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+)?(\d{1,2})/i)
  if (!m) return null
  const sm = monthNumber(m[1]); const sd = Number(m[2]); const em = monthNumber(m[3] || m[1]); const ed = Number(m[4])
  if (sm === undefined || em === undefined) return null
  const start = new Date(year, sm, sd, 0, 0, 0)
  let end = new Date(year, em, ed, 23, 59, 59)
  if (end < start) end = new Date(year + 1, em, ed, 23, 59, 59)
  return { start, end }
}

function updateLabels(year, count) {
  const formatted = Number(count || 0).toLocaleString()
  const leaves = [...document.querySelectorAll('body *')].filter((el) => el.children.length === 0)
  leaves.forEach((el) => {
    const text = lower(el.textContent)
    if (text.startsWith('simplix sync') && text.includes('prs')) el.textContent = `SIMPLIX SYNC · ${formatted} PRs · ${year}`
    if (text.startsWith('all submitted prs')) el.textContent = `All Submitted PRs (${year})`
  })
  for (const label of leaves.filter((el) => lower(el.textContent).startsWith('all submitted prs'))) {
    let box = label.parentElement
    for (let i = 0; box && i < 8; i += 1, box = box.parentElement) {
      const number = [...box.querySelectorAll('*')].find((el) => el.children.length === 0 && (/^\d[\d,]*\s*PRs?$/i.test(clean(el.textContent)) || /^\d[\d,]*$/.test(clean(el.textContent))))
      if (number) { number.textContent = /pr/i.test(number.textContent) ? `${formatted} PRs` : formatted; break }
    }
  }
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

export default function PrTrackerCompleteV2() {
  const [host, setHost] = useState(null)
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [headers, setHeaders] = useState([])
  const [details, setDetails] = useState(new Map())
  const [lines, setLines] = useState(new Map())
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [lifecycleFilter, setLifecycleFilter] = useState('ALL')
  const [query, setQuery] = useState('')
  const [weekFilter, setWeekFilter] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    let disposed = false
    const find = () => {
      if (disposed || host) return
      const table = [...document.querySelectorAll('table')].find((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((x) => lower(x.textContent))
        return heads.includes('pr number') && heads.includes('requested by') && heads.includes('erp status')
      })
      if (!table) return
      const wrapper = table.closest('.data-table, .table-wrap, .overflow-x-auto') || table.parentElement
      if (!wrapper?.parentElement) return
      const el = document.createElement('div')
      el.className = 'prv2-host'
      wrapper.parentElement.insertBefore(el, wrapper)
      wrapper.style.display = 'none'
      setHost(el)
    }
    find()
    const id = window.setInterval(find, 600)
    return () => { disposed = true; window.clearInterval(id) }
  }, [host])

  useEffect(() => {
    if (!host) return
    const id = window.setInterval(() => {
      const input = document.querySelector('input[placeholder*="Search PRF"]')
      const next = clean(input?.value)
      setQuery((old) => old === next ? old : next)
      const wf = readWeekFilter(selectedYear)
      setWeekFilter((old) => {
        const a = old ? `${old.start.valueOf()}-${old.end.valueOf()}` : ''
        const b = wf ? `${wf.start.valueOf()}-${wf.end.valueOf()}` : ''
        return a === b ? old : wf
      })
    }, 600)
    return () => window.clearInterval(id)
  }, [host, selectedYear])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const start = `${selectedYear}-01-01T00:00:00.000Z`
      const end = `${selectedYear + 1}-01-01T00:00:00.000Z`
      const headerRows = []
      let from = 0
      while (active) {
        const { data, error } = await supabase.from('erp_pr_headers')
          .select('purch_req_id,description,created_at,created_at_raw,created_by,site,status')
          .gte('created_at', start).lt('created_at', end).order('created_at', { ascending: false }).range(from, from + 999)
        if (error) { console.warn('PR headers load failed', error.message); break }
        headerRows.push(...(data || []))
        if (!data || data.length < 1000) break
        from += 1000
      }
      if (!active) return
      const ids = headerRows.map((r) => clean(r.purch_req_id).toUpperCase()).filter(Boolean)
      const detailMap = new Map(); const lineMap = new Map()
      for (let i = 0; i < ids.length && active; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { data, error } = await supabase.from('erp_pr_details')
          .select('purch_req_id,current_approver,rfq_count,po_count,receipt_count,purchase_orders,pr_workflow,po_workflow,product_receipts').in('purch_req_id', chunk)
        if (!error) for (const row of data || []) detailMap.set(clean(row.purch_req_id).toUpperCase(), row)
      }
      for (let i = 0; i < ids.length && active; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { data, error } = await supabase.from('procurement_records').select('pr_no,po_no,qty_requested,qty_received,status,delivery_status,raw_source').eq('source_type','PR').in('pr_no', chunk)
        if (!error) for (const row of data || []) { const pr = clean(row.pr_no).toUpperCase(); if (!lineMap.has(pr)) lineMap.set(pr, []); lineMap.get(pr).push(row) }
      }
      if (active) { setHeaders(headerRows); setDetails(detailMap); setLines(lineMap); setLoading(false); setPage(1) }
    }
    load()
    timerRef.current = window.setInterval(load, 60000)
    return () => { active = false; if (timerRef.current) window.clearInterval(timerRef.current) }
  }, [selectedYear])

  useEffect(() => { updateLabels(selectedYear, headers.length) }, [selectedYear, headers.length])
  useEffect(() => { setPage(1) }, [statusFilter, lifecycleFilter, query, weekFilter, selectedYear])

  const rows = useMemo(() => headers.map((h) => {
    const pr = clean(h.purch_req_id).toUpperCase()
    const detail = details.get(pr)
    const lineSummary = summarizeLines(lines.get(pr) || [])
    const stage = latestStage(detail, h.status)
    const age = daysSince(stageStart(detail, h, stage))
    const simplixPo = Number(detail?.po_count || 0) > 0
    const erpPo = lineSummary.poNos.size > 0
    const simplixReceipt = Number(detail?.receipt_count || 0) > 0
    const erpReceipt = lineSummary.received > 0
    let check = 'Matched'
    if (!(lines.get(pr) || []).length) check = 'No ERP lines'
    else if (simplixPo !== erpPo || simplixReceipt !== erpReceipt) check = 'Needs Review'
    return {
      pr, description: clean(h.description) || '—', date: parseDate(h.created_at || h.created_at_raw), dateText: formatDate(h.created_at_raw || h.created_at), createdBy: clean(h.created_by) || '—', site: clean(h.site) || '—', status: clean(h.status) || '—', detail,
      holder: currentHolder(detail, stage), age, ageText: age === null ? '—' : age === 0 ? 'Today' : `${age}d`, stage, rfqCount: detail ? Number(detail.rfq_count || 0) : '—', poStatus: detail ? actualPoStatus(detail) : 'Sync pending', receipt: lineSummary.receipt, check,
    }
  }), [headers, details, lines])

  const filteredRows = useMemo(() => {
    const q = lower(query)
    return rows.filter((r) => {
      if (statusFilter !== 'ALL' && statusGroup(r.status) !== statusFilter) return false
      if (!lifecycleMatches(r.detail, r.status, lifecycleFilter)) return false
      if (weekFilter && (!r.date || r.date < weekFilter.start || r.date > weekFilter.end)) return false
      if (q && !lower([r.pr,r.description,r.createdBy,r.site,r.status,r.holder,r.stage,r.poStatus,r.receipt].join(' ')).includes(q)) return false
      return true
    })
  }, [rows, statusFilter, lifecycleFilter, query, weekFilter])

  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE))
  const safePage = Math.min(page, pages)
  const shown = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const summary = useMemo(() => ({ total: headers.length, synced: details.size, rfq: [...details.values()].filter((d) => Number(d.rfq_count || 0) > 0).length, po: [...details.values()].filter((d) => Number(d.po_count || 0) > 0).length, received: [...details.values()].filter((d) => Number(d.receipt_count || 0) > 0).length }), [headers, details])

  if (!host) return null
  return createPortal(<>
    <div className="prv2-toolbar">
      <div className="prv2-controls">
        <div className="prv2-row"><span className="prv2-label">YEAR</span><select value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>{YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}</select>{weekFilter && <span className="prv2-week">Weekly filter active</span>}</div>
        <div className="prv2-row"><span className="prv2-label">PR STATUS</span>{[['ALL','All'],['IN_REVIEW','In Review'],['APPROVED','Approved'],['REJECTED','Rejected'],['CANCELLED','Cancelled']].map(([v,t]) => <button key={v} className={statusFilter===v?'active':''} onClick={() => setStatusFilter(v)}>{t}</button>)}</div>
        <div className="prv2-row"><span className="prv2-label">LIFECYCLE</span>{[['ALL','All'],['PR_APPROVAL','PR Approval'],['NO_RFQ','No RFQ Yet'],['HAS_RFQ','RFQ Created'],['NO_PO','No PO Yet'],['HAS_PO','PO Created'],['NO_RECEIPT','No Receipt Yet'],['RECEIVED','Received'],['PENDING_APPROVER','Pending Approver'],['SYNC_PENDING','Sync Pending']].map(([v,t]) => <button key={v} className={lifecycleFilter===v?'active':''} onClick={() => setLifecycleFilter(v)}>{t}</button>)}</div>
      </div>
      <div className="prv2-right"><div>{loading ? 'Loading · ' : ''}{selectedYear}: {summary.total.toLocaleString()} PRs · {summary.synced.toLocaleString()} synced · {summary.rfq.toLocaleString()} RFQ · {summary.po.toLocaleString()} PO · {summary.received.toLocaleString()} received</div><button className="export" onClick={() => exportRows(filteredRows, selectedYear)}>Export visible CSV</button></div>
    </div>
    <div className="prv2-resultbar"><div><strong>{filteredRows.length.toLocaleString()}</strong> PRs shown{query ? ` · Search: “${query}”` : ''}</div>{pages > 1 && <div className="prv2-pages"><button disabled={safePage<=1} onClick={() => setPage((p)=>Math.max(1,p-1))}>Previous</button><span>Page {safePage} of {pages}</span><button disabled={safePage>=pages} onClick={() => setPage((p)=>Math.min(pages,p+1))}>Next</button></div>}</div>
    <div className="prv2-tablewrap"><table><thead><tr>{['PR Number','PR Description','Submitted Date','Requested By','Site','ERP Status','Current Approver','Stage Age','Latest Stage','RFQ','PO Status','Receipt Progress','Data Check'].map((h)=><th key={h}>{h}</th>)}</tr></thead><tbody>{shown.map((r)=><tr key={r.pr}>
      <td><strong>{r.pr}</strong></td><td>{r.description}</td><td>{r.dateText}</td><td>{r.createdBy}</td><td>{r.site}</td><td><Pill>{r.status}</Pill></td><td className="holder">{r.holder}</td><td><Pill tone={r.age===null?'neutral':r.age>=30?'bad':r.age>=14?'waiting':r.age>=7?'violet':'good'}>{r.ageText}</Pill></td><td><Pill tone={pillTone(r.stage)}>{r.stage}</Pill></td><td><Pill tone={Number(r.rfqCount)>0?'blue':'neutral'}>{r.rfqCount}</Pill></td><td><Pill tone={pillTone(r.poStatus)}>{r.poStatus}</Pill></td><td><Pill tone={pillTone(r.receipt)}>{r.receipt}</Pill></td><td><Pill tone={r.check==='Needs Review'?'bad':r.check==='Matched'?'good':'neutral'}>{r.check}</Pill></td>
    </tr>)}</tbody></table></div>
    <style>{`
      .prv2-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:12px 0;padding:11px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff}.prv2-controls{display:flex;flex-direction:column;gap:8px}.prv2-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.prv2-label{font-size:10px;font-weight:800;letter-spacing:.08em;color:#64748b;min-width:68px}.prv2-row select{border:1px solid #cbd5e1;border-radius:8px;padding:5px 9px;font-size:11px;font-weight:700}.prv2-toolbar button,.prv2-pages button{border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer}.prv2-toolbar button.active{background:#0f172a;border-color:#0f172a;color:#fff}.prv2-right{display:flex;align-items:flex-end;gap:9px;flex-direction:column;font-size:11px;font-weight:700;color:#64748b}.prv2-right .export{border-radius:8px;color:#1d4ed8;border-color:#bfdbfe;background:#eff6ff}.prv2-week{font-size:10px;font-weight:700;color:#1d4ed8;background:#eff6ff;border-radius:999px;padding:4px 8px}.prv2-resultbar{display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:10px 10px 0 0;font-size:11px;color:#334155}.prv2-pages{display:flex;align-items:center;gap:8px}.prv2-pages button:disabled{opacity:.4;cursor:not-allowed}.prv2-tablewrap{overflow:auto;border:1px solid #e2e8f0;border-radius:0 0 12px 12px;background:#fff}.prv2-tablewrap table{width:100%;border-collapse:collapse;font-size:11px;min-width:1500px}.prv2-tablewrap th{padding:10px 11px;text-align:left;background:#f8fafc;color:#64748b;font-size:10px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;border-bottom:1px solid #e2e8f0}.prv2-tablewrap td{padding:10px 11px;border-bottom:1px solid #f1f5f9;color:#334155;vertical-align:middle}.prv2-tablewrap tbody tr:hover{background:#f8fafc}.prv2-tablewrap .holder{font-weight:700;color:#0f172a}.prv2-pill{display:inline-flex;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap;background:#f1f5f9;color:#64748b}.prv2-pill.good{background:#dcfce7;color:#166534}.prv2-pill.bad{background:#fee2e2;color:#b91c1c}.prv2-pill.waiting{background:#fef3c7;color:#92400e}.prv2-pill.violet{background:#ede9fe;color:#6d28d9}.prv2-pill.blue{background:#dbeafe;color:#1d4ed8}@media(max-width:1100px){.prv2-toolbar{flex-direction:column}.prv2-right{align-items:flex-start}.prv2-resultbar{align-items:flex-start;gap:10px;flex-direction:column}}
    `}</style>
  </>, host)
}
