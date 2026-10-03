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
  if (text.includes('approv')) return 'APPROVED'
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

export default function PrTrackerEnhancer() {
  const [detailMap, setDetailMap] = useState(new Map())
  const [statusFilter, setStatusFilter] = useState('ALL')
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
          .select('purch_req_id,current_approver,current_workflow_status,detail_synced_at')
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

        const left = document.createElement('div')
        left.className = 'pr-enhancer-left'
        const label = document.createElement('span')
        label.className = 'pr-enhancer-label'
        label.textContent = 'PR STATUS'
        left.appendChild(label)

        const filters = [
          ['ALL', 'All'],
          ['IN_REVIEW', 'In Review'],
          ['APPROVED', 'Approved'],
          ['REJECTED', 'Rejected'],
          ['CANCELLED', 'Cancelled'],
        ]
        filters.forEach(([value, text]) => {
          const button = document.createElement('button')
          button.type = 'button'
          button.dataset.filter = value
          button.textContent = text
          button.addEventListener('click', () => setStatusFilter(value))
          left.appendChild(button)
        })

        const sync = document.createElement('div')
        sync.className = 'pr-enhancer-sync'
        toolbar.append(left, sync)
        wrapper.parentElement.insertBefore(toolbar, wrapper)
      }

      toolbar.querySelectorAll('button[data-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.filter === statusFilter)
      })
      const sync = toolbar.querySelector('.pr-enhancer-sync')
      if (sync) {
        const next = `${detailCount.toLocaleString()} PR details synced`
        if (sync.textContent !== next) sync.textContent = next
      }

      const headerRow = table.querySelector('thead tr')
      if (!headerRow) return

      if (!headerRow.querySelector('th[data-pr-enhancer="approver"]')) {
        const th = document.createElement('th')
        th.dataset.prEnhancer = 'approver'
        th.textContent = 'Current Approver'
        headerRow.appendChild(th)
      }
      if (!headerRow.querySelector('th[data-pr-enhancer="days"]')) {
        const th = document.createElement('th')
        th.dataset.prEnhancer = 'days'
        th.textContent = 'Days Pending'
        headerRow.appendChild(th)
      }

      const baseHeads = [...headerRow.querySelectorAll('th:not([data-pr-enhancer])')].map((x) => lower(x.textContent))
      const prIndex = baseHeads.findIndex((x) => x === 'pr number')
      const dateIndex = baseHeads.findIndex((x) => x === 'submitted date')
      const statusIndex = baseHeads.findIndex((x) => x === 'erp status')
      if (prIndex < 0 || statusIndex < 0) return

      table.querySelectorAll('tbody tr').forEach((row) => {
        const baseCells = [...row.querySelectorAll(':scope > td:not([data-pr-enhancer])')]
        const prNo = clean(baseCells[prIndex]?.textContent).replace(/\s+/g, '').toUpperCase()
        if (!/^PR\d+$/.test(prNo)) return

        const erpStatus = clean(baseCells[statusIndex]?.textContent)
        const group = statusGroup(erpStatus)
        const visible = statusFilter === 'ALL' || group === statusFilter
        const desiredDisplay = visible ? '' : 'none'
        if (row.style.display !== desiredDisplay) row.style.display = desiredDisplay

        const detail = detailMap.get(prNo)
        const approverCell = ensureCell(row, 'approver')
        setCellBadge(
          approverCell,
          detail?.current_approver || 'Sync pending',
          detail?.current_approver ? 'pr-current-approver' : 'pr-detail-pending',
        )

        const daysCell = ensureCell(row, 'days')
        const days = dateIndex >= 0 ? daysSince(clean(baseCells[dateIndex]?.textContent)) : null
        const isFinal = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(group)
        const labelText = days == null ? '—' : isFinal ? `${days}d age` : `${days}d`
        const tone = days == null || isFinal ? 'neutral' : ageTone(days)
        setCellBadge(daysCell, labelText, `pr-days ${tone}`)
      })
    }

    enhance()
    const uiTimer = window.setInterval(enhance, 1500)
    return () => {
      disposed = true
      window.clearInterval(uiTimer)
    }
  }, [detailMap, detailCount, statusFilter])

  return <style>{`
    .pr-enhancer-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:12px 0;padding:10px 12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04)}
    .pr-enhancer-left{display:flex;align-items:center;gap:7px;flex-wrap:wrap}.pr-enhancer-label{font-size:10px;font-weight:800;letter-spacing:.08em;color:#64748b;margin-right:3px}
    .pr-enhancer-toolbar button{border:1px solid #cbd5e1;background:#fff;color:#475569;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer}.pr-enhancer-toolbar button:hover{border-color:#94a3b8}.pr-enhancer-toolbar button.active{background:#0f172a;border-color:#0f172a;color:#fff}
    .pr-enhancer-sync{font-size:11px;font-weight:700;color:#64748b;white-space:nowrap}
    th[data-pr-enhancer]{white-space:nowrap}.pr-current-approver{font-size:11px;font-weight:700;color:#0f172a;white-space:nowrap}.pr-detail-pending{font-size:10px;font-weight:700;color:#94a3b8;white-space:nowrap}
    .pr-days{display:inline-flex;min-width:42px;justify-content:center;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:800;white-space:nowrap}.pr-days.fresh{background:#dcfce7;color:#166534}.pr-days.watch{background:#fef9c3;color:#854d0e}.pr-days.warn{background:#ffedd5;color:#9a3412}.pr-days.danger{background:#fee2e2;color:#b91c1c}.pr-days.neutral{background:#f1f5f9;color:#64748b}
    @media(max-width:900px){.pr-enhancer-toolbar{align-items:flex-start;flex-direction:column}.pr-enhancer-sync{white-space:normal}}
  `}</style>
}
