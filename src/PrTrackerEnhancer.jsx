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
  if (days == null) return ''
  if (days >= 30) return 'danger'
  if (days >= 14) return 'warn'
  if (days >= 7) return 'watch'
  return 'fresh'
}

export default function PrTrackerEnhancer() {
  const [detailMap, setDetailMap] = useState(new Map())
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [detailCount, setDetailCount] = useState(0)
  const timerRef = useRef(null)

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
        if (error) break
        for (const row of data || []) map.set(clean(row.purch_req_id).toUpperCase(), row)
        if (!data || data.length < pageSize) break
        from += pageSize
      }
      if (active) {
        setDetailMap(map)
        setDetailCount(map.size)
      }
    }
    loadDetails()
    timerRef.current = setInterval(loadDetails, 60000)
    return () => {
      active = false
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  useEffect(() => {
    const enhance = () => {
      const tables = [...document.querySelectorAll('table')]
      const table = tables.find((t) => {
        const heads = [...t.querySelectorAll('thead th')].map((x) => lower(x.textContent))
        return heads.includes('pr number') && heads.includes('requested by') && heads.includes('erp status')
      })
      if (!table) return

      const parent = table.closest('.data-table, .table-wrap, .overflow-x-auto') || table.parentElement
      if (!parent) return

      let toolbar = parent.parentElement?.querySelector(':scope > .pr-enhancer-toolbar')
      if (!toolbar) {
        toolbar = document.createElement('div')
        toolbar.className = 'pr-enhancer-toolbar'
        toolbar.innerHTML = `
          <div class="pr-enhancer-left">
            <span class="pr-enhancer-label">PR STATUS</span>
            <button data-filter="ALL">All</button>
            <button data-filter="IN_REVIEW">In Review</button>
            <button data-filter="APPROVED">Approved</button>
            <button data-filter="REJECTED">Rejected</button>
            <button data-filter="CANCELLED">Cancelled</button>
          </div>
          <div class="pr-enhancer-sync"></div>
        `
        parent.parentElement?.insertBefore(toolbar, parent)
        toolbar.addEventListener('click', (event) => {
          const button = event.target.closest('button[data-filter]')
          if (!button) return
          setStatusFilter(button.dataset.filter || 'ALL')
        })
      }

      toolbar.querySelectorAll('button[data-filter]').forEach((button) => {
        button.classList.toggle('active', button.dataset.filter === statusFilter)
      })
      const sync = toolbar.querySelector('.pr-enhancer-sync')
      if (sync) sync.textContent = `${detailCount.toLocaleString()} PR details synced`

      const headerRow = table.querySelector('thead tr')
      if (!headerRow) return
      let currentApproverHead = headerRow.querySelector('th[data-pr-enhancer="approver"]')
      if (!currentApproverHead) {
        currentApproverHead = document.createElement('th')
        currentApproverHead.dataset.prEnhancer = 'approver'
        currentApproverHead.textContent = 'Current Approver'
        headerRow.appendChild(currentApproverHead)
      }
      let daysHead = headerRow.querySelector('th[data-pr-enhancer="days"]')
      if (!daysHead) {
        daysHead = document.createElement('th')
        daysHead.dataset.prEnhancer = 'days'
        daysHead.textContent = 'Days Pending'
        headerRow.appendChild(daysHead)
      }

      const originalHeads = [...headerRow.querySelectorAll('th:not([data-pr-enhancer])')].map((x) => lower(x.textContent))
      const prIndex = originalHeads.findIndex((x) => x === 'pr number')
      const dateIndex = originalHeads.findIndex((x) => x === 'submitted date')
      const statusIndex = originalHeads.findIndex((x) => x === 'erp status')
      if (prIndex < 0 || statusIndex < 0) return

      table.querySelectorAll('tbody tr').forEach((row) => {
        const baseCells = [...row.querySelectorAll(':scope > td:not([data-pr-enhancer])')]
        const prNo = clean(baseCells[prIndex]?.textContent).replace(/\s+/g, '').toUpperCase()
        if (!/^PR\d+$/.test(prNo)) return
        const erpStatus = clean(baseCells[statusIndex]?.textContent)
        const group = statusGroup(erpStatus)
        row.style.display = statusFilter === 'ALL' || group === statusFilter ? '' : 'none'

        const detail = detailMap.get(prNo)
        let approverCell = row.querySelector('td[data-pr-enhancer="approver"]')
        if (!approverCell) {
          approverCell = document.createElement('td')
          approverCell.dataset.prEnhancer = 'approver'
          row.appendChild(approverCell)
        }
        approverCell.innerHTML = detail?.current_approver
          ? `<span class="pr-current-approver">${clean(detail.current_approver)}</span>`
          : '<span class="pr-detail-pending">Sync pending</span>'

        let daysCell = row.querySelector('td[data-pr-enhancer="days"]')
        if (!daysCell) {
          daysCell = document.createElement('td')
          daysCell.dataset.prEnhancer = 'days'
          row.appendChild(daysCell)
        }
        const days = dateIndex >= 0 ? daysSince(clean(baseCells[dateIndex]?.textContent)) : null
        const isFinal = ['APPROVED', 'REJECTED', 'CANCELLED'].includes(group)
        daysCell.innerHTML = days == null
          ? '—'
          : isFinal
            ? `<span class="pr-days neutral">${days}d age</span>`
            : `<span class="pr-days ${ageTone(days)}">${days}d</span>`
      })
    }

    enhance()
    const observer = new MutationObserver(() => enhance())
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [detailMap, statusFilter, detailCount])

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
