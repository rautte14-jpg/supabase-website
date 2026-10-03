import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const lower = (v) => clean(v).toLowerCase()

function parseSimplixDate(value) {
  if (!value) return null
  const direct = new Date(value)
  if (!Number.isNaN(direct.valueOf())) return direct
  const text = clean(value)
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i)
  if (!match) return null
  let [, month, day, year, hour, minute, second, meridiem] = match
  hour = Number(hour)
  if (meridiem.toLowerCase() === 'pm' && hour !== 12) hour += 12
  if (meridiem.toLowerCase() === 'am' && hour === 12) hour = 0
  const date = new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second))
  return Number.isNaN(date.valueOf()) ? null : date
}

function daysSince(value) {
  const date = parseSimplixDate(value)
  if (!date) return null
  return Math.max(0, Math.floor((Date.now() - date.valueOf()) / 86400000))
}

function statusGroup(status) {
  const text = lower(status)
  if (text.includes('reject')) return 'REJECTED'
  if (text.includes('cancel')) return 'CANCELLED'
  if (text.includes('approv') || text.includes('complete')) return 'APPROVED'
  return 'IN_REVIEW'
}

function ageTone(days) {
  if (days == null) return 'neutral'
  if (days >= 30) return 'danger'
  if (days >= 14) return 'warn'
  if (days >= 7) return 'watch'
  return 'fresh'
}

function findPrTable() {
  return [...document.querySelectorAll('table')].find((table) => {
    const heads = [...table.querySelectorAll('thead th')].map((x) => lower(x.textContent))
    return heads.includes('pr number') && heads.includes('requested by') && heads.includes('erp status')
  }) || null
}

function ensureCell(row, kind) {
  let cell = row.querySelector(`td[data-pr-enhancer="${kind}"]`)
  if (!cell) {
    cell = document.createElement('td')
    cell.dataset.prEnhancer = kind
    row.appendChild(cell)
  }
  return cell
}

function ensureHead(headerRow, kind, text) {
  if (headerRow.querySelector(`th[data-pr-enhancer="${kind}"]`)) return
  const th = document.createElement('th')
  th.dataset.prEnhancer = kind
  th.textContent = text
  headerRow.appendChild(th)
}

function setCellBadge(cell, text, className) {
  const existing = cell.firstElementChild
  if (existing && existing.tagName === 'SPAN') {
    if (existing.textContent !== text) existing.textContent = text
    if (existing.className !== className) existing.className = className
    return
  }
  cell.replaceChildren()
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  cell.appendChild(span)
}

function latestStage(detail, erpStatus) {
  if (!detail) return 'Sync Pending'
  const receiptCount = Number(detail.receipt_count || 0)
  const poCount = Number(detail.po_count || 0)
  const rfqCount = Number(detail.rfq_count || 0)
  const group = statusGroup(erpStatus)

  if (receiptCount > 0) return 'Received'
  if (poCount > 0) return 'PO Stage'
  if (rfqCount > 0) return 'RFQ Stage'
  if (group === 'REJECTED') return 'Rejected'
  if (group === 'CANCELLED') return 'Cancelled'
  if (group === 'APPROVED') return 'Awaiting RFQ'
  return 'PR Approval'
}

function lifecycleMatches(detail, erpStatus, filter) {
  if (filter === 'ALL') return true
  if (!detail) return false

  const rfqCount = Number(detail.rfq_count || 0)
  const poCount = Number(detail.po_count || 0)
  const receiptCount = Number(detail.receipt_count || 0)
  const group = statusGroup(erpStatus)

  if (filter === 'PR_APPROVAL') return group === 'IN_REVIEW' && rfqCount === 0 && poCount === 0 && receiptCount === 0
  if (filter === 'NO_RFQ') return group === 'APPROVED' && rfqCount === 0
  if (filter === 'HAS_RFQ') return rfqCount > 0
  if (filter === 'NO_PO') return rfqCount > 0 && poCount === 0
  if (filter === 'HAS_PO') return poCount > 0
  if (filter === 'NO_RECEIPT') return poCount > 0 && receiptCount === 0
  if (filter === 'RECEIVED') return receiptCount > 0
  if (filter === 'PENDING_APPROVER') return group === 'IN_REVIEW' && Boolean(clean(detail.current_approver))
  return true
}

