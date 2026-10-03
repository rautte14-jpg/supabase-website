import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const lower = (v) => clean(v).toLowerCase()
const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - i)

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

function daysSince(value) {
  const d = value instanceof Date ? value : parseDate(value)
  if (!d) return null
  return Math.max(0, Math.floor((Date.now() - d.valueOf()) / 86400000))
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
  if (/fully\s*receiv|completely\s*receiv|received|delivered/.test(text) && !/not\s*received|pending|partial|part\s*receiv/.test(text)) {
    return requestedQty(row)
  }
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

function workflowDates(detail) {
  const out = []
  const pr = Array.isArray(detail?.pr_workflow) ? detail.pr_workflow : []
  for (const step of pr) {
    const d = parseDate(step?.ApprovedDateTime || step?.ApprovedDate)
    if (d) out.push(d)
  }
  const poGroups = Array.isArray(detail?.po_workflow) ? detail.po_workflow : []
  for (const group of poGroups) {
    for (const step of Array.isArray(group?.Workflow) ? group.Workflow : []) {
      const d = parseDate(step?.ApprovedDateTime || step?.ApprovedDate)
      if (d) out.push(d)
    }
  }
  return out
}

function latestStage(detail, erpStatus) {
  if (!detail) return 'Sync Pending'
  const receipts = Number(detail.receipt_count || 0)
  const pos = Number(detail.po_count || 0)
  const rfqs = Number(detail.rfq_count || 0)
  const group = statusGroup(erpStatus)
  if (receipts > 0) return 'Received'
  if (pos > 0) return 'PO Stage'
  if (rfqs > 0) return 'RFQ Stage'
  if (group === 'REJECTED') return 'Rejected'
  if (group === 'CANCELLED') return 'Cancelled'
  if (group === 'APPROVED') return 'Awaiting RFQ'
  return 'PR Approval'
}

function latestMilestone(detail, header, stage) {
  if (stage === 'Received') {
    const receiptDates = (Array.isArray(detail?.product_receipts) ? detail.product_receipts : [])
      .map((r) => parseDate(r?.createdAt)).filter(Boolean)
    if (receiptDates.length) return new Date(Math.max(...receiptDates.map((d) => d.valueOf())))
  }
  const dates = workflowDates(detail)
  if (dates.length) return new Date(Math.max(...dates.map((d) => d.valueOf())))
  return parseDate(header?.created_at || header?.created_at_raw)
}

function poStatus(detail) {
  const rows = Array.isArray(detail?.purchase_orders) ? detail.purchase_orders : []
  if (!rows.length) return 'No PO Yet'
  const statuses = [...new Set(rows.map((r) => clean(r?.PurchStatus)).filter(Boolean))]
  return statuses.length ? statuses.join(' / ') : `PO Created (${rows.length})`
}

function currentHolder(detail, stage) {
  if (!detail) return 'Sync pending'
  if (stage === 'PO Stage') {
    const rows = Array.isArray(detail?.purchase_orders) ? detail.purchase_orders : []
    const approvers = rows.flatMap((r) => Array.isArray(r?.PendingApprovers) ? r.PendingApprovers : clean(r?.PendingApprovers) ? [r.PendingApprovers] : [])
      .map(clean).filter(Boolean)
    const unique = [...new Set(approvers)]
    if (unique.length) return unique.join(', ')
  }
  if (stage === 'PR Approval') return clean(detail?.current_approver) || '—'
  if (['Received', 'Rejected', 'Cancelled'].includes(stage)) return 'Completed'
  return clean(detail?.current_approver) || '—'
}

function summarizeLines(lines) {
  const requested = lines.reduce((sum, row) => sum + requestedQty(row), 0)
  const received = lines.reduce((sum, row) => sum + Math.min(requestedQty(row) || Number.MAX_SAFE_INTEGER, receivedQty(row)), 0)
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
  if (filter === 'SYNC_PENDING') return false
  return true
}

function badgeClass(kind) {
  if (/received|matched/i.test(kind)) return 'good'
  if (/review|not received|no po/i.test(kind)) return 'waiting'
  if (/part/i.test(kind)) return 'violet'
  if (/reject|cancel/i.test(kind)) return 'bad'
  return 'neutral'
}

function setBadge(cell, text, className = '') {
  let span = cell.firstElementChild
  if (!span || span.tagName !== 'SPAN') {
    cell.replaceChildren()
    span = document.createElement('span')
    cell.appendChild(span)
  }
  span.textContent = text
  span.className = className
}

function ensureCell(row, kind) {
  let cell = row.querySelector(`td[data-pr-complete="${kind}"]`)
  if (!cell) {
    cell = document.createElement('td')
    cell.dataset.prComplete = kind
    row.appendChild(cell)
  }
  return cell
}

function ensureHead(row, kind, label) {
  let th = row.querySelector(`th[data-pr-complete="${kind}"]`)
  if (!th) {
    th = document.createElement('th')
    th.dataset.prComplete = kind
    row.appendChild(th)
  }
  th.textContent = label
}

function findPrTable() {
  return [...document.querySelectorAll('table')].find((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((x) => lower(x.textContent))
    return heads.includes('pr number') && heads.includes('requested by') && heads.includes('erp status')
  }) || null
}

function updatePageLabels(year, count) {
  const formatted = Number(count || 0).toLocaleString()
  const leaves = [...document.querySelectorAll('body *')].filter((el) => el.children.length === 0)
  for (const el of leaves) {
    const text = lower(el.textContent)
    if (text.startsWith('simplix sync') && text.includes('prs')) el.textContent = `SIMPLIX SYNC · ${formatted} PRs · ${year}`
    if (text.startsWith('all submitted prs')) el.textContent = `All Submitted PRs (${year})`
  }
  for (const label of leaves.filter((el) => lower(el.textContent).startsWith('all submitted prs'))) {
    let box = label.parentElement
    for (let i = 0; box && i < 8; i += 1, box = box.parentElement) {
      const values = [...box.querySelectorAll('*')].filter((el) => el.children.length === 0)
      const number = values.find((el) => /^\d[\d,]*\s*PRs?$/i.test(clean(el.textContent)) || /^\d[\d,]*$/.test(clean(el.textContent)))
      if (number) {
        number.textContent = number.textContent.toLowerCase().includes('pr') ? `${formatted} PRs` : formatted
        break
      }
    }
  }
}

function exportVisibleCsv(table, year) {
  if (!table) return
  const heads = [...table.querySelectorAll('thead th')].map((x) => clean(x.textContent))
  const rows = [...table.querySelectorAll('tbody tr')].filter((r) => r.style.display !== 'none')
    .map((r) => [...r.querySelectorAll(':scope > td')].map((c) => clean(c.textContent)))
  const escape = (v) => `"${String(v).replace(/"/g, '""')}"`
  const csv = [heads, ...rows].map((r) => r.map(escape).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `SRD_PR_PO_Tracker_${year}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function PrTrackerComplete() {
  const [selectedYear, setSelectedYear] = useState(CURRENT_YEAR)
  const [headers, setHeaders] = useState(new Map())
  const [details, setDetails] = useState(new Map())
  const [lineMap, setLineMap] = useState(new Map())
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [lifecycleFilter, setLifecycleFilter] = useState('ALL')
  const [loading, setLoading] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const start = `${selectedYear}-01-01T00:00:00.000Z`
      const end = `${selectedYear + 1}-01-01T00:00:00.000Z`
      const headerMap = new Map()
      let from = 0
      const pageSize = 1000
      while (active) {
        const { data, error } = await supabase.from('erp_pr_headers')
          .select('purch_req_id,created_at,created_at_raw,status')
          .gte('created_at', start).lt('created_at', end)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1)
        if (error) { console.warn('PR headers load failed', error.message); break }
        for (const row of data || []) headerMap.set(clean(row.purch_req_id).toUpperCase(), row)
        if (!data || data.length < pageSize) break
        from += pageSize
      }
      if (!active) return

      const detailMap = new Map()
      const ids = [...headerMap.keys()]
      for (let i = 0; i < ids.length && active; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { data, error } = await supabase.from('erp_pr_details')
          .select('purch_req_id,current_approver,current_position,current_workflow_status,detail_synced_at,rfq_count,po_count,receipt_count,purchase_orders,pr_workflow,po_workflow,rfqs,product_receipts')
          .in('purch_req_id', chunk)
        if (error) { console.warn('PR details load failed', error.message); continue }
        for (const row of data || []) detailMap.set(clean(row.purch_req_id).toUpperCase(), row)
      }

      const linesMap = new Map()
      for (let i = 0; i < ids.length && active; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const { data, error } = await supabase.from('procurement_records')
          .select('pr_no,po_no,qty_requested,qty_received,status,delivery_status,raw_source')
          .eq('source_type', 'PR').in('pr_no', chunk)
        if (error) { console.warn('ERP PR lines load failed', error.message); continue }
        for (const row of data || []) {
          const pr = clean(row.pr_no).toUpperCase()
          if (!linesMap.has(pr)) linesMap.set(pr, [])
          linesMap.get(pr).push(row)
        }
      }

      if (active) {
        setHeaders(headerMap)
        setDetails(detailMap)
        setLineMap(linesMap)
        setLoading(false)
      }
    }
    load()
    timerRef.current = window.setInterval(load, 60000)
    return () => { active = false; if (timerRef.current) window.clearInterval(timerRef.current) }
  }, [selectedYear])

  const summary = useMemo(() => {
    const ds = [...details.values()]
    return {
      total: headers.size,
      synced: details.size,
      rfq: ds.filter((d) => Number(d.rfq_count || 0) > 0).length,
      po: ds.filter((d) => Number(d.po_count || 0) > 0).length,
      received: ds.filter((d) => Number(d.receipt_count || 0) > 0).length,
    }
  }, [headers, details])

  useEffect(() => {
    let disposed = false
    const enhance = () => {
      if (disposed) return
      updatePageLabels(selectedYear, summary.total)
      const table = findPrTable()
      if (!table) return
      const wrapper = table.closest('.data-table, .table-wrap, .overflow-x-auto') || table.parentElement
      if (!wrapper?.parentElement) return
      let toolbar = wrapper.parentElement.querySelector(':scope > .pr-complete-toolbar')
      if (!toolbar) {
        toolbar = document.createElement('div')
        toolbar.className = 'pr-complete-toolbar'
        const controls = document.createElement('div')
        controls.className = 'pr-complete-controls'

        const yearRow = document.createElement('div')
        yearRow.className = 'pr-complete-row'
        yearRow.innerHTML = '<span class="pr-complete-label">YEAR</span>'
        const select = document.createElement('select')
        select.className = 'pr-complete-year'
        YEAR_OPTIONS.forEach((year) => {
          const option = document.createElement('option')
          option.value = String(year)
          option.textContent = String(year)
          select.appendChild(option)
        })
        select.value = String(selectedYear)
        select.addEventListener('change', (e) => setSelectedYear(Number(e.target.value)))
        yearRow.appendChild(select)

        const makeFilters = (label, attr, values, setter) => {
          const row = document.createElement('div')
          row.className = 'pr-complete-row'
          const span = document.createElement('span')
          span.className = 'pr-complete-label'
          span.textContent = label
          row.appendChild(span)
          values.forEach(([value, text]) => {
            const btn = document.createElement('button')
            btn.type = 'button'
            btn.dataset[attr] = value
            btn.textContent = text
            btn.addEventListener('click', () => setter(value))
            row.appendChild(btn)
          })
          return row
        }

        controls.append(
          yearRow,
          makeFilters('PR STATUS', 'statusFilter', [['ALL','All'],['IN_REVIEW','In Review'],['APPROVED','Approved'],['REJECTED','Rejected'],['CANCELLED','Cancelled']], setStatusFilter),
          makeFilters('LIFECYCLE', 'lifecycleFilter', [['ALL','All'],['PR_APPROVAL','PR Approval'],['NO_RFQ','No RFQ Yet'],['HAS_RFQ','RFQ Created'],['NO_PO','No PO Yet'],['HAS_PO','PO Created'],['NO_RECEIPT','No Receipt Yet'],['RECEIVED','Received'],['PENDING_APPROVER','Pending Approver'],['SYNC_PENDING','Sync Pending']], setLifecycleFilter),
        )

        const right = document.createElement('div')
        right.className = 'pr-complete-right'
        const stat = document.createElement('div')
        stat.className = 'pr-complete-summary'
        const exportBtn = document.createElement('button')
        exportBtn.type = 'button'
        exportBtn.className = 'pr-complete-export'
        exportBtn.textContent = 'Export visible CSV'
        exportBtn.addEventListener('click', () => exportVisibleCsv(findPrTable(), selectedYear))
        right.append(stat, exportBtn)
        toolbar.append(controls, right)
        wrapper.parentElement.insertBefore(toolbar, wrapper)
      }

      const select = toolbar.querySelector('.pr-complete-year')
      if (select && select.value !== String(selectedYear)) select.value = String(selectedYear)
      toolbar.querySelectorAll('button[data-status-filter]').forEach((b) => b.classList.toggle('active', b.dataset.statusFilter === statusFilter))
      toolbar.querySelectorAll('button[data-lifecycle-filter]').forEach((b) => b.classList.toggle('active', b.dataset.lifecycleFilter === lifecycleFilter))
      const stat = toolbar.querySelector('.pr-complete-summary')
      if (stat) stat.textContent = `${loading ? 'Loading · ' : ''}${selectedYear}: ${summary.total.toLocaleString()} PRs · ${summary.synced.toLocaleString()} synced · ${summary.rfq.toLocaleString()} RFQ · ${summary.po.toLocaleString()} PO · ${summary.received.toLocaleString()} received`

      const head = table.querySelector('thead tr')
      if (!head) return
      ensureHead(head, 'holder', 'Current Approver')
      ensureHead(head, 'age', 'Stage Age')
      ensureHead(head, 'stage', 'Latest Stage')
      ensureHead(head, 'rfq', 'RFQ')
      ensureHead(head, 'po', 'PO Status')
      ensureHead(head, 'receipt', 'Receipt Progress')
      ensureHead(head, 'check', 'Data Check')

      const baseHeads = [...head.querySelectorAll('th:not([data-pr-complete])')].map((x) => lower(x.textContent))
      const prIndex = baseHeads.findIndex((x) => x === 'pr number')
      const statusIndex = baseHeads.findIndex((x) => x === 'erp status')
      if (prIndex < 0 || statusIndex < 0) return

      table.querySelectorAll('tbody tr').forEach((row) => {
        const baseCells = [...row.querySelectorAll(':scope > td:not([data-pr-complete])')]
        const pr = clean(baseCells[prIndex]?.textContent).replace(/\s+/g, '').toUpperCase()
        if (!/^PR\d+$/.test(pr)) return
        const header = headers.get(pr)
        const detail = details.get(pr)
        const erpStatus = clean(baseCells[statusIndex]?.textContent)
        const stage = latestStage(detail, erpStatus)
        const visible = headers.has(pr) && (statusFilter === 'ALL' || statusGroup(erpStatus) === statusFilter) && lifecycleMatches(detail, erpStatus, lifecycleFilter)
        row.style.display = visible ? '' : 'none'

        const lines = lineMap.get(pr) || []
        const lineSummary = summarizeLines(lines)
        const milestone = latestMilestone(detail, header, stage)
        const age = milestone ? daysSince(milestone) : null
        const holder = currentHolder(detail, stage)
        const rfqCount = Number(detail?.rfq_count || 0)
        const pStatus = detail ? poStatus(detail) : 'Sync pending'

        const simplixPo = Number(detail?.po_count || 0) > 0
        const erpPo = lineSummary.poNos.size > 0
        const simplixReceipt = Number(detail?.receipt_count || 0) > 0
        const erpReceipt = lineSummary.received > 0
        let check = 'Matched'
        if (!lines.length) check = 'No ERP lines'
        else if (simplixPo !== erpPo || simplixReceipt !== erpReceipt) check = 'Needs Review'

        setBadge(ensureCell(row, 'holder'), holder, holder === 'Sync pending' ? 'prc-muted' : 'prc-holder')
        setBadge(ensureCell(row, 'age'), age === null ? '—' : age === 0 ? 'Today' : `${age}d`, `prc-pill age-${age === null ? 'neutral' : age >= 30 ? 'danger' : age >= 14 ? 'warn' : age >= 7 ? 'watch' : 'fresh'}`)
        setBadge(ensureCell(row, 'stage'), stage, `prc-pill ${badgeClass(stage)}`)
        setBadge(ensureCell(row, 'rfq'), detail ? String(rfqCount) : '—', `prc-pill ${rfqCount > 0 ? 'blue' : 'neutral'}`)
        setBadge(ensureCell(row, 'po'), pStatus, `prc-pill ${badgeClass(pStatus)}`)
        setBadge(ensureCell(row, 'receipt'), lineSummary.receipt, `prc-pill ${badgeClass(lineSummary.receipt)}`)
        setBadge(ensureCell(row, 'check'), check, `prc-pill ${check === 'Needs Review' ? 'bad' : check === 'Matched' ? 'good' : 'neutral'}`)
      })
    }

    enhance()
    const id = window.setInterval(enhance, 1200)
    return () => { disposed = true; window.clearInterval(id) }
  }, [selectedYear, headers, details, lineMap, statusFilter, lifecycleFilter, summary, loading])

  return <style>{`
    .pr-complete-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:12px 0;padding:11px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .pr-complete-controls{display:flex;flex-direction:column;gap:8px;min-width:0}.pr-complete-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.pr-complete-label{font-size:10px;font-weight:800;letter-spacing:.08em;color:#64748b;min-width:68px}.pr-complete-year{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:5px 9px;font-size:11px;font-weight:700;color:#0f172a}.pr-complete-toolbar button{border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer}.pr-complete-toolbar button.active{background:#0f172a;border-color:#0f172a;color:#fff}.pr-complete-right{display:flex;align-items:flex-end;gap:10px;flex-direction:column}.pr-complete-summary{font-size:11px;font-weight:700;color:#64748b;white-space:nowrap}.pr-complete-export{border-radius:8px!important;color:#1d4ed8!important;border-color:#bfdbfe!important;background:#eff6ff!important}
    th[data-pr-complete]{white-space:nowrap}.prc-holder{font-size:11px;font-weight:700;color:#0f172a;white-space:nowrap}.prc-muted{font-size:10px;font-weight:700;color:#94a3b8;white-space:nowrap}.prc-pill{display:inline-flex;justify-content:center;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.prc-pill.good{background:#dcfce7;color:#166534}.prc-pill.waiting{background:#fef3c7;color:#92400e}.prc-pill.violet{background:#ede9fe;color:#6d28d9}.prc-pill.blue{background:#dbeafe;color:#1d4ed8}.prc-pill.bad{background:#fee2e2;color:#b91c1c}.prc-pill.neutral{background:#f1f5f9;color:#64748b}.prc-pill.age-fresh{background:#dcfce7;color:#166534}.prc-pill.age-watch{background:#fef9c3;color:#854d0e}.prc-pill.age-warn{background:#ffedd5;color:#9a3412}.prc-pill.age-danger{background:#fee2e2;color:#b91c1c}.prc-pill.age-neutral{background:#f1f5f9;color:#64748b}
    @media(max-width:1100px){.pr-complete-toolbar{flex-direction:column}.pr-complete-right{align-items:flex-start}.pr-complete-summary{white-space:normal}}
  `}</style>
}
