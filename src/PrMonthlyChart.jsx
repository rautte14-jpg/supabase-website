import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CURRENT_YEAR = new Date().getFullYear()
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - i)

function parseDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.valueOf()) ? null : d
}

function findActivitySection() {
  const leaf = [...document.querySelectorAll('body *')].find((el) =>
    el.children.length === 0 && clean(el.textContent).toUpperCase().includes('01 · PR SUBMISSION ACTIVITY')
  )
  return leaf?.closest('section') || null
}

function findLifecycleYearSelect() {
  return document.querySelector('.prv2-row select')
}

function syncLifecycleYear(year) {
  const select = findLifecycleYearSelect()
  if (!select) return
  if (Number(select.value) === Number(year)) return
  select.value = String(year)
  select.dispatchEvent(new Event('change', { bubbles: true }))
}

function statusTone(status) {
  const s = clean(status).toLowerCase()
  if (s.includes('reject') || s.includes('cancel')) return 'bad'
  if (s.includes('approv') || s.includes('complete')) return 'good'
  return 'pending'
}

export default function PrMonthlyChart() {
  const [host, setHost] = useState(null)
  const [year, setYear] = useState(CURRENT_YEAR)
  const [counts, setCounts] = useState(Array(12).fill(0))
  const [loading, setLoading] = useState(false)
  const [selectedMonth, setSelectedMonth] = useState(null)
  const [selectedRows, setSelectedRows] = useState([])
  const [monthLoading, setMonthLoading] = useState(false)

  useEffect(() => {
    const el = document.getElementById('prpo-monthly-host')
    if (el) setHost(el)
  }, [])

  useEffect(() => {
    if (!host) return
    const id = window.setInterval(() => {
      const select = findLifecycleYearSelect()
      if (!select) return
      const next = Number(select.value)
      if (Number.isFinite(next)) setYear((old) => old === next ? old : next)
    }, 600)
    return () => window.clearInterval(id)
  }, [host])

  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      const { data, error } = await supabase
        .from('pr_monthly_summary')
        .select('month,pr_count')
        .eq('year', year)
        .order('month', { ascending: true })

      if (!active) return
      if (error) {
        console.warn('Monthly PR summary load failed', error.message)
        setLoading(false)
        return
      }

      const next = Array(12).fill(0)
      for (const row of data || []) {
        const index = Number(row.month || 0) - 1
        if (index >= 0 && index < 12) next[index] = Number(row.pr_count || 0)
      }
      setCounts(next)
      setLoading(false)
      setSelectedMonth(null)
      setSelectedRows([])
    }
    load()
    return () => { active = false }
  }, [year])

  useEffect(() => {
    if (selectedMonth === null) {
      setSelectedRows([])
      return
    }

    let active = true
    async function loadMonth() {
      setMonthLoading(true)
      const start = new Date(Date.UTC(year, selectedMonth, 1)).toISOString()
      const end = new Date(Date.UTC(year, selectedMonth + 1, 1)).toISOString()
      const { data, error } = await supabase
        .from('erp_pr_headers')
        .select('purch_req_id,description,created_at,created_at_raw,created_by,status,site')
        .gte('created_at', start)
        .lt('created_at', end)
        .order('created_at', { ascending: false })
        .limit(400)

      if (!active) return
      if (error) console.warn('Monthly PR detail load failed', error.message)
      setSelectedRows((data || []).map((row) => ({ ...row, _date: parseDate(row.created_at || row.created_at_raw) })))
      setMonthLoading(false)
    }
    loadMonth()
    return () => { active = false }
  }, [year, selectedMonth])

  const model = useMemo(() => {
    const max = Math.max(1, ...counts)
    const now = new Date()
    const currentMonth = now.getMonth()
    const visibleMonths = year < CURRENT_YEAR ? 12 : year === CURRENT_YEAR ? currentMonth + 1 : 0
    const relevantCounts = visibleMonths > 0 ? counts.slice(0, visibleMonths) : []
    const ytdTotal = relevantCounts.reduce((sum, n) => sum + n, 0)
    const average = visibleMonths > 0 ? ytdTotal / visibleMonths : 0
    let highestIndex = null
    if (relevantCounts.length) {
      let best = -1
      relevantCounts.forEach((count, index) => {
        if (count > best) { best = count; highestIndex = index }
      })
    }
    return { counts, max, currentMonth, visibleMonths, ytdTotal, average, highestIndex }
  }, [counts, year])

  if (!host) return null

  const isFutureMonth = (index) => year > CURRENT_YEAR || (year === CURRENT_YEAR && index > model.currentMonth)
  const highestText = model.highestIndex === null ? '—' : `${MONTHS[model.highestIndex]} · ${model.counts[model.highestIndex].toLocaleString()} PRs`

  return createPortal(
    <div className="prm-card">
      <div className="prm-head">
        <div>
          <span className="prm-kicker">MONTHLY SUBMISSION TREND</span>
          <h4>PRs submitted month by month</h4>
          <p>Shows the number of PRs submitted in each month of the selected year.</p>
        </div>
        <div className="prm-year-wrap">
          <span>Year</span>
          <select value={year} onChange={(e) => { const y = Number(e.target.value); setYear(y); syncLifecycleYear(y) }}>
            {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>

      <div className="prm-stats">
        <div><span>Highest month</span><strong>{highestText}</strong></div>
        <div><span>Average / month</span><strong>{model.average.toLocaleString(undefined, { maximumFractionDigits: 1 })}</strong></div>
        <div><span>{year === CURRENT_YEAR ? 'YTD total' : 'Year total'}</span><strong>{model.ytdTotal.toLocaleString()} PRs</strong></div>
      </div>

      <div className="prm-chart" aria-label={`Monthly PR submissions for ${year}`}>
        {MONTHS.map((month, index) => {
          const count = model.counts[index]
          const future = isFutureMonth(index)
          const height = future ? 0 : Math.max(count > 0 ? 10 : 2, Math.round((count / model.max) * 100))
          const active = selectedMonth === index
          return (
            <button
              key={month}
              type="button"
              disabled={future}
              className={`prm-bar-col ${active ? 'active' : ''} ${future ? 'future' : ''}`}
              onClick={() => !future && setSelectedMonth(active ? null : index)}
              title={future ? `${month} ${year}: Future month` : `${month} ${year}: ${count} PRs`}
            >
              <span className="prm-value">{future ? 'Future' : count}</span>
              <span className="prm-track"><span className="prm-bar" style={{ height: `${height}%` }} /></span>
              <span className="prm-month">{month}</span>
            </button>
          )
        })}
      </div>

      <div className="prm-foot">
        <span>{loading ? 'Refreshing…' : `${model.ytdTotal.toLocaleString()} PRs in ${year}`}</span>
        <span>Click a month to show its PR list</span>
      </div>

      {selectedMonth !== null && (
        <div className="prm-list">
          <div className="prm-list-head">
            <div><strong>{MONTHS[selectedMonth]} {year}</strong><span>{monthLoading ? 'Loading…' : selectedRows.length.toLocaleString() + ' PRs submitted'}</span></div>
            <button type="button" onClick={() => setSelectedMonth(null)}>Clear month</button>
          </div>
          <div className="prm-table-wrap">
            <table>
              <thead><tr><th>PR Number</th><th>PR Description</th><th>Submitted Date</th><th>Requested By</th><th>Site</th><th>ERP Status</th></tr></thead>
              <tbody>
                {selectedRows.map((r) => (
                  <tr key={r.purch_req_id}>
                    <td><strong>{clean(r.purch_req_id) || '—'}</strong></td>
                    <td>{clean(r.description) || '—'}</td>
                    <td>{r._date?.toLocaleString() || clean(r.created_at_raw) || '—'}</td>
                    <td>{clean(r.created_by) || '—'}</td>
                    <td>{clean(r.site) || '—'}</td>
                    <td><span className={`prm-status ${statusTone(r.status)}`}>{clean(r.status) || '—'}</span></td>
                  </tr>
                ))}
                {!selectedRows.length && <tr><td colSpan="6" className="prm-empty">No PRs were submitted in this month.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <style>{`
        .prm-card{margin-top:14px;border:1px solid #dbe5f0;border-radius:12px;background:#fff;padding:13px 16px 12px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
        .prm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px}.prm-kicker{font-size:9px;font-weight:800;letter-spacing:.1em;color:#2563eb}.prm-head h4{margin:4px 0 2px;font-size:14px;color:#0f172a}.prm-head p{margin:0;font-size:10px;color:#64748b}.prm-year-wrap{display:flex;align-items:center;gap:7px;font-size:10px;font-weight:800;color:#64748b}.prm-year-wrap select{border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:5px 8px;font-size:11px;font-weight:700;color:#334155}
        .prm-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:10px}.prm-stats>div{border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;padding:8px 10px}.prm-stats span{display:block;font-size:8px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8;margin-bottom:3px}.prm-stats strong{font-size:12px;color:#0f172a}
        .prm-chart{height:182px;display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:8px;align-items:end;padding:12px 6px 0;margin-top:9px;border-top:1px solid #f1f5f9}.prm-bar-col{height:100%;display:grid;grid-template-rows:20px 1fr 20px;align-items:end;border:0;background:transparent;padding:0;cursor:pointer;color:#475569;border-radius:7px;transition:.15s ease}.prm-value{font-size:9px;font-weight:800;text-align:center;align-self:center}.prm-track{height:100%;display:flex;align-items:flex-end;justify-content:center;border-bottom:1px solid #cbd5e1}.prm-bar{width:min(30px,68%);min-height:2px;border-radius:5px 5px 2px 2px;background:#3b82f6;transition:.16s ease}.prm-bar-col:not(.future):hover .prm-bar,.prm-bar-col.active .prm-bar{background:#1d4ed8}.prm-bar-col.active{background:#eff6ff}.prm-bar-col.future{cursor:default;opacity:.42;background:#f8fafc}.prm-bar-col.future .prm-value{font-size:8px;font-weight:700;color:#94a3b8}.prm-bar-col.future .prm-track{border-bottom-style:dashed}.prm-bar-col.future .prm-bar{display:none}.prm-month{text-align:center;font-size:9px;font-weight:800;align-self:center}
        .prm-foot{display:flex;justify-content:space-between;gap:12px;margin-top:7px;font-size:9px;color:#64748b}.prm-list{margin-top:12px;border-top:1px solid #e2e8f0;padding-top:10px}.prm-list-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}.prm-list-head div{display:flex;align-items:baseline;gap:8px}.prm-list-head strong{font-size:13px;color:#0f172a}.prm-list-head span{font-size:10px;color:#64748b}.prm-list-head button{border:1px solid #cbd5e1;background:#fff;border-radius:8px;padding:5px 8px;font-size:10px;font-weight:700;color:#475569;cursor:pointer}.prm-table-wrap{overflow:auto;max-height:420px;border:1px solid #e2e8f0;border-radius:9px}.prm-table-wrap table{width:100%;border-collapse:collapse;font-size:10px;min-width:900px}.prm-table-wrap th{position:sticky;top:0;background:#f8fafc;text-align:left;padding:8px 9px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:9px;text-transform:uppercase;letter-spacing:.04em}.prm-table-wrap td{padding:8px 9px;border-bottom:1px solid #f1f5f9;color:#334155}.prm-status{display:inline-flex;padding:3px 7px;border-radius:999px;font-size:9px;font-weight:800;background:#f1f5f9;color:#64748b}.prm-status.good{background:#dcfce7;color:#166534}.prm-status.bad{background:#fee2e2;color:#b91c1c}.prm-status.pending{background:#eff6ff;color:#1d4ed8}.prm-empty{text-align:center!important;padding:20px!important;color:#94a3b8!important}
        @media(max-width:900px){.prm-chart{gap:5px}.prm-bar{width:65%}.prm-stats{grid-template-columns:1fr}}@media(max-width:700px){.prm-head{flex-direction:column}.prm-chart{overflow-x:auto;grid-template-columns:repeat(12,56px)}.prm-foot{flex-direction:column}}
      `}</style>
    </div>,
    host,
  )
}