export default function PrTrackerEnhancer() {
  const [detailMap, setDetailMap] = useState(new Map())
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [lifecycleFilter, setLifecycleFilter] = useState('ALL')
  const [detailCount, setDetailCount] = useState(0)
  const detailTimerRef = useRef(null)

  useEffect(() => {
    let active = true

    async function loadDetails() {
      const map = new Map()
      let from = 0
      const pageSize = 1000

      while (active) {
        const { data, error } = await supabase
          .from('erp_pr_details')
          .select('purch_req_id,current_approver,current_position,current_workflow_status,detail_synced_at,rfq_count,po_count,receipt_count')
          .range(from, from + pageSize - 1)

        if (error) {
          console.warn('Could not load PR detail summary', error.message)
          break
        }

        for (const row of data || []) {
          map.set(clean(row.purch_req_id).toUpperCase(), row)
        }

        if (!data || data.length < pageSize) break
        from += pageSize
      }

      if (active) {
        setDetailMap(map)
        setDetailCount(map.size)
      }
    }

    loadDetails()
    detailTimerRef.current = window.setInterval(loadDetails, 60000)

    return () => {
      active = false
      if (detailTimerRef.current) window.clearInterval(detailTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let disposed = false

    const enhance = () => {
      if (disposed) return
      const table = findPrTable()
      if (!table) return

      const wrapper = table.closest('.data-table, .table-wrap, .overflow-x-auto') || table.parentElement
      if (!wrapper || !wrapper.parentElement) return

      let toolbar = wrapper.parentElement.querySelector(':scope > .pr-enhancer-toolbar')
      if (!toolbar) {
        toolbar = document.createElement('div')
        toolbar.className = 'pr-enhancer-toolbar'

        const filtersWrap = document.createElement('div')
        filtersWrap.className = 'pr-enhancer-filter-wrap'

        const statusRow = document.createElement('div')
        statusRow.className = 'pr-enhancer-left'
        const statusLabel = document.createElement('span')
        statusLabel.className = 'pr-enhancer-label'
        statusLabel.textContent = 'PR STATUS'
        statusRow.appendChild(statusLabel)

        ;[
          ['ALL', 'All'],
          ['IN_REVIEW', 'In Review'],
          ['APPROVED', 'Approved'],
          ['REJECTED', 'Rejected'],
          ['CANCELLED', 'Cancelled'],
        ].forEach(([value, text]) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.statusFilter = value
          button.textContent = text
          button.addEventListener('click', () => setStatusFilter(value))
          statusRow.appendChild(button)
        })

        const lifecycleRow = document.createElement('div')
        lifecycleRow.className = 'pr-enhancer-left'
        const lifecycleLabel = document.createElement('span')
        lifecycleLabel.className = 'pr-enhancer-label'
        lifecycleLabel.textContent = 'LIFECYCLE'
        lifecycleRow.appendChild(lifecycleLabel)

        ;[
          ['ALL', 'All'],
          ['PR_APPROVAL', 'PR Approval'],
          ['NO_RFQ', 'No RFQ Yet'],
          ['HAS_RFQ', 'RFQ Created'],
          ['NO_PO', 'No PO Yet'],
          ['HAS_PO', 'PO Created'],
          ['NO_RECEIPT', 'No Receipt Yet'],
          ['RECEIVED', 'Received'],
          ['PENDING_APPROVER', 'Pending Approver'],
        ].forEach(([value, text]) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.lifecycleFilter = value
          button.textContent = text
          button.addEventListener('click', () => setLifecycleFilter(value))
          lifecycleRow.appendChild(button)
        })

        filtersWrap.append(statusRow, lifecycleRow)
        const sync = document.createElement('div')
        sync.className = 'pr-enhancer-sync'
        toolbar.append(filtersWrap, sync)
        wrapper.parentElement.insertBefore(toolbar, wrapper)
      }

      toolbar.querySelectorAll('button[data-status-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.statusFilter === statusFilter)
      })
      toolbar.querySelectorAll('button[data-lifecycle-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.lifecycleFilter === lifecycleFilter)
      })

      const sync = toolbar.querySelector('.pr-enhancer-sync')
      if (sync) {
        const details = [...detailMap.values()]
        const rfqs = details.filter((x) => Number(x.rfq_count || 0) > 0).length
        const pos = details.filter((x) => Number(x.po_count || 0) > 0).length
        const receipts = details.filter((x) => Number(x.receipt_count || 0) > 0).length
        const next = `${detailCount.toLocaleString()} synced · ${rfqs.toLocaleString()} RFQ · ${pos.toLocaleString()} PO · ${receipts.toLocaleString()} received`
        if (sync.textContent !== next) sync.textContent = next
      }

      const headerRow = table.querySelector('thead tr')
      if (!headerRow) return

      ensureHead(headerRow, 'approver', 'Current Approver')
      ensureHead(headerRow, 'days', 'Days Pending')
      ensureHead(headerRow, 'stage', 'Latest Stage')
      ensureHead(headerRow, 'rfq', 'RFQ')
      ensureHead(headerRow, 'po', 'PO Status')
      ensureHead(headerRow, 'receipt', 'Receipt Status')

      const baseHeads = [...headerRow.querySelectorAll('th:not([data-pr-enhancer])')].map((x) => lower(x.textContent))
      const prIndex = baseHeads.findIndex((x) => x === 'pr number')
      const dateIndex = baseHeads.findIndex((x) => x === 'submitted date')
      const statusIndex = baseHeads.findIndex((x) => x === 'erp status')
      if (prIndex < 0 || statusIndex < 0) return

      table.querySelectorAll('tbody tr').forEach((row) => {
        const baseCells = [...row.querySelectorAll(':scope > td:not([data-pr-enhancer])')]
        const prNo = clean(baseCells[prIndex]?.textContent).replace(/\s+/g, '').toUpperCase()
        if (!/^PR\d+$/.test(prNo)) return

        const detail = detailMap.get(prNo)
        const erpStatus = clean(baseCells[statusIndex]?.textContent)
        const group = statusGroup(erpStatus)
        const visibleByStatus = statusFilter === 'ALL' || group === statusFilter
        const visibleByLifecycle = lifecycleMatches(detail, erpStatus, lifecycleFilter)
        const desiredDisplay = visibleByStatus && visibleByLifecycle ? '' : 'none'
        if (row.style.display !== desiredDisplay) row.style.display = desiredDisplay

        const approverCell = ensureCell(row, 'approver')
        const approverLabel = detail
          ? (clean(detail.current_approver) || (group === 'APPROVED' ? 'Completed' : group === 'REJECTED' ? 'Rejected' : group === 'CANCELLED' ? 'Cancelled' : '—'))
          : 'Sync pending'
        setCellBadge(
          approverCell,
          approverLabel,
          detail ? (clean(detail.current_approver) ? 'pr-current-approver' : 'pr-detail-pending') : 'pr-detail-pending',
        )

        const daysCell = ensureCell(row, 'days')
        const days = dateIndex >= 0 ? daysSince(clean(baseCells[dateIndex]?.textContent)) : null
        const isFinal = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(group)
        const labelText = days == null ? '—' : days === 0 ? 'Today' : isFinal ? `${days}d age` : `${days}d`
        const tone = days == null || isFinal ? 'neutral' : ageTone(days)
        setCellBadge(daysCell, labelText, `pr-days ${tone}`)

        const stageCell = ensureCell(row, 'stage')
        const stage = latestStage(detail, erpStatus)
        const stageTone = stage === 'Received'
          ? 'good'
          : stage === 'PO Stage'
            ? 'blue'
            : stage === 'RFQ Stage'
              ? 'violet'
              : stage === 'Rejected' || stage === 'Cancelled'
                ? 'bad'
                : stage === 'PR Approval'
                  ? 'waiting'
                  : 'neutral'
        setCellBadge(stageCell, stage, `pr-stage-badge ${stageTone}`)

        const rfqCount = Number(detail?.rfq_count || 0)
        const poCount = Number(detail?.po_count || 0)
        const receiptCount = Number(detail?.receipt_count || 0)

        const rfqCell = ensureCell(row, 'rfq')
        setCellBadge(rfqCell, detail ? String(rfqCount) : '—', rfqCount > 0 ? 'pr-flow-count active' : 'pr-flow-count')

        const poCell = ensureCell(row, 'po')
        setCellBadge(
          poCell,
          detail ? (poCount > 0 ? `PO Created (${poCount})` : 'No PO Yet') : 'Sync pending',
          detail ? (poCount > 0 ? 'pr-flow-badge good' : 'pr-flow-badge waiting') : 'pr-detail-pending',
        )

        const receiptCell = ensureCell(row, 'receipt')
        setCellBadge(
          receiptCell,
          detail ? (receiptCount > 0 ? `Received (${receiptCount})` : 'No Receipt') : 'Sync pending',
          detail ? (receiptCount > 0 ? 'pr-flow-badge good' : 'pr-flow-badge neutral') : 'pr-detail-pending',
        )
      })
    }

    enhance()
    const uiTimer = window.setInterval(enhance, 1500)
    return () => {
      disposed = true
      window.clearInterval(uiTimer)
    }
  }, [detailMap, detailCount, statusFilter, lifecycleFilter])

  return <style>{`
    .pr-enhancer-toolbar{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin:12px 0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .pr-enhancer-filter-wrap{display:flex;flex-direction:column;gap:8px;min-width:0}.pr-enhancer-left{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.pr-enhancer-label{font-size:10px;font-weight:800;letter-spacing:.08em;color:#64748b;margin-right:3px;min-width:68px}
    .pr-enhancer-toolbar button{border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer}.pr-enhancer-toolbar button:hover{border-color:#94a3b8}.pr-enhancer-toolbar button.active{background:#0f172a;border-color:#0f172a;color:#fff}
    .pr-enhancer-sync{font-size:11px;font-weight:700;color:#64748b;white-space:nowrap;padding-top:4px;text-align:right}
    th[data-pr-enhancer]{white-space:nowrap}.pr-current-approver{font-size:11px;font-weight:700;color:#0f172a;white-space:nowrap}.pr-detail-pending{font-size:10px;font-weight:700;color:#94a3b8;white-space:nowrap}
    .pr-days{display:inline-flex;min-width:42px;justify-content:center;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.pr-days.fresh{background:#dcfce7;color:#166534}.pr-days.watch{background:#fef9c3;color:#854d0e}.pr-days.warn{background:#ffedd5;color:#9a3412}.pr-days.danger{background:#fee2e2;color:#b91c1c}.pr-days.neutral{background:#f1f5f9;color:#64748b}
    .pr-stage-badge{display:inline-flex;justify-content:center;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.pr-stage-badge.good{background:#dcfce7;color:#166534}.pr-stage-badge.blue{background:#dbeafe;color:#1d4ed8}.pr-stage-badge.violet{background:#ede9fe;color:#6d28d9}.pr-stage-badge.waiting{background:#fef3c7;color:#92400e}.pr-stage-badge.bad{background:#fee2e2;color:#b91c1c}.pr-stage-badge.neutral{background:#f1f5f9;color:#64748b}
    .pr-flow-count{display:inline-flex;min-width:28px;justify-content:center;padding:4px 7px;border-radius:999px;background:#f1f5f9;color:#64748b;font-size:10px;font-weight:800}.pr-flow-count.active{background:#dbeafe;color:#1d4ed8}
    .pr-flow-badge{display:inline-flex;justify-content:center;padding:4px 8px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.pr-flow-badge.good{background:#dcfce7;color:#166534}.pr-flow-badge.waiting{background:#fef3c7;color:#92400e}.pr-flow-badge.neutral{background:#f1f5f9;color:#64748b}
    @media(max-width:1100px){.pr-enhancer-toolbar{flex-direction:column}.pr-enhancer-sync{text-align:left;white-space:normal}}
  `}</style>
}
