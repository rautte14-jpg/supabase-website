import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { SOURCE_OPTIONS, detectSource, entityKey, humanSource, mapRows, normalizeSheetRows } from './importers'

const NAV = [
  ['home', 'Home', '⌂'],
  ['overview', 'Overview', 'D'],
  ['prf', 'PRF Tracker', 'P'],
  ['prpo', 'PR & PO Tracker', 'O'],
  ['payments', 'Pending Payments', 'P'],
  ['mtr', 'MTR Tracker', 'T'],
  ['mrn', 'MRN & Issues', 'M'],
  ['vessel', 'Vessel / SR View', 'V'],
  ['stock', 'Stock & Ageing', 'S'],
  ['updates', 'Update Centre', 'U'],
  ['warehouse', 'Warehouse Presentation', 'W'],
  ['inventoryPresentation', 'Inventory Presentation', 'S'],
  ['history', 'History', 'H'],
]

const NAV_GROUPS = [
  ['Workspace', ['home', 'overview']],
  ['Procurement', ['prf', 'prpo', 'payments']],
  ['Materials', ['mtr', 'mrn', 'vessel']],
  ['Inventory', ['stock']],
  ['Reporting', ['warehouse', 'inventoryPresentation', 'history']],
  ['Administration', ['updates']],
]

function LineIcon({ name, className = 'h-5 w-5' }) {
  const paths = {
    home: <><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-7h6v7"/></>,
    overview: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    prf: <><path d="M6 3h9l3 3v15H6z"/><path d="M15 3v4h4"/><path d="M9 12h6M9 16h6"/></>,
    prpo: <><path d="M4 5h16v14H4z"/><path d="M4 9h16"/><path d="M8 13h3M8 16h6"/></>,
    mtr: <><path d="M4 7h11"/><path d="m12 4 3 3-3 3"/><path d="M20 17H9"/><path d="m12 14-3 3 3 3"/></>,
    mrn: <><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
    vessel: <><path d="M3 14h18l-3 5H6z"/><path d="M8 14V7h8v7"/><path d="M10 7V4h4v3"/></>,
    stock: <><path d="m12 3 8 4-8 4-8-4z"/><path d="m4 12 8 4 8-4"/><path d="m4 17 8 4 8-4"/></>,
    updates: <><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M5 21h14"/></>,
    meeting: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v6h6"/><path d="M12 7v5l3 2"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    refresh: <><path d="M20 6v5h-5"/><path d="M4 18v-5h5"/><path d="M18.5 9A7 7 0 0 0 6 6.5L4 11"/><path d="M5.5 15A7 7 0 0 0 18 17.5L20 13"/></>,
    upload: <><path d="M12 21V9"/><path d="m8 13 4-4 4 4"/><path d="M5 3h14"/></>,
    arrow: <><path d="M5 12h14"/><path d="m15 8 4 4-4 4"/></>,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {paths[name] || paths.overview}
    </svg>
  )
}

const fmt = (n, digits = 0) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })

const money = (n) =>
  Number(n || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

const mvr = (n) => 'MVR ' + money(n)

const lower = (v) => String(v ?? '').toLowerCase()

function isClosed(value) {
  const s = lower(value)
  return ['closed', 'complete', 'completed', 'received', 'delivered', 'cancelled', 'canceled'].some((x) =>
    s.includes(x),
  )
}

function isUrgent(value) {
  const s = lower(value)
  return ['urgent', 'critical', 'high'].some((x) => s.includes(x))
}

function prfStatusLabel(value) {
  const text = String(value ?? '').trim()
  return text ? text.toUpperCase() : 'NOT ATTENDED'
}

function weekStartWednesday(dateLike) {
  if (!dateLike) return ''
  const date = new Date(String(dateLike).slice(0, 10) + 'T12:00:00')
  if (Number.isNaN(date.valueOf())) return ''
  const daysSinceWednesday = (date.getDay() - 3 + 7) % 7
  date.setDate(date.getDate() - daysSinceWednesday)
  return date.toISOString().slice(0, 10)
}

function addDaysIso(iso, days) {
  const date = new Date(iso + 'T12:00:00')
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

function formatShortDate(iso) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

function rawField(row, names) {
  const raw = row?.raw_source
  if (!raw || typeof raw !== 'object') return ''
  const entries = Object.entries(raw)
  for (const name of names) {
    const wanted = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '')
    const hit = entries.find(([key]) =>
      String(key).toLowerCase().replace(/[^a-z0-9]+/g, '') === wanted
    )
    if (hit && String(hit[1] ?? '').trim() !== '') return hit[1]
  }
  return ''
}

function isPlaceholderValue(value, zeroIsBlank = false) {
  const text = String(value ?? '').trim()
  if (!text) return true
  if (/^[-–—_.]+$/.test(text)) return true
  if (/^(null|undefined|n\/?a)$/i.test(text)) return true
  if (zeroIsBlank && /^0(?:\.0+)?$/.test(text)) return true
  return false
}

function displayValue(value, zeroIsBlank = false) {
  return isPlaceholderValue(value, zeroIsBlank) ? '—' : value
}

function isUsefulPrPoRow(row) {
  const core = [
    row?.pr_no,
    row?.po_no,
    row?.item_code,
    row?.item_description,
    rawField(row, ['PR No.', 'PR No']),
    rawField(row, ['PO Number']),
    rawField(row, ['Item ID']),
    rawField(row, ['Product Name']),
  ]
  return core.some((value) => !isPlaceholderValue(value, true))
}

function numericRowField(row, directKey, rawNames = []) {
  const direct = row?.[directKey]
  const value = direct !== null && direct !== undefined && String(direct).trim() !== ''
    ? direct
    : rawField(row, rawNames)
  if (value === null || value === undefined || String(value).trim() === '') return null
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function rawNumber(row, names = []) {
  const value = rawField(row, names)
  if (value === null || value === undefined || String(value).trim() === '') return 0
  const parsed = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function hasRawField(row, names = []) {
  const raw = row?.raw_source
  if (!raw || typeof raw !== 'object') return false
  const keys = Object.keys(raw).map((key) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, ''))
  return names.some((name) => keys.includes(String(name).toLowerCase().replace(/[^a-z0-9]+/g, '')))
}

function parseFlexibleDate(value) {
  if (!value) return ''
  const text = String(value).trim()
  if (!text) return ''

  // Already ISO / database date.
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const [, y, m, d] = iso
    return [y, String(m).padStart(2, '0'), String(d).padStart(2, '0')].join('-')
  }

  // Excel/display dates such as 23-Sep-26 or 23-Sep-2026.
  const named = text.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2}|\d{4})/)
  if (named) {
    const months = {
      jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3,
      apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
      aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
      nov: 11, november: 11, dec: 12, december: 12,
    }
    const day = Number(named[1])
    const month = months[named[2].toLowerCase()]
    let year = Number(named[3])
    if (year < 100) year += 2000
    if (month && day >= 1 && day <= 31) {
      return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
    }
  }

  // Slash dates from source exports, e.g. 9/23/26 or 23/9/26.
  const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})/)
  if (slash) {
    let a = Number(slash[1])
    let b = Number(slash[2])
    let year = Number(slash[3])
    if (year < 100) year += 2000

    // ERP exports are usually month/day/year. If first number > 12,
    // it must be day/month/year.
    let month = a
    let day = b
    if (a > 12) {
      day = a
      month = b
    }

    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
    }
  }

  const fallback = new Date(text)
  return Number.isNaN(fallback.valueOf()) ? '' : fallback.toISOString().slice(0, 10)
}

function dateRowField(row, directKey, rawNames = []) {
  const direct = row?.[directKey]
  const value = direct || rawField(row, rawNames)
  return parseFlexibleDate(value)
}

function receiptState(row) {
  const rawText = row?.raw_source && typeof row.raw_source === 'object'
    ? Object.values(row.raw_source).join(' ')
    : ''
  const status = lower([row?.status, row?.delivery_status, rawText].filter(Boolean).join(' '))

  if (/partial(?:ly)?\s*receiv|part\s*receiv/.test(status)) return 'partial'
  if (/fully\s*receiv|completely\s*receiv|all\s*receiv|received\s*all|complete\s*receipt/.test(status)) return 'full'
  if (/\breceived\b/.test(status) && !/not\s*received|pending|awaiting/.test(status)) return 'full'
  return ''
}

function requestedQty(row) {
  return numericRowField(row, 'qty_requested', ['Requested Qty', 'Request Qty', 'Quantity', 'PR Qty']) ?? 0
}

function receivedQty(row) {
  const direct = numericRowField(row, 'qty_received', [
    'Received',
    'Received Qty',
    'Received Quantity',
    'Receipt Qty',
    'PO Received Qty',
    'Total Received Qty',
    'Delivered Qty',
  ])
  if (direct !== null) return Math.max(0, direct)
  return receiptState(row) === 'full' ? Math.max(0, requestedQty(row)) : 0
}

function prSubmittedDate(row) {
  return dateRowField(row, 'pr_date', [
    'PR Date',
    'Submitted Date',
    'Created Date',
    'PR Created Date',
    'PR Creation Date',
    'Creation Date',
    'Requisition Date',
  ])
}
function receivedDate(row) {
  return dateRowField(row, 'received_date', [
    'Received Date',
    'Receipt Date',
    'Goods Received Date',
    'GRN Date',
  ])
}


function mtrRequestedQty(row) {
  return Math.max(0, Number(row?.requested_qty || 0))
}

function mtrTransferredQty(row) {
  return Math.max(0, Number(row?.transferred_qty || 0))
}

function mtrRemainingQty(row) {
  const direct = row?.remaining_qty
  if (direct !== null && direct !== undefined && String(direct).trim() !== '') {
    const parsed = Number(direct)
    if (Number.isFinite(parsed)) return Math.max(0, parsed)
  }
  return Math.max(0, mtrRequestedQty(row) - mtrTransferredQty(row))
}

function mtrRequestDate(row) {
  return dateRowField(row, 'document_date', ['Request date', 'Request Date'])
}

function mtrAgeDays(row) {
  const iso = mtrRequestDate(row)
  if (!iso) return 0
  const date = new Date(iso + 'T12:00:00')
  if (Number.isNaN(date.valueOf())) return 0
  return Math.max(0, Math.floor((Date.now() - date.valueOf()) / 86400000))
}

function mtrStockAvailable(row) {
  const raw = rawField(row, ['On-Hand SRD', 'On Hand SRD'])
  const parsed = Number(String(raw).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  if (Number.isFinite(parsed)) return parsed > 0
  const text = lower(raw)
  return text.includes('available') && !text.includes('not available') && !text.includes('unavailable')
}

function mtrDeliveryStatus(row) {
  return String(rawField(row, ['Delivery Status ERP']) || '').trim()
}

function mrnCreatedDate(row) {
  return dateRowField(row, 'document_date', ['Created'])
}

function mrnStatusLabel(row) {
  const rawStatus = rawField(row, ['Issued Status'])
  const status = String(rawStatus || '').trim()
  return status || 'NOT ISSUED'
}
function mrnStatusDisplay(value) {
  const status = String(value || '').trim()
  return !status || status.toUpperCase() === 'BLANK' ? 'NOT ISSUED' : status
}


function mrnIsIssued(row) {
  const status = lower(mrnStatusLabel(row))
  return (
    status === 'issued' ||
    status.includes('issued') ||
    status.includes('complete') ||
    status.includes('completed') ||
    status.includes('posted') ||
    status.includes('material released')
  ) && !status.includes('not issued') && !status.includes('unissued')
}

function mrnIsCancelled(row) {
  const status = lower(mrnStatusLabel(row))
  return status.includes('cancel') || status.includes('reject')
}

function mrnIsPending(row) {
  return mrnStatusLabel(row) === 'NOT ISSUED'
}

function mrnAgeDays(row) {
  const iso = mrnCreatedDate(row)
  if (!iso) return 0
  const date = new Date(iso + 'T12:00:00')
  if (Number.isNaN(date.valueOf())) return 0
  return Math.max(0, Math.floor((Date.now() - date.valueOf()) / 86400000))
}

function mrnJournalNo(row) {
  return String(rawField(row, ['SVO / JOURNAL NUMBER', 'SVO / Journal Number']) || '').trim()
}

function mrnHasJournal(row) {
  const value = mrnJournalNo(row)
  return /\bMTCC-\d+\b/i.test(value)
}

function mrnWpType(row) {
  return String(rawField(row, ['WP TYPE', 'WP Type']) || '').trim() || 'BLANK'
}
function mrnSourceId(row) {
  return String(rawField(row, ['ID']) || row?.id || '').trim()
}

function normalizedWorkshop(value) {
  return String(value || '').trim().toUpperCase()
}

function normalizedSr(value) {
  const text = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  const standard = text.match(/\bSR-?(\d+)\b/)
  if (standard) return 'SR' + standard[1]
  const internal = text.match(/\bISR-?(\d+)-?(\d+)?\b/)
  if (internal) return 'ISR-' + internal[1] + (internal[2] ? '-' + internal[2] : '')
  return text === '0' || text === '-' ? '' : text
}


function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('signin')

  async function submit(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')

    if (mode === 'signup') {
      const { data: accessRows, error: accessError } = await supabase
        .from('portal_access')
        .select('email, active')
        .eq('email', email.trim().toLowerCase())
        .limit(1)

      // Anonymous users cannot normally read portal_access because of RLS.
      // Sign-up remains safe because unauthorised accounts are blocked by the app
      // and all portal data is protected by membership RLS.
      if (accessError && !String(accessError.message || '').toLowerCase().includes('row-level security')) {
        setLoading(false)
        setMessage(accessError.message)
        return
      }

      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
      })
      setLoading(false)

      if (error) {
        setMessage(error.message)
        return
      }

      if (data?.session) {
        setMessage('Account created. Signing you in…')
      } else {
        setMessage('Account created. Check your email for the confirmation link, then return here and sign in.')
      }
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setLoading(false)
    if (error) setMessage(error.message)
  }

  async function resetPassword() {
    const address = email.trim()
    if (!address) {
      setMessage('Enter your email address first, then tap Forgot password?')
      return
    }

    setLoading(true)
    setMessage('')
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: window.location.origin,
    })
    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Password reset email sent. Open the link in your email to set a new password.')
  }

  function switchMode(nextMode) {
    setMode(nextMode)
    setMessage('')
    setPassword('')
  }

  return (
    <main className="login-page">
      <section className="login-brand">
        <div className="mtcc-mark">SRD</div>
        <p>Shipbuilding & Repair Division</p>
        <h1>Warehouse System</h1>
        <p className="login-copy">
          One place for procurement, transfers, material requests, inventory movement and Wednesday meeting follow-up.
        </p>
      </section>

      <section className="login-card">
        <span className="eyebrow">AUTHORIZED ACCESS</span>
        <h2>{mode === 'signin' ? 'Sign in' : 'Create first-time login'}</h2>
        <p className="muted">
          {mode === 'signin'
            ? 'Use the account approved for the SRD Inventory Portal.'
            : 'Use the same email address that has been approved for portal access.'}
        </p>
        <form onSubmit={submit}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            {mode === 'signin' ? 'Password' : 'Create password'}
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </label>
          <button className="primary" disabled={loading}>
            {loading
              ? (mode === 'signin' ? 'Signing in…' : 'Creating account…')
              : (mode === 'signin' ? 'Sign in' : 'Create account')}
          </button>
        </form>

        {mode === 'signin' && (
          <button type="button" className="auth-switch" onClick={resetPassword} disabled={loading}>
            Forgot password?
          </button>
        )}

        <button
          type="button"
          className="auth-switch"
          onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin'
            ? 'First time here? Create your login'
            : 'Already created your login? Sign in'}
        </button>

        {message && (
          <p className={lower(message).includes('invalid') || lower(message).includes('error') ? 'notice error' : 'notice'}>
            {message}
          </p>
        )}
      </section>
    </main>
  )
}

function AccessDenied({ email }) {
  return (
    <main className="login-page">
      <section className="login-card access-card">
        <span className="eyebrow">ACCESS NOT ENABLED</span>
        <h2>This account is not on the SRD portal list.</h2>
        <p className="muted">{email}</p>
        <button className="secondary" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>
    </main>
  )
}

function MetricCard({ label, value, helper, tone = 'default', onClick, active = false }) {
  const className = [
    'metric-card',
    '!min-h-[108px] !rounded-xl !border !border-slate-200 !bg-white !p-4 !shadow-sm',
    '[&>span]:!text-[10px] [&>span]:!font-semibold [&>span]:!uppercase [&>span]:!tracking-wider [&>span]:!text-slate-500',
    '[&>strong]:!mt-3 [&>strong]:!text-[24px] [&>strong]:!font-semibold [&>strong]:!tracking-tight [&>strong]:!text-slate-900',
    '[&>small]:!mt-1 [&>small]:!text-[11px] [&>small]:!leading-4 [&>small]:!text-slate-500',
    'transition-all duration-150',
    tone,
    onClick ? 'clickable hover:!border-slate-300 hover:!shadow-md' : '',
    active ? 'active !border-blue-200 !bg-blue-50/70' : '',
  ].filter(Boolean).join(' ')

  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick}>
        <span>{label}</span>
        <strong>{value}</strong>
        {helper && <small>{helper}</small>}
      </button>
    )
  }

  return (
    <article className={className}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper && <small>{helper}</small>}
    </article>
  )
}

function StatusPill({ value }) {
  const text = String(value || '—')
  const l = text.toLowerCase()
  let cls = 'border-slate-200 bg-slate-50 text-slate-600'
  if (['urgent', 'critical', 'overdue', 'delayed', 'rejected', 'cancelled', 'canceled'].some((x) => l.includes(x))) {
    cls = 'border-rose-200/70 bg-rose-50 text-rose-700'
  } else if (['received', 'complete', 'completed', 'delivered', 'closed', 'issued'].some((x) => l.includes(x))) {
    cls = 'border-emerald-200/70 bg-emerald-50 text-emerald-700'
  } else if (['pending', 'submitted', 'progress', 'partial', 'transit', 'processing', 'waiting'].some((x) => l.includes(x))) {
    cls = 'border-amber-200/70 bg-amber-50 text-amber-700'
  }
  return (
    <span className={'status-pill !inline-flex !max-w-none !items-center !whitespace-nowrap !rounded-full !border !px-2.5 !py-1 !text-[10px] !font-semibold !uppercase !tracking-wide ' + cls}>
      {text}
    </span>
  )
}

function PrfStatusBadge({ value }) {
  const text = prfStatusLabel(value)
  const l = lower(text)
  const complete = ['complete', 'completed', 'received', 'closed', 'delivered'].some((x) => l.includes(x))
  const pending = ['submitted', 'pending', 'not attended', 'processing', 'progress'].some((x) => l.includes(x))
  const cls = complete
    ? 'border-emerald-200/60 bg-emerald-50 text-emerald-700'
    : pending
      ? 'border-amber-200/60 bg-amber-50 text-amber-700'
      : 'border-slate-200 bg-slate-50 text-slate-600'

  return (
    <span className={'inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ' + cls}>
      {text}
    </span>
  )
}

function EmptyState({ title = 'No records yet', text = 'Use Update Centre to load the latest source file.' }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function DataTable({ rows, columns, onUpdate, noteType, noteMap, limit = 300, className = '' }) {
  const visible = rows.slice(0, limit)
  if (!rows.length) return <EmptyState />
  return (
    <div className={'table-wrap !rounded-xl !border !border-slate-200 !bg-white !shadow-sm [&_thead]:!bg-slate-50 [&_th]:!bg-slate-50 [&_th]:!px-3 [&_th]:!py-3 [&_th]:!text-[10px] [&_th]:!font-semibold [&_th]:!uppercase [&_th]:!tracking-wider [&_th]:!text-slate-500 [&_tbody_tr]:!border-b [&_tbody_tr]:!border-slate-100 [&_tbody_tr]:transition-colors hover:[&_tbody_tr]:!bg-slate-50/70 [&_td]:!px-3 [&_td]:!py-3 [&_td]:!text-[11px] [&_td]:!leading-5 [&_td]:!text-slate-700 [&_.mini-button]:!rounded-md [&_.mini-button]:!border [&_.mini-button]:!border-slate-200 [&_.mini-button]:!bg-slate-50 [&_.mini-button]:!px-3 [&_.mini-button]:!py-1 [&_.mini-button]:!text-xs [&_.mini-button]:!font-medium [&_.mini-button]:!text-slate-600 [&_.mini-button]:!transition-colors hover:[&_.mini-button]:!border-blue-200 hover:[&_.mini-button]:!bg-blue-50 hover:[&_.mini-button]:!text-blue-600 ' + className}>
      <table>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.key}>{c.label}</th>)}
            {onUpdate && <th>Follow-up</th>}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => {
            const key = noteType ? entityKey(noteType, row) : ''
            const note = noteMap?.get(noteType + '|' + key)
            return (
              <tr key={row.id ?? row.item_code ?? index}>
                {columns.map((c) => (
                  <td key={c.key}>
                    {c.render ? c.render(row[c.key], row) : (row[c.key] ?? '—')}
                  </td>
                ))}
                {onUpdate && (
                  <td>
                    <button className={note ? 'mini-button active' : 'mini-button'} onClick={() => onUpdate(noteType, row)}>
                      {note ? 'View / edit' : 'Add update'}
                    </button>
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length > limit && <p className="table-note">Showing first {limit} of {rows.length} records.</p>}
    </div>
  )
}

function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header !mb-5 !items-center !border-b !border-slate-200 !pb-4">
      <div>
        <h1 className="!text-2xl !font-semibold !tracking-tight !text-slate-900">{title}</h1>
        {subtitle && <p className="!mt-1 !text-sm !text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions !items-center !gap-2">{actions}</div>}
    </div>
  )
}

function NoteModal({ state, note, onClose, onSave }) {
  const [form, setForm] = useState({
    remark: note?.remark ?? '',
    action: note?.action ?? '',
    owner: note?.owner ?? '',
    deadline: note?.deadline ?? '',
    eta: note?.eta ?? '',
    priority: note?.priority ?? '',
  })

  useEffect(() => {
    setForm({
      remark: note?.remark ?? '',
      action: note?.action ?? '',
      owner: note?.owner ?? '',
      deadline: note?.deadline ?? '',
      eta: note?.eta ?? '',
      priority: note?.priority ?? '',
    })
  }, [note, state?.key])

  if (!state) return null

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <span className="eyebrow">MEETING FOLLOW-UP</span>
            <h2>{state.key}</h2>
          </div>
          <button className="icon-button" onClick={onClose}>×</button>
        </div>

        <div className="form-grid">
          <label className="span-2">
            Remark
            <textarea value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} rows={3} />
          </label>
          <label className="span-2">
            Action required
            <textarea value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} rows={3} />
          </label>
          <label>
            Owner
            <input value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
          </label>
          <label>
            Priority
            <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
              <option value="">—</option>
              <option>Critical</option>
              <option>Urgent</option>
              <option>High</option>
              <option>Normal</option>
            </select>
          </label>
          <label>
            Deadline
            <input type="date" value={form.deadline || ''} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
          </label>
          <label>
            ETA
            <input type="date" value={form.eta || ''} onChange={(e) => setForm({ ...form, eta: e.target.value })} />
          </label>
        </div>

        <div className="modal-actions">
          <button className="secondary" onClick={onClose}>Cancel</button>
          <button className="primary" onClick={() => onSave(form)}>Save update</button>
        </div>
      </section>
    </div>
  )
}

async function fetchAllRows(table, orderColumn, ascending = false) {
  const pageSize = 1000
  let from = 0
  let all = []

  while (true) {
    let query = supabase
      .from(table)
      .select('*')
      .range(from, from + pageSize - 1)

    if (orderColumn) {
      query = query.order(orderColumn, { ascending })
    }

    const { data, error } = await query
    if (error) throw error

    const batch = data ?? []
    all = all.concat(batch)

    if (batch.length < pageSize) break
    from += pageSize
  }

  return all
}

function AgeingTrend({ snapshots }) {
  if (!snapshots.length) return null

  const current = snapshots.at(-1) || null
  const previous = snapshots.at(-2) || null
  if (!current) return null

  const currentDate = new Date(current.snapshot_date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const previousDate = previous
    ? new Date(previous.snapshot_date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    : 'Previous week'

  const buckets = [
    { key: 'p2', label: 'P2 — 1–3 Years' },
    { key: 'p3', label: 'P3 — 3–4 Years' },
    { key: 'p4', label: 'P4 — 4–5 Years' },
    { key: 'p5', label: 'P5 — Over 5 Years' },
  ]

  const rows = buckets.map((bucket) => {
    const currentValue = Number(current.metrics?.[bucket.key] || 0)
    const previousValue = Number(previous?.metrics?.[bucket.key] || 0)
    return {
      ...bucket,
      currentValue,
      previousValue,
      change: previous ? currentValue - previousValue : null,
    }
  })

  const biggestMovement = previous
    ? [...rows].sort((a, b) => Math.abs(b.change) - Math.abs(a.change))[0]
    : null
  const improvedBuckets = rows.filter((row) => row.change !== null && row.change < 0)

  const currentOnHand = Number(current.metrics?.onHandValue || 0)
  const previousOnHand = Number(previous?.metrics?.onHandValue || 0)
  const onHandChange = previous ? currentOnHand - previousOnHand : null

  const currentOver1 = Number(current.metrics?.over1 || 0)
  const previousOver1 = Number(previous?.metrics?.over1 || 0)
  const over1Change = previous ? currentOver1 - previousOver1 : null

  return (
    <>
      <section className="panel ageing-movement-panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">WEEK-TO-WEEK AGEING</span>
            <h3>Ageing Movement by Bucket</h3>
            <p>Last week compared with the current ageing report.</p>
          </div>
          <span>{previous ? previousDate + ' → ' + currentDate : currentDate}</span>
        </div>

        <div className="ageing-movement-table">
          <div className="ageing-movement-row ageing-movement-head">
            <span>Ageing bucket</span>
            <span>Last week</span>
            <span>This week</span>
            <span>Change</span>
          </div>
          {rows.map((row) => (
            <div className="ageing-movement-row" key={row.key}>
              <strong>{row.label}</strong>
              <span>{previous ? mvr(row.previousValue) : '—'}</span>
              <span>{mvr(row.currentValue)}</span>
              <b className={row.change === null ? '' : row.change > 0 ? 'increase' : row.change < 0 ? 'decrease' : ''}>
                {row.change === null ? '—' : ((row.change > 0 ? '+' : '') + mvr(row.change))}
              </b>
            </div>
          ))}
        </div>
      </section>

      {previous && (
        <section className="ageing-takeaway">
          <div>
            <span className="eyebrow">KEY TAKEAWAY</span>
            <h3>What changed this week?</h3>
          </div>
          <div className="ageing-takeaway-points">
            <p>
              Total on-hand value <b>{onHandChange >= 0 ? 'increased' : 'decreased'} by {mvr(Math.abs(onHandChange))}</b>,
              from {mvr(previousOnHand)} to {mvr(currentOnHand)}.
            </p>
            <p>
              Stock aged over 1 year <b>{over1Change >= 0 ? 'increased' : 'decreased'} by {mvr(Math.abs(over1Change))}</b>,
              from {mvr(previousOver1)} to {mvr(currentOver1)}.
            </p>
            {biggestMovement && (
              <p>
                The largest ageing-bucket movement was <b>{biggestMovement.label}</b> at
                <b> {biggestMovement.change >= 0 ? '+' : '−'}{mvr(Math.abs(biggestMovement.change))}</b>.
              </p>
            )}
            {improvedBuckets.length > 0 && (
              <p>
                Bucket{improvedBuckets.length > 1 ? 's' : ''} showing a reduction:
                <b> {improvedBuckets.map((row) => row.label.split(' — ')[0]).join(', ')}</b>.
              </p>
            )}
          </div>
        </section>
      )}
    </>
  )
}

function ImportPanel({ onApplied, email }) {
  const [source, setSource] = useState('PRF')
  const [file, setFile] = useState(null)
  const [rows, setRows] = useState([])
  const [mapped, setMapped] = useState([])
  const [sheetName, setSheetName] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [lldText, setLldText] = useState('')

  async function chooseFile(event) {
    const next = event.target.files?.[0]
    if (!next) return
    setFile(next)
    setMessage('Reading workbook…')
    try {
      const buffer = await next.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
      const name = workbook.SheetNames[0]
      const sheet = workbook.Sheets[name]
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false })
      const json = normalizeSheetRows(matrix)
      const detected = detectSource(json, next.name, name)
      const sourceToUse = detected || source

      if (detected && detected !== source) setSource(detected)

      setRows(json)
      setMapped(mapRows(sourceToUse, json))
      setSheetName(name)
      setMessage(
        detected && detected !== source
          ? 'Detected ' + humanSource(detected) + ' from the workbook layout.'
          : ''
      )
    } catch (error) {
      setMessage(error.message || 'Could not read the file.')
      setRows([])
      setMapped([])
    }
  }

  useEffect(() => {
    if (rows.length) setMapped(mapRows(source, rows))
  }, [source])

  async function insertBatches(table, records) {
    for (let i = 0; i < records.length; i += 400) {
      const batch = records.slice(i, i + 400)
      const { error } = await supabase.from(table).insert(batch)
      if (error) throw error
    }
  }

  async function applyFile() {
    if (!mapped.length) {
      setMessage('No usable rows were mapped from this file.')
      return
    }
    setBusy(true)
    setMessage('Applying update…')
    try {
      if (['PRF', 'PR', 'PO'].includes(source)) {
        const { error } = await supabase.from('procurement_records').delete().eq('source_type', source)
        if (error) throw error
        await insertBatches('procurement_records', mapped)
      } else if (source === 'PENDING_PAYMENTS') {
        const { error } = await supabase.from('pending_payment_records').delete().neq('po_no', '__never__')
        if (error) throw error
        await insertBatches('pending_payment_records', mapped)
      } else if (source === 'MTR' || source === 'MRN') {
        const { error } = await supabase.from('material_records').delete().eq('document_type', source)
        if (error) throw error
        await insertBatches('material_records', mapped)
      } else if (source === 'SR_ISSUES') {
        const { error } = await supabase.from('sr_issue_records').delete().neq('id', 0)
        if (error) throw error
        await insertBatches('sr_issue_records', mapped)
      } else if (source === 'TRANSACTIONS') {
        const { error } = await supabase.from('inventory_transactions').delete().neq('id', 0)
        if (error) throw error
        await insertBatches('inventory_transactions', mapped)
      } else if (source === 'STOCK') {
        const { error } = await supabase.from('stock_items').delete().neq('item_code', '__never__')
        if (error) throw error
        for (let i = 0; i < mapped.length; i += 400) {
          const { error: upsertError } = await supabase.from('stock_items').upsert(mapped.slice(i, i + 400), { onConflict: 'item_code' })
          if (upsertError) throw upsertError
        }
      } else if (source === 'AGEING') {
        const ageingByItem = new Map()
        for (const row of mapped) {
          const itemCode = String(row.item_code || '').trim()
          if (!itemCode) continue
          ageingByItem.set(itemCode, row)
        }

        const ageingRows = Array.from(ageingByItem.values())

        for (let i = 0; i < ageingRows.length; i += 400) {
          const { error } = await supabase
            .from('stock_items')
            .upsert(ageingRows.slice(i, i + 400), { onConflict: 'item_code' })
          if (error) throw error
        }

        const snapshotMetrics = ageingRows.reduce((totals, row) => {
          totals.itemCount += 1
          totals.onHandQty += rawNumber(row, ['On-hand quantity'])
          totals.onHandValue += rawNumber(row, ['On-hand value'])
          totals.inventoryValue += rawNumber(row, ['Inventory value'])
          totals.p1 += rawNumber(row, ['P1:Amount'])
          totals.p2 += rawNumber(row, ['P2:Amount'])
          totals.p3 += rawNumber(row, ['P3:Amount'])
          totals.p4 += rawNumber(row, ['P4:Amount'])
          totals.p5 += rawNumber(row, ['P5:Amount'])
          return totals
        }, {
          kind: 'AGEING',
          itemCount: 0,
          onHandQty: 0,
          onHandValue: 0,
          inventoryValue: 0,
          p1: 0,
          p2: 0,
          p3: 0,
          p4: 0,
          p5: 0,
        })
        snapshotMetrics.over1 = snapshotMetrics.p2 + snapshotMetrics.p3 + snapshotMetrics.p4 + snapshotMetrics.p5

        const snapshotDate = new Date().toISOString().slice(0, 10)
        const { data: sameDaySnapshots, error: sameDayError } = await supabase
          .from('weekly_snapshots')
          .select('id, metrics')
          .eq('snapshot_date', snapshotDate)
        if (sameDayError) throw sameDayError

        const existingAgeing = (sameDaySnapshots || []).find((s) => s.metrics?.kind === 'AGEING')
        const snapshotRecord = {
          snapshot_date: snapshotDate,
          label: 'Inventory Ageing — ' + (file?.name || snapshotDate),
          metrics: snapshotMetrics,
          priority_cases: [],
          created_by: email,
        }

        if (existingAgeing) {
          const { error: snapshotError } = await supabase
            .from('weekly_snapshots')
            .update(snapshotRecord)
            .eq('id', existingAgeing.id)
          if (snapshotError) throw snapshotError
        } else {
          const { error: snapshotError } = await supabase
            .from('weekly_snapshots')
            .insert(snapshotRecord)
          if (snapshotError) throw snapshotError
        }
      }

      const { error: historyError } = await supabase.from('source_updates').insert({
        source_type: source,
        file_name: file?.name || '',
        source_date: file?.lastModified ? new Date(file.lastModified).toISOString().slice(0, 10) : null,
        row_count: rows.length,
        new_count: mapped.length,
        changed_count: 0,
        unchanged_count: Math.max(0, rows.length - mapped.length),
        unmatched_count: Math.max(0, rows.length - mapped.length),
        imported_by: email,
      })
      if (historyError) throw historyError

      setMessage('Update applied successfully.')
      await onApplied()
    } catch (error) {
      setMessage(error.message || 'Update failed.')
    } finally {
      setBusy(false)
    }
  }

  async function applyLld() {
    const lines = lldText.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    const records = []
    for (const line of lines) {
      const parts = line.split(/\t|\||,/).map((x) => x.trim())
      if (!parts[0] || lower(parts[0]).includes('reference')) continue
      const reference = parts[0]
      const upper = reference.toUpperCase()
      const referenceType =
        upper.startsWith('PO') ? 'PO' :
        upper.startsWith('PR') ? 'PR' :
        upper.startsWith('MTR') ? 'MTR' :
        upper.startsWith('MRN') ? 'MRN' : 'OTHER'
      records.push({
        reference_type: referenceType,
        reference_no: reference,
        payment_status: parts[1] || null,
        delivery_status: parts[2] || null,
        eta: parts[3] || null,
        update_text: parts.slice(4).join(' | ') || null,
        source_date: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      })
    }
    if (!records.length) {
      setMessage('No LLD rows detected.')
      return
    }
    setBusy(true)
    const { error } = await supabase.from('lld_updates').upsert(records, { onConflict: 'reference_type,reference_no' })
    if (!error) {
      await supabase.from('source_updates').insert({
        source_type: 'LLD',
        file_name: 'Pasted LLD update',
        row_count: records.length,
        new_count: records.length,
        imported_by: email,
      })
      setLldText('')
      setMessage('LLD updates applied.')
      await onApplied()
    } else {
      setMessage(error.message)
    }
    setBusy(false)
  }

  return (
    <div className="updates-grid">
      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">ERP / FORM SOURCE</span>
            <h3>Upload source file</h3>
          </div>
        </div>

        <label>
          What are you uploading?
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCE_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>

        <label className="file-drop">
          <strong>Choose Excel or CSV file</strong>
          <span>.xlsx, .xls or .csv</span>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={chooseFile} />
        </label>

        {file && (
          <div className="import-summary">
            <span><b>File</b>{file.name}</span>
            <span><b>Sheet</b>{sheetName || '—'}</span>
            <span><b>Rows found</b>{rows.length}</span>
            <span><b>Rows mapped</b>{mapped.length}</span>
          </div>
        )}

        {rows.length > 0 && (
          <div className="preview-box">
            <div className="preview-head">
              <strong>Preview</strong>
              <span>First 5 rows</span>
            </div>
            <pre>{JSON.stringify(rows.slice(0, 5), null, 2)}</pre>
          </div>
        )}

        <button className="primary full" disabled={!mapped.length || busy} onClick={applyFile}>
          {busy ? 'Applying…' : 'Apply update'}
        </button>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <span className="eyebrow">LLD UPDATE</span>
            <h3>Paste payment / delivery update</h3>
          </div>
        </div>
        <p className="muted small">
          One line per reference: <b>PO number | payment status | delivery status | ETA | note</b>
        </p>
        <textarea
          className="lld-box"
          rows={13}
          value={lldText}
          onChange={(e) => setLldText(e.target.value)}
          placeholder={'PO012345 | Advance Pending | Awaiting dispatch | 2026-10-15 | Supplier follow-up'}
        />
        <button className="primary full" disabled={!lldText.trim() || busy} onClick={applyLld}>Apply LLD update</button>
      </section>

      {message && <div className="notice span-all">{message}</div>}
    </div>
  )
}

function PasswordRecovery() {
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function save(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      setMessage(error.message)
      return
    }

    setMessage('Password updated successfully. You can now continue to the portal.')
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <span className="eyebrow">PASSWORD RESET</span>
        <h2>Set a new password</h2>
        <form onSubmit={save}>
          <label>
            New password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
          </label>
          <button className="primary" disabled={loading}>
            {loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
        {message && <p className="notice">{message}</p>}
      </section>
    </main>
  )
}

export default function App() {
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)
  const [recoveringPassword, setRecoveringPassword] = useState(false)
  const [access, setAccess] = useState(null)
  const [view, setView] = useState('home')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({
    procurement: [],
    material: [],
    stock: [],
    transactions: [],
    srIssues: [],
    lld: [],
    notes: [],
    sourceUpdates: [],
    snapshots: [],
    pendingPayments: [],
    erpPrHeaders: [],
  })
  const [loaded, setLoaded] = useState({
    procurement: false,
    material: false,
    stock: false,
    transactions: false,
    srIssues: false,
    lld: false,
    notes: false,
    sourceUpdates: false,
    snapshots: false,
    pendingPayments: false,
    erpPrHeaders: false,
  })
  const [homeSummary, setHomeSummary] = useState({
    prf_count: 0,
    mrn_count: 0,
    pending_count: 0,
    stock_value: 0,
    aged_value: 0,
  })
  const [homeDashboard, setHomeDashboard] = useState({
    pendingPayments: [],
    topStock: [],
    topQuantity: [],
    lowStock: [],
    recentUpdates: [],
    activityUpdates: [],
    issueCountMonth: 0,
    ageing: null,
    prsSubmitted: 0,
    prsReceived: 0,
    totalItems: 0,
    lowStockItems: 0,
    outOfStockItems: 0,
  })
  const [noteState, setNoteState] = useState(null)
  const [vesselSearch, setVesselSearch] = useState('')
  const [slide, setSlide] = useState(0)
  const [prfStatusFilter, setPrfStatusFilter] = useState('ALL')
  const [prfWeekFilter, setPrfWeekFilter] = useState('ALL')
  const [prPoWeekFilter, setPrPoWeekFilter] = useState('ALL')
  const [prPoReceiptWeekFilter, setPrPoReceiptWeekFilter] = useState(() => weekStartWednesday(new Date().toISOString().slice(0, 10)))
  const [prPoAgeFilter, setPrPoAgeFilter] = useState('ALL')
  const [prPoUrgentFilter, setPrPoUrgentFilter] = useState(false)
  const [prPoReceiptPendingFilter, setPrPoReceiptPendingFilter] = useState(false)
  const [prPoPaymentPendingFilter, setPrPoPaymentPendingFilter] = useState(false)
  const [pendingPaymentDetailFilter, setPendingPaymentDetailFilter] = useState('ALL')
  const [overviewFromDraft, setOverviewFromDraft] = useState(() => {
    const today = new Date().toISOString().slice(0, 10)
    return today.slice(0, 7) + '-01'
  })
  const [overviewToDraft, setOverviewToDraft] = useState(() => new Date().toISOString().slice(0, 10))
  const [overviewFrom, setOverviewFrom] = useState(() => {
    const today = new Date().toISOString().slice(0, 10)
    return today.slice(0, 7) + '-01'
  })
  const [overviewTo, setOverviewTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [mtrWeekFilter, setMtrWeekFilter] = useState('ALL')
  const [mtrControlFilter, setMtrControlFilter] = useState('ALL')
  const [mtrStatusFilter, setMtrStatusFilter] = useState('ALL')
  const [mtrDeliveryFilter, setMtrDeliveryFilter] = useState('ALL')
  const [mrnWeekFilter, setMrnWeekFilter] = useState('ALL')
  const [mrnControlFilter, setMrnControlFilter] = useState('ALL')
  const [mrnStatusFilter, setMrnStatusFilter] = useState('ALL')
  const [mrnWorkshopFilter, setMrnWorkshopFilter] = useState('ALL')
  const [mrnWpTypeFilter, setMrnWpTypeFilter] = useState('ALL')
  const [srIssueFilter, setSrIssueFilter] = useState('ALL')
  const [srIssueWeekFilter, setSrIssueWeekFilter] = useState(() => weekStartWednesday(new Date().toISOString().slice(0, 10)))
  const [stockAgeFilter, setStockAgeFilter] = useState('ALL')
  const [warehouseMrnWeekFilter, setWarehouseMrnWeekFilter] = useState(() => addDaysIso(weekStartWednesday(new Date().toISOString().slice(0, 10)), -7))
  const [warehouseReceiptDetail, setWarehouseReceiptDetail] = useState('NONE')
  const [warehouseFullscreen, setWarehouseFullscreen] = useState(false)
  const [inventorySlide, setInventorySlide] = useState(0)
  const [inventoryFullscreen, setInventoryFullscreen] = useState(false)
  const [warehouseIssueWeekFilter, setWarehouseIssueWeekFilter] = useState(() => addDaysIso(weekStartWednesday(new Date().toISOString().slice(0, 10)), -7))
  const [warehouseIssueDetailOpen, setWarehouseIssueDetailOpen] = useState(false)

  const canEdit = access && ['admin', 'editor'].includes(lower(access.role))
  const isAdmin = access && lower(access.role) === 'admin'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecking(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      setChecking(false)
      if (event === 'PASSWORD_RECOVERY') setRecoveringPassword(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement)
      setWarehouseFullscreen(active && document.fullscreenElement?.id === 'warehouse-presentation-shell')
      setInventoryFullscreen(active && document.fullscreenElement?.id === 'inventory-presentation-shell')
    }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  async function checkAccess() {
    if (!session?.user?.email) return
    const { data: rows } = await supabase
      .from('portal_access')
      .select('*')
      .eq('email', session.user.email)
      .limit(1)
    setAccess(rows?.[0] ?? false)
  }

  useEffect(() => {
    if (session) checkAccess()
    else setAccess(null)
  }, [session?.user?.id])

  const TABLE_CONFIG = {
    procurement: ['procurement_records', 'updated_at', false],
    material: ['material_records', 'updated_at', false],
    stock: ['stock_items', 'item_code', true],
    transactions: ['inventory_transactions', 'physical_date', false],
    srIssues: ['sr_issue_records', 'requested_receipt_date', false],
    lld: ['lld_updates', 'updated_at', false],
    notes: ['case_notes', 'updated_at', false],
    sourceUpdates: ['source_updates', 'imported_at', false],
    snapshots: ['weekly_snapshots', 'snapshot_date', false],
    pendingPayments: ['pending_payment_records', 'po_date', false],
    erpPrHeaders: ['erp_pr_headers', 'created_at', false],
  }

  const VIEW_TABLES = {
    home: [],
    overview: ['procurement', 'material', 'srIssues', 'sourceUpdates', 'snapshots', 'pendingPayments'],
    prf: ['procurement', 'lld', 'notes'],
    prpo: ['procurement', 'lld', 'notes', 'erpPrHeaders'],
    payments: ['pendingPayments'],
    mtr: ['material', 'notes'],
    mrn: ['material', 'srIssues', 'transactions', 'notes'],
    vessel: ['procurement', 'material', 'transactions', 'srIssues', 'lld'],
    stock: ['stock', 'snapshots'],
    updates: ['sourceUpdates'],
    warehouse: ['procurement', 'material', 'srIssues', 'transactions'],
    inventoryPresentation: ['procurement', 'material', 'pendingPayments', 'stock', 'snapshots', 'transactions'],
    history: ['sourceUpdates', 'snapshots'],
  }

  async function loadHomeSummary() {
    const today = new Date().toISOString().slice(0, 10)
    const monthStart = today.slice(0, 7) + '-01'

    const [
      summaryResult,
      paymentsResult,
      stockValueResult,
      stockQtyResult,
      lowStockResult,
      updatesResult,
      issuesResult,
      ageingResult,
      homePrResult,
      totalItemsResult,
      lowStockCountResult,
      outOfStockCountResult,
    ] = await Promise.all([
      supabase.from('portal_home_summary').select('*').limit(1),
      supabase
        .from('pending_payment_records')
        .select('po_no,po_date,supplier,status,priority,po_value')
        .order('po_value', { ascending: false }),
      supabase
        .from('stock_items')
        .select('item_code,item_description,on_hand,stock_value')
        .order('stock_value', { ascending: false })
        .limit(6),
      supabase
        .from('stock_items')
        .select('item_code,item_description,on_hand,stock_value')
        .gt('on_hand', 0)
        .order('on_hand', { ascending: false })
        .limit(6),
      supabase
        .from('home_high_consumption_stock')
        .select('item_code,item_description,on_hand,available,stock_value,consumption_value,consumption_rank')
        .gt('on_hand', 0)
        .lte('on_hand', 5)
        .order('consumption_rank', { ascending: true })
        .limit(7),
      supabase
        .from('source_updates')
        .select('source_type,file_name,row_count,imported_at')
        .order('imported_at', { ascending: false })
        .limit(60),
      supabase
        .from('sr_issue_records')
        .select('id', { count: 'exact', head: true })
        .gte('requested_receipt_date', monthStart)
        .lte('requested_receipt_date', today),
      supabase
        .from('weekly_snapshots')
        .select('snapshot_date,label,metrics')
        .order('snapshot_date', { ascending: false })
        .limit(10),
      supabase
        .from('procurement_records')
        .select('pr_no,pr_date,qty_received,raw_source,source_type')
        .in('source_type', ['PR', 'PO'])
        .gte('pr_date', monthStart)
        .lte('pr_date', today),
      supabase
        .from('stock_items')
        .select('item_code', { count: 'exact', head: true }),
      supabase
        .from('home_high_consumption_stock')
        .select('item_code', { count: 'exact', head: true })
        .gt('on_hand', 0)
        .lte('on_hand', 5),
      supabase
        .from('home_high_consumption_stock')
        .select('item_code', { count: 'exact', head: true })
        .lte('on_hand', 0),
    ])

    if (summaryResult.error) throw summaryResult.error
    if (summaryResult.data?.[0]) setHomeSummary(summaryResult.data[0])

    const activityUpdates = updatesResult.data || []
    const homePrRows = homePrResult.data || []
    const submittedPrs = new Set(
      homePrRows.map((row) => String(row.pr_no || '').trim()).filter(Boolean),
    )
    const receivedPrs = new Set(
      homePrRows
        .filter((row) => receivedQty(row) > 0)
        .map((row) => String(row.pr_no || '').trim())
        .filter(Boolean),
    )

    setHomeDashboard({
      pendingPayments: paymentsResult.data || [],
      topStock: stockValueResult.data || [],
      topQuantity: stockQtyResult.data || [],
      lowStock: lowStockResult.data || [],
      recentUpdates: activityUpdates.slice(0, 6),
      activityUpdates,
      issueCountMonth: issuesResult.count || 0,
      ageing: (ageingResult.data || []).find((row) => row.metrics?.kind === 'AGEING') || null,
      prsSubmitted: submittedPrs.size,
      prsReceived: receivedPrs.size,
      totalItems: totalItemsResult.count || 0,
      lowStockItems: lowStockCountResult.count || 0,
      outOfStockItems: outOfStockCountResult.count || 0,
    })
  }

  async function loadTables(keys, force = false) {
    const wanted = [...new Set(keys)].filter((key) => TABLE_CONFIG[key] && (force || !loaded[key]))
    if (!wanted.length) return

    const results = await Promise.all(wanted.map(async (key) => {
      const [table, orderColumn, ascending] = TABLE_CONFIG[key]
      const rows = await fetchAllRows(table, orderColumn, ascending)
      return [key, rows]
    }))

    setData((current) => {
      const next = { ...current }
      for (const [key, rows] of results) next[key] = rows
      return next
    })
    setLoaded((current) => {
      const next = { ...current }
      for (const [key] of results) next[key] = true
      return next
    })
  }

  async function loadForView(targetView = view, force = false) {
    if (!session || !access) return
    setLoading(true)
    try {
      if (targetView === 'home') {
        await loadHomeSummary()
      } else {
        await loadTables(VIEW_TABLES[targetView] || [], force)
      }
    } catch (error) {
      console.error('Failed to load portal data', error)
    } finally {
      setLoading(false)
    }
  }

  async function refreshCurrentView() {
    if (view === 'home') {
      setLoading(true)
      try {
        await loadHomeSummary()
      } catch (error) {
        console.error('Failed to refresh home summary', error)
      } finally {
        setLoading(false)
      }
      return
    }
    await loadForView(view, true)
  }

  useEffect(() => {
    if (!access) return
    loadForView(view)
  }, [access?.email, view])


  const noteMap = useMemo(
    () => new Map(data.notes.map((n) => [n.entity_type + '|' + n.entity_key, n])),
    [data.notes],
  )

  const lldMap = useMemo(
    () => new Map(data.lld.map((x) => [String(x.reference_no || '').toUpperCase(), x])),
    [data.lld],
  )

  const procurementData = useMemo(
    () => data.procurement.map((row) => {
      const reference = row.po_no || row.pr_no || row.prf_no
      const update = reference ? lldMap.get(String(reference).toUpperCase()) : null
      if (!update) return row
      return {
        ...row,
        payment_status: update.payment_status || row.payment_status,
        delivery_status: update.delivery_status || row.delivery_status,
        expected_delivery: update.eta || row.expected_delivery,
        lld_update: update.update_text || '',
      }
    }),
    [data.procurement, lldMap],
  )

  async function toggleWarehouseFullscreen() {
    const target = document.getElementById('warehouse-presentation-shell')
    if (!target) return

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (target.requestFullscreen) {
        await target.requestFullscreen()
      }
    } catch (error) {
      console.error('Could not toggle presentation fullscreen', error)
    }
  }

  async function toggleInventoryFullscreen() {
    const target = document.getElementById('inventory-presentation-shell')
    if (!target) return

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
      } else if (target.requestFullscreen) {
        await target.requestFullscreen()
      }
    } catch (error) {
      console.error('Could not toggle inventory presentation fullscreen', error)
    }
  }

  function openNote(type, row) {
    setNoteState({ type, row, key: entityKey(type, row) })
  }

  async function saveNote(form) {
    if (!noteState) return
    const payload = {
      entity_type: noteState.type,
      entity_key: noteState.key,
      ...form,
      deadline: form.deadline || null,
      eta: form.eta || null,
      updated_by: session.user.email,
      updated_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('case_notes').upsert(payload, { onConflict: 'entity_type,entity_key' })
    if (!error) {
      setNoteState(null)
      await loadTables(['notes'], true)
    }
  }

  function selectPrfWeek(weekStart) {
    setPrfWeekFilter(weekStart)
    setPrfStatusFilter('ALL')
  }

  function selectPrPoWeek(weekStart) {
    setPrPoWeekFilter(weekStart)
    setPrPoAgeFilter('ALL')
    setPrPoUrgentFilter(false)
    setPrPoReceiptPendingFilter(false)
    setPrPoPaymentPendingFilter(false)
  }

  function selectPrPoReceiptWeek(weekStart) {
    setPrPoReceiptWeekFilter(weekStart)
  }

  function selectPrPoAge(ageBand) {
    if (ageBand === 'ALL') {
      setPrPoAgeFilter('ALL')
      return
    }
    setPrPoAgeFilter((current) => current === ageBand ? 'ALL' : ageBand)
    setPrPoWeekFilter('ALL')
    setPrPoUrgentFilter(false)
    setPrPoReceiptPendingFilter(false)
    setPrPoPaymentPendingFilter(false)
  }

  function togglePrPoUrgent() {
    setPrPoUrgentFilter((current) => !current)
    setPrPoAgeFilter('ALL')
    setPrPoReceiptPendingFilter(false)
    setPrPoPaymentPendingFilter(false)
  }

  function togglePrPoReceiptPending() {
    setPrPoReceiptPendingFilter((current) => !current)
    setPrPoAgeFilter('ALL')
    setPrPoUrgentFilter(false)
    setPrPoPaymentPendingFilter(false)
  }

  function togglePrPoPaymentPending() {
    setPrPoPaymentPendingFilter((current) => !current)
    setPrPoAgeFilter('ALL')
    setPrPoUrgentFilter(false)
    setPrPoReceiptPendingFilter(false)
  }

  function selectMtrWeek(weekStart) {
    setMtrWeekFilter(weekStart)
    setMtrControlFilter('ALL')
    setMtrStatusFilter('ALL')
    setMtrDeliveryFilter('ALL')
  }

  function selectMtrControl(filter) {
    setMtrControlFilter((current) => current === filter ? 'ALL' : filter)
    setMtrStatusFilter('ALL')
    setMtrDeliveryFilter('ALL')
  }

  function selectMtrStatus(status) {
    setMtrStatusFilter((current) => current === status ? 'ALL' : status)
    setMtrControlFilter('ALL')
    setMtrDeliveryFilter('ALL')
  }

  function selectMtrDelivery(status) {
    setMtrDeliveryFilter((current) => current === status ? 'ALL' : status)
    setMtrControlFilter('ALL')
    setMtrStatusFilter('ALL')
  }

  function selectMrnWeek(weekStart) {
    setMrnWeekFilter(weekStart)
    setMrnControlFilter('ALL')
    setMrnStatusFilter('ALL')
    setMrnWorkshopFilter('ALL')
    setMrnWpTypeFilter('ALL')
  }

  function selectMrnControl(filter) {
    setMrnControlFilter((current) => current === filter ? 'ALL' : filter)
    setMrnStatusFilter('ALL')
    setMrnWorkshopFilter('ALL')
    setMrnWpTypeFilter('ALL')
  }

  function selectMrnStatus(status) {
    const normalizedStatus = mrnStatusDisplay(status)
    setMrnStatusFilter((current) => current === normalizedStatus ? 'ALL' : normalizedStatus)
    setMrnControlFilter('ALL')
    setMrnWorkshopFilter('ALL')
    setMrnWpTypeFilter('ALL')
  }

  function selectMrnWorkshop(workshop) {
    setMrnWorkshopFilter((current) => current === workshop ? 'ALL' : workshop)
    setMrnControlFilter('ALL')
    setMrnStatusFilter('ALL')
    setMrnWpTypeFilter('ALL')
  }

  function selectMrnWpType(wpType) {
    setMrnWpTypeFilter((current) => current === wpType ? 'ALL' : wpType)
    setMrnControlFilter('ALL')
    setMrnStatusFilter('ALL')
    setMrnWorkshopFilter('ALL')
  }

  const query = lower(search).trim()
  const matches = (row) => !query ||
    Object.values(row).some((v) => typeof v !== 'object' && lower(v).includes(query)) ||
    (row?.raw_source && lower(Object.values(row.raw_source).join(' ')).includes(query))

  const allPrfRows = useMemo(
    () => procurementData.filter((r) => r.source_type === 'PRF'),
    [procurementData],
  )

  const weekFilteredPrfRows = useMemo(
    () => allPrfRows.filter((row) =>
      prfWeekFilter === 'ALL' || weekStartWednesday(row.pr_date) === prfWeekFilter
    ),
    [allPrfRows, prfWeekFilter],
  )

  const overallPrfStatusCounts = useMemo(() => {
    const counts = new Map()
    allPrfRows.forEach((row) => {
      const status = prfStatusLabel(row.status)
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [allPrfRows])

  const prfStatusCounts = useMemo(() => {
    const counts = new Map()
    weekFilteredPrfRows.forEach((row) => {
      const status = prfStatusLabel(row.status)
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [weekFilteredPrfRows])

  const prfWeekCounts = useMemo(() => {
    const counts = new Map()
    allPrfRows.forEach((row) => {
      const weekStart = weekStartWednesday(row.pr_date)
      if (weekStart) counts.set(weekStart, (counts.get(weekStart) || 0) + 1)
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        count: counts.get(weekStart) || 0,
      }
    })
  }, [allPrfRows])

  const prfRows = useMemo(
    () => weekFilteredPrfRows.filter((r) =>
      matches(r) &&
      (prfStatusFilter === 'ALL' || prfStatusLabel(r.status) === prfStatusFilter)
    ),
    [weekFilteredPrfRows, query, prfStatusFilter],
  )
  const allPrPoRows = useMemo(
    () => procurementData.filter((r) => ['PR', 'PO'].includes(r.source_type) && isUsefulPrPoRow(r)),
    [procurementData],
  )

  const allPrLines = useMemo(
    () => procurementData.filter((r) =>
      r.source_type === 'PR' &&
      !isPlaceholderValue(r.pr_no, true) &&
      isUsefulPrPoRow(r)
    ),
    [procurementData],
  )

  const erpPrHeaders = data.erpPrHeaders || []

  const prPoWeekCounts = useMemo(() => {
    const weekSets = new Map()
    const sourceRows = erpPrHeaders.length ? erpPrHeaders : allPrLines

    sourceRows.forEach((row) => {
      const date = erpPrHeaders.length
        ? parseFlexibleDate(row.created_at || row.created_at_raw)
        : prSubmittedDate(row)
      const weekStart = weekStartWednesday(date)
      const prNo = String(erpPrHeaders.length ? row.purch_req_id : row.pr_no || '').trim()
      if (!weekStart || !prNo) return
      if (!weekSets.has(weekStart)) weekSets.set(weekStart, new Set())
      weekSets.get(weekStart).add(prNo)
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        count: weekSets.get(weekStart)?.size || 0,
      }
    })
  }, [erpPrHeaders, allPrLines])

  const prPoReceiptWeekCounts = useMemo(() => {
    const weekMap = new Map()
    allPrLines.forEach((row) => {
      const date = receivedDate(row)
      const qty = receivedQty(row)
      if (!date || qty <= 0) return
      const weekStart = weekStartWednesday(date)
      if (!weekMap.has(weekStart)) weekMap.set(weekStart, { lines: 0, prs: new Set(), qty: 0 })
      const item = weekMap.get(weekStart)
      item.lines += 1
      item.qty += qty
      if (row.pr_no) item.prs.add(String(row.pr_no).trim())
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      const item = weekMap.get(weekStart)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        lines: item?.lines || 0,
        prs: item?.prs?.size || 0,
        qty: item?.qty || 0,
      }
    })
  }, [allPrLines])

  const weekFilteredPrLines = useMemo(
    () => allPrLines.filter((row) =>
      prPoWeekFilter === 'ALL' || weekStartWednesday(prSubmittedDate(row)) === prPoWeekFilter
    ),
    [allPrLines, prPoWeekFilter],
  )

  const erpPrSubmissionRows = useMemo(
    () => erpPrHeaders.filter((row) => {
      if (!matches(row)) return false
      if (prPoWeekFilter === 'ALL') return true
      const submitted = parseFlexibleDate(row.created_at || row.created_at_raw)
      return weekStartWednesday(submitted) === prPoWeekFilter
    }),
    [erpPrHeaders, query, prPoWeekFilter],
  )

  const prSubmissionLineRows = useMemo(
    () => weekFilteredPrLines.filter((row) => matches(row)),
    [weekFilteredPrLines, query],
  )

  const legacyPrSubmissionRows = useMemo(() => {
    const uniquePrs = new Map()
    prSubmissionLineRows.forEach((row) => {
      const prNo = String(row.pr_no || '').trim()
      if (!prNo || uniquePrs.has(prNo)) return
      uniquePrs.set(prNo, row)
    })
    return Array.from(uniquePrs.values())
  }, [prSubmissionLineRows])

  const prSubmissionRows = erpPrHeaders.length ? erpPrSubmissionRows : legacyPrSubmissionRows

  const prSubmissionCounts = useMemo(() => ({
    prs: prSubmissionRows.length,
    lines: erpPrHeaders.length ? null : prSubmissionLineRows.length,
  }), [prSubmissionRows, erpPrHeaders.length, prSubmissionLineRows])

  const prPoAgeing = useMemo(() => {
    const prMap = new Map()

    allPrLines.forEach((row) => {
      const prNo = String(row.pr_no || '').trim()
      if (!prNo) return

      if (!prMap.has(prNo)) {
        prMap.set(prNo, {
          prNo,
          requested: 0,
          received: 0,
          submitted: null,
          lineCount: 0,
          fullLines: 0,
          activeLines: 0,
        })
      }

      const item = prMap.get(prNo)
      const requested = requestedQty(row)
      const received = Math.min(requested > 0 ? requested : Number.MAX_SAFE_INTEGER, receivedQty(row))
      const state = receiptState(row)
      const status = lower(row.status)

      item.requested += requested
      item.received += received
      item.lineCount += 1
      if (state === 'full') item.fullLines += 1
      if (!status.includes('cancel') && !status.includes('reject')) item.activeLines += 1

      const dateIso = prSubmittedDate(row)
      if (dateIso) {
        const d = new Date(dateIso + 'T12:00:00')
        if (!Number.isNaN(d.valueOf()) && (!item.submitted || d < item.submitted)) item.submitted = d
      }
    })

    const now = new Date()
    const threeMonthsAgo = new Date(now)
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3)
    const sixMonthsAgo = new Date(now)
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)

    const agedThreeToSixPrNos = new Set()
    const agedSixPlusPrNos = new Set()
    let oldestOpenDays = 0

    for (const p of prMap.values()) {
      const fullyReceived =
        (p.requested > 0 && p.received >= p.requested) ||
        (p.lineCount > 0 && p.fullLines === p.lineCount)
      if (p.activeLines <= 0 || fullyReceived || !p.submitted) continue

      const days = Math.max(0, Math.floor((now - p.submitted) / 86400000))
      oldestOpenDays = Math.max(oldestOpenDays, days)

      if (p.submitted <= sixMonthsAgo) agedSixPlusPrNos.add(p.prNo)
      else if (p.submitted <= threeMonthsAgo) agedThreeToSixPrNos.add(p.prNo)
    }

    return {
      agedThreeToSix: agedThreeToSixPrNos.size,
      agedSixPlus: agedSixPlusPrNos.size,
      oldestOpenDays,
      agedThreeToSixPrNos,
      agedSixPlusPrNos,
    }
  }, [allPrLines])

  const isUrgentPendingRow = (row) => {
    if (!isUrgent(row.priority)) return false
    const requested = requestedQty(row)
    const received = receivedQty(row)
    const status = lower([row.status, row.delivery_status].filter(Boolean).join(' '))
    const closedByStatus = isClosed(status)
    const fullyReceived = requested > 0 && received >= requested
    return !closedByStatus && !fullyReceived
  }

  const isReceiptNotDoneRow = (row) => {
    const poNo = String(row.po_no || '').trim()
    if (!poNo || isPlaceholderValue(poNo, true)) return false

    const status = lower([
      row.status,
      row.delivery_status,
      rawField(row, ['PO ERP Status']),
    ].filter(Boolean).join(' '))

    if (status.includes('cancel') || status.includes('reject')) return false

    return receivedQty(row) <= 0
  }

  const isPendingPaymentRow = (row) => {
    const poNo = String(row.po_no || '').trim()
    if (!poNo || isPlaceholderValue(poNo, true)) return false

    const payment = lower(row.payment_status || rawField(row, ['Payment Status', 'Payment']))
    if (!payment) return false
    if (/(paid|completed|complete|settled|released)/.test(payment)) return false

    return (
      payment.includes('pending') ||
      payment.includes('payment request sent') ||
      payment.includes('payment requested') ||
      payment.includes('request sent')
    )
  }

  const pendingPaymentRows = useMemo(
    () => allPrPoRows.filter(isPendingPaymentRow),
    [allPrPoRows],
  )

  const pendingPaymentPoCount = useMemo(
    () => new Set(pendingPaymentRows.map((row) => String(row.po_no || '').trim()).filter(Boolean)).size,
    [pendingPaymentRows],
  )

  const prpoRows = useMemo(
    () => allPrPoRows.filter((row) => {
      if (!matches(row)) return false
      if (prPoWeekFilter !== 'ALL' && (weekStartWednesday(prSubmittedDate(row)) !== prPoWeekFilter)) return false

      const prNo = String(row.pr_no || '').trim()
      if (prPoAgeFilter === '3TO6' && !prPoAgeing.agedThreeToSixPrNos.has(prNo)) return false
      if (prPoAgeFilter === '6PLUS' && !prPoAgeing.agedSixPlusPrNos.has(prNo)) return false
      if (prPoUrgentFilter && !isUrgentPendingRow(row)) return false
      if (prPoReceiptPendingFilter && !isReceiptNotDoneRow(row)) return false

      return true
    }),
    [allPrPoRows, query, prPoWeekFilter, prPoAgeFilter, prPoUrgentFilter, prPoReceiptPendingFilter, prPoAgeing],
  )

  const prPoVisibleCounts = useMemo(() => ({
    prs: new Set(prpoRows.map((r) => r.pr_no).filter((v) => !isPlaceholderValue(v, true))).size,
    lines: prpoRows.length,
  }), [prpoRows])

  const allMtrRows = useMemo(
    () => data.material.filter((r) => r.document_type === 'MTR'),
    [data.material],
  )

  const mtrWeekCounts = useMemo(() => {
    const weekSets = new Map()
    allMtrRows.forEach((row) => {
      const weekStart = weekStartWednesday(mtrRequestDate(row))
      const mtrNo = String(row.document_no || '').trim()
      if (!weekStart || !mtrNo) return
      if (!weekSets.has(weekStart)) weekSets.set(weekStart, new Set())
      weekSets.get(weekStart).add(mtrNo)
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        count: weekSets.get(weekStart)?.size || 0,
      }
    })
  }, [allMtrRows])

  const weekFilteredMtrRows = useMemo(
    () => allMtrRows.filter((row) =>
      mtrWeekFilter === 'ALL' || weekStartWednesday(mtrRequestDate(row)) === mtrWeekFilter
    ),
    [allMtrRows, mtrWeekFilter],
  )

  const mtrSummary = useMemo(() => {
    const mtrMap = new Map()
    let requestedQty = 0
    let transferredQty = 0
    let remainingQty = 0
    let pendingNoStock = 0
    let aged30 = 0

    weekFilteredMtrRows.forEach((row) => {
      const mtrNo = String(row.document_no || '').trim()
      const requested = mtrRequestedQty(row)
      const transferred = mtrTransferredQty(row)
      const remaining = mtrRemainingQty(row)
      const pending = remaining > 0 || (requested > 0 && transferred < requested)

      requestedQty += requested
      transferredQty += transferred
      remainingQty += remaining

      if (pending && !mtrStockAvailable(row)) pendingNoStock += 1

      const age = mtrAgeDays(row)
      if (pending && age >= 30) aged30 += 1

      if (!mtrNo) return
      if (!mtrMap.has(mtrNo)) {
        mtrMap.set(mtrNo, { requested: 0, transferred: 0, remaining: 0, lines: 0 })
      }
      const item = mtrMap.get(mtrNo)
      item.requested += requested
      item.transferred += transferred
      item.remaining += remaining
      item.lines += 1
    })

    const fullyTransferredMtrs = new Set()
    const partiallyTransferredMtrs = new Set()
    const notTransferredMtrs = new Set()

    for (const [mtrNo, m] of mtrMap.entries()) {
      if (m.requested > 0 && m.remaining <= 0 && m.transferred >= m.requested) {
        fullyTransferredMtrs.add(mtrNo)
      } else if (m.transferred > 0 && m.remaining > 0) {
        partiallyTransferredMtrs.add(mtrNo)
      } else if (m.requested > 0 && m.transferred <= 0 && m.remaining > 0) {
        notTransferredMtrs.add(mtrNo)
      }
    }

    return {
      totalMtrs: mtrMap.size,
      fullyTransferred: fullyTransferredMtrs.size,
      partiallyTransferred: partiallyTransferredMtrs.size,
      notTransferred: notTransferredMtrs.size,
      fullyTransferredMtrs,
      partiallyTransferredMtrs,
      notTransferredMtrs,
      requestedQty,
      transferredQty,
      remainingQty,
      pendingNoStock,
      aged30,
    }
  }, [weekFilteredMtrRows])

  const mtrStatusCounts = useMemo(() => {
    const counts = new Map()
    weekFilteredMtrRows.forEach((row) => {
      const status = String(row.status || '').trim() || 'BLANK'
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [weekFilteredMtrRows])

  const mtrDeliveryCounts = useMemo(() => {
    const counts = new Map()
    weekFilteredMtrRows.forEach((row) => {
      const status = mtrDeliveryStatus(row) || 'BLANK'
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [weekFilteredMtrRows])

  const mtrRows = useMemo(
    () => weekFilteredMtrRows.filter((row) => {
      if (!matches(row)) return false

      const requested = mtrRequestedQty(row)
      const transferred = mtrTransferredQty(row)
      const remaining = mtrRemainingQty(row)
      const pending = remaining > 0 || (requested > 0 && transferred < requested)
      const mtrNo = String(row.document_no || '').trim()

      if (mtrControlFilter === 'FULL' && !mtrSummary.fullyTransferredMtrs.has(mtrNo)) return false
      if (mtrControlFilter === 'PARTIAL' && !mtrSummary.partiallyTransferredMtrs.has(mtrNo)) return false
      if (mtrControlFilter === 'NOT_TRANSFERRED' && !mtrSummary.notTransferredMtrs.has(mtrNo)) return false
      if (mtrControlFilter === 'NO_STOCK' && !(pending && !mtrStockAvailable(row))) return false
      if (mtrControlFilter === 'AGE30' && !(pending && mtrAgeDays(row) >= 30)) return false

      const erpStatus = String(row.status || '').trim() || 'BLANK'
      if (mtrStatusFilter !== 'ALL' && erpStatus !== mtrStatusFilter) return false

      const deliveryStatus = mtrDeliveryStatus(row) || 'BLANK'
      if (mtrDeliveryFilter !== 'ALL' && deliveryStatus !== mtrDeliveryFilter) return false

      return true
    }),
    [weekFilteredMtrRows, query, mtrControlFilter, mtrStatusFilter, mtrDeliveryFilter, mtrSummary],
  )

  const mtrVisibleCounts = useMemo(() => ({
    mtrs: new Set(mtrRows.map((r) => r.document_no).filter(Boolean)).size,
    lines: mtrRows.length,
  }), [mtrRows])
  const allMrnRows = useMemo(
    () => data.material.filter((r) => r.document_type === 'MRN'),
    [data.material],
  )

  const mrnWeekCounts = useMemo(() => {
    const counts = new Map()
    allMrnRows.forEach((row) => {
      const weekStart = weekStartWednesday(mrnCreatedDate(row))
      if (!weekStart) return
      counts.set(weekStart, (counts.get(weekStart) || 0) + 1)
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
        count: counts.get(weekStart) || 0,
      }
    })
  }, [allMrnRows])

  const weekFilteredMrnRows = useMemo(
    () => allMrnRows.filter((row) =>
      mrnWeekFilter === 'ALL' || weekStartWednesday(mrnCreatedDate(row)) === mrnWeekFilter
    ),
    [allMrnRows, mrnWeekFilter],
  )

  const mrnSummary = useMemo(() => {
    const issued = new Set()
    const pending = new Set()
    const cancelled = new Set()
    const pending7 = new Set()
    const pending14 = new Set()
    const pending30 = new Set()
    const noJournal = new Set()
    const withJournal = new Set()

    weekFilteredMrnRows.forEach((row) => {
      const sourceId = mrnSourceId(row)
      if (!sourceId) return

      if (mrnIsIssued(row)) issued.add(sourceId)
      if (mrnIsCancelled(row)) cancelled.add(sourceId)

      if (mrnIsPending(row)) {
        pending.add(sourceId)
        const age = mrnAgeDays(row)
        if (age >= 7) pending7.add(sourceId)
        if (age >= 14) pending14.add(sourceId)
        if (age >= 30) pending30.add(sourceId)
        if (!mrnHasJournal(row)) noJournal.add(sourceId)
      }

      if (mrnHasJournal(row)) withJournal.add(sourceId)
    })

    return {
      total: weekFilteredMrnRows.length,
      issued: issued.size,
      cancelled: cancelled.size,
      pending: pending.size,
      pending7: pending7.size,
      pending14: pending14.size,
      pending30: pending30.size,
      noJournal: noJournal.size,
      withJournal: withJournal.size,
      issuedSet: issued,
      cancelledSet: cancelled,
      pendingSet: pending,
      pending7Set: pending7,
      pending14Set: pending14,
      pending30Set: pending30,
      noJournalSet: noJournal,
      withJournalSet: withJournal,
    }
  }, [weekFilteredMrnRows])

  const mrnStatusCounts = useMemo(() => {
    const counts = new Map()
    weekFilteredMrnRows.forEach((row) => {
      const status = mrnStatusLabel(row)
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [weekFilteredMrnRows])

  const mrnWorkshopCounts = useMemo(() => {
    const counts = new Map()
    weekFilteredMrnRows.forEach((row) => {
      const workshop = String(rawField(row, ['WORKSHOP NAME']) || row.workshop || '').trim() || 'BLANK'
      counts.set(workshop, (counts.get(workshop) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [weekFilteredMrnRows])

  const mrnWpTypeCounts = useMemo(() => {
    const counts = new Map()
    weekFilteredMrnRows.forEach((row) => {
      const wpType = mrnWpType(row)
      counts.set(wpType, (counts.get(wpType) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [weekFilteredMrnRows])

  const mrnRows = useMemo(
    () => weekFilteredMrnRows.filter((row) => {
      if (!matches(row)) return false

      const sourceId = mrnSourceId(row)
      if (mrnControlFilter === 'ISSUED' && !mrnSummary.issuedSet.has(sourceId)) return false
      if (mrnControlFilter === 'PENDING' && !mrnSummary.pendingSet.has(sourceId)) return false
      if (mrnControlFilter === 'AGE7' && !mrnSummary.pending7Set.has(sourceId)) return false
      if (mrnControlFilter === 'AGE14' && !mrnSummary.pending14Set.has(sourceId)) return false
      if (mrnControlFilter === 'AGE30' && !mrnSummary.pending30Set.has(sourceId)) return false
      if (mrnControlFilter === 'NO_JOURNAL' && !mrnSummary.noJournalSet.has(sourceId)) return false
      if (mrnControlFilter === 'WITH_JOURNAL' && !mrnSummary.withJournalSet.has(sourceId)) return false

      if (mrnStatusFilter !== 'ALL' && mrnStatusLabel(row) !== mrnStatusFilter) return false

      const workshop = String(rawField(row, ['WORKSHOP NAME']) || row.workshop || '').trim() || 'BLANK'
      if (mrnWorkshopFilter !== 'ALL' && workshop !== mrnWorkshopFilter) return false

      const wpType = mrnWpType(row)
      if (mrnWpTypeFilter !== 'ALL' && wpType !== mrnWpTypeFilter) return false

      return true
    }),
    [
      weekFilteredMrnRows,
      query,
      mrnControlFilter,
      mrnStatusFilter,
      mrnWorkshopFilter,
      mrnWpTypeFilter,
      mrnSummary,
    ],
  )

  const mrnVisibleCounts = useMemo(() => ({
    records: mrnRows.length,
    mrnNumbers: new Set(mrnRows.map((r) => r.document_no).filter(Boolean)).size,
  }), [mrnRows])
  const mrnMatchRecords = useMemo(
    () => allMrnRows.map((row) => ({
      sourceId: mrnSourceId(row),
      mrnNo: String(row.document_no || '').trim(),
      workshop: normalizedWorkshop(rawField(row, ['WORKSHOP NAME']) || row.workshop),
      srNo: normalizedSr(rawField(row, ['SR NUMBER', 'SR Number']) || row.sr_wo),
      createdDate: mrnCreatedDate(row),
      row,
    })).filter((x) => x.sourceId),
    [allMrnRows],
  )

  const srIssueCostIndex = useMemo(() => {
    const exact = new Map()
    const item = new Map()

    const add = (map, key, qty, cost) => {
      if (!key || !qty || !cost) return
      const current = map.get(key) || { qty: 0, cost: 0, lines: 0 }
      current.qty += qty
      current.cost += cost
      current.lines += 1
      map.set(key, current)
    }

    data.transactions.forEach((tx) => {
      const referenceType = lower(rawField(tx, ['Reference']) || tx.transaction_type)
      const referenceNo = String(rawField(tx, ['Number']) || tx.sales_order || '').trim().toUpperCase()
      const itemCode = String(tx.item_code || rawField(tx, ['Item number', 'Item Number', 'Product number'])).trim().toUpperCase()
      const warehouse = String(rawField(tx, ['Warehouse']) || '').trim().toUpperCase()
      const issueStatus = lower(rawField(tx, ['Issue']) || tx.status)

      if (!referenceType.includes('sales order') || !referenceNo || !itemCode) return
      if (warehouse && warehouse !== 'THWS01079') return
      if (issueStatus && !issueStatus.includes('sold') && !issueStatus.includes('deducted')) return

      const qty = Math.abs(Number(tx.quantity || rawNumber(tx, ['Quantity']) || 0))
      const cost = Math.abs(Number(tx.cost || rawNumber(tx, ['Cost amount', 'Cost Amount']) || 0))
      if (!(qty > 0) || !(cost > 0)) return

      add(exact, referenceNo + '|' + itemCode, qty, cost)
      add(item, itemCode, qty, cost)
    })

    const finalize = (map) => {
      const out = new Map()
      map.forEach((value, key) => {
        out.set(key, {
          ...value,
          unitCost: value.qty > 0 ? value.cost / value.qty : 0,
        })
      })
      return out
    }

    return { exact: finalize(exact), item: finalize(item) }
  }, [data.transactions])

  const srIssuesEnriched = useMemo(() => data.srIssues.map((issue) => {
    const workshop = normalizedWorkshop(issue.workshop)
    const srNo = normalizedSr(issue.sr_no)
    const mrnNo = String(issue.mrn_no || '').trim()
    const issueDate = parseFlexibleDate(issue.requested_receipt_date)

    let candidates = []
    let matchType = 'UNMATCHED'
    let matched = null

    if (mrnNo && workshop) {
      candidates = mrnMatchRecords.filter((m) =>
        m.mrnNo === mrnNo &&
        m.workshop === workshop &&
        (!srNo || !m.srNo || m.srNo === srNo)
      )

      if (candidates.length === 1) {
        matched = candidates[0]
        matchType = 'VERIFIED'
      } else if (candidates.length > 1 && issueDate) {
        const prior = candidates
          .filter((m) => m.createdDate && m.createdDate <= issueDate)
          .sort((a, b) => String(b.createdDate).localeCompare(String(a.createdDate)))
        if (prior.length && (!prior[1] || prior[0].createdDate !== prior[1].createdDate)) {
          matched = prior[0]
          matchType = 'LIKELY'
        } else {
          matchType = 'AMBIGUOUS'
        }
      } else if (candidates.length > 1) {
        matchType = 'AMBIGUOUS'
      }
    }

    if (matchType === 'UNMATCHED' && workshop && srNo) {
      const context = mrnMatchRecords.filter((m) => m.workshop === workshop && m.srNo === srNo)
      if (context.length === 1) {
        matched = context[0]
        matchType = 'SR_CONTEXT'
      } else if (context.length > 1) {
        matchType = 'AMBIGUOUS'
      }
    }

    const lineStatus = lower(issue.line_status)
    const issueStage =
      lineStatus.includes('invoiced') ? 'Invoiced' :
      lineStatus.includes('delivered') ? 'Delivered' :
      lineStatus.includes('open order') ? 'Open Order' :
      lineStatus.includes('cancel') ? 'Cancelled' :
      (issue.line_status || issue.issue_state || 'Other')

    const salesOrder = String(issue.sales_order || '').trim().toUpperCase()
    const itemCode = String(issue.item_code || '').trim().toUpperCase()
    const originalUnitPrice = Math.abs(rawNumber(issue, ['Unit price', 'Unit Price']))
    const originalNetAmount = Math.abs(rawNumber(issue, ['Net amount', 'Net Amount']))
    const exactCost = srIssueCostIndex.exact.get(salesOrder + '|' + itemCode)
    const itemCost = srIssueCostIndex.item.get(itemCode)

    let costUnitPrice = originalUnitPrice
    let costSource = originalUnitPrice > 0 ? 'SR issue file' : ''
    let costMatch = originalUnitPrice > 0 ? 'SOURCE' : 'UNMATCHED'

    if (!(costUnitPrice > 0) && exactCost?.unitCost > 0) {
      costUnitPrice = exactCost.unitCost
      costSource = 'Inventory · SO + Item'
      costMatch = 'EXACT'
    } else if (!(costUnitPrice > 0) && itemCost?.unitCost > 0) {
      costUnitPrice = itemCost.unitCost
      costSource = 'Inventory · Item fallback'
      costMatch = 'ITEM'
    }

    const issueQty = Math.abs(Number(issue.quantity || 0))
    const lineValue = originalNetAmount > 0
      ? originalNetAmount
      : (costUnitPrice > 0 && issueQty > 0 ? costUnitPrice * issueQty : 0)

    return {
      ...issue,
      issue_stage: issueStage,
      cost_unit_price: costUnitPrice || 0,
      issue_value: lineValue || 0,
      cost_source: costSource || 'Cost unavailable',
      cost_match: costMatch,
      match_type: matchType,
      matched_mrn_source_id: matched?.sourceId || '',
      matched_mrn_no: matched?.mrnNo || '',
      matched_mrn_created: matched?.createdDate || '',
    }
  }), [data.srIssues, mrnMatchRecords, srIssueCostIndex])

  const srIssueWeekOptions = useMemo(() => {
    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 6),
      }
    })
  }, [])

  const srIssueSummary = useMemo(() => {
    const periodRows = srIssueWeekFilter === 'ALL'
      ? srIssuesEnriched
      : srIssuesEnriched.filter((r) => {
          const d = parseFlexibleDate(r.requested_receipt_date)
          return d && weekStartWednesday(d) === srIssueWeekFilter
        })

    const activeRows = periodRows.filter((r) => r.issue_stage !== 'Cancelled')
    const costKnown = activeRows.filter((r) => Number(r.cost_unit_price || 0) > 0)

    return {
      total: periodRows.length,
      invoiced: periodRows.filter((r) => r.issue_stage === 'Invoiced').length,
      delivered: periodRows.filter((r) => r.issue_stage === 'Delivered').length,
      openOrder: periodRows.filter((r) => ['Open Order', 'Delivered'].includes(r.issue_stage)).length,
      completed: periodRows.filter((r) => r.issue_stage === 'Invoiced').length,
      pendingInvoice: periodRows.filter((r) => ['Open Order', 'Delivered'].includes(r.issue_stage)).length,
      cancelled: periodRows.filter((r) => r.issue_stage === 'Cancelled').length,
      issueValue: activeRows.reduce((sum, r) => sum + Number(r.issue_value || 0), 0),
      pendingValue: periodRows
        .filter((r) => ['Open Order', 'Delivered'].includes(r.issue_stage))
        .reduce((sum, r) => sum + Number(r.issue_value || 0), 0),
      costKnown: costKnown.length,
      costMissing: Math.max(0, activeRows.length - costKnown.length),
      costCoverage: activeRows.length ? (costKnown.length / activeRows.length) * 100 : 0,
      selectedWeek: periodRows.length,
      salesOrders: new Set(periodRows.map((r) => r.sales_order).filter(Boolean)).size,
      srs: new Set(periodRows.map((r) => normalizedSr(r.sr_no)).filter(Boolean)).size,
    }
  }, [srIssuesEnriched, srIssueWeekFilter])

  const srIssueRows = useMemo(
    () => srIssuesEnriched.filter((row) => {
      if (!matches(row)) return false

      if (srIssueWeekFilter !== 'ALL') {
        const issueDate = parseFlexibleDate(row.requested_receipt_date)
        if (!issueDate || weekStartWednesday(issueDate) !== srIssueWeekFilter) return false
      }

      if (srIssueFilter === 'ALL') return true
      if (srIssueFilter === 'COMPLETED') return row.issue_stage === 'Invoiced'
      if (srIssueFilter === 'INVOICED') return row.issue_stage === 'Invoiced'
      if (srIssueFilter === 'DELIVERED') return row.issue_stage === 'Delivered'
      if (srIssueFilter === 'PENDING') return ['Open Order', 'Delivered'].includes(row.issue_stage)
      if (srIssueFilter === 'CANCELLED') return row.issue_stage === 'Cancelled'
      return true
    }),
    [srIssuesEnriched, srIssueFilter, srIssueWeekFilter, query],
  )

  const stockOnHandValue = (row) =>
    hasRawField(row, ['On-hand value', 'On Hand Value'])
      ? rawNumber(row, ['On-hand value', 'On Hand Value'])
      : Number(row.stock_value || 0)

  const top100HighValue = useMemo(
    () => [...data.stock]
      .filter((row) => stockOnHandValue(row) > 0)
      .sort((a, b) => stockOnHandValue(b) - stockOnHandValue(a))
      .slice(0, 100),
    [data.stock],
  )

  const top100HighValueCodes = useMemo(
    () => new Set(top100HighValue.map((row) => String(row.item_code || ''))),
    [top100HighValue],
  )

  const top100HighValueTotal = useMemo(
    () => top100HighValue.reduce((sum, row) => sum + stockOnHandValue(row), 0),
    [top100HighValue],
  )

  const stockRows = useMemo(() => {
    const filtered = data.stock.filter((row) => {
      if (!matches(row)) return false
      if (stockAgeFilter === 'ALL') return true
      if (stockAgeFilter === 'HIGH100') return top100HighValueCodes.has(String(row.item_code || ''))

      const hasBucket = (bucket) =>
        rawNumber(row, [bucket + ':Quantity']) > 0 ||
        rawNumber(row, [bucket + ':Amount']) > 0

      if (stockAgeFilter === 'P1') return hasBucket('P1')
      if (stockAgeFilter === 'P2') return hasBucket('P2')
      if (stockAgeFilter === 'P3') return hasBucket('P3')
      if (stockAgeFilter === 'P4') return hasBucket('P4')
      if (stockAgeFilter === 'P5') return hasBucket('P5')
      if (stockAgeFilter === 'AGED365') {
        return hasBucket('P2') || hasBucket('P3') || hasBucket('P4') || hasBucket('P5')
      }

      return true
    })

    if (stockAgeFilter === 'HIGH100') {
      return filtered.sort((a, b) => stockOnHandValue(b) - stockOnHandValue(a))
    }

    return filtered
  }, [data.stock, query, stockAgeFilter, top100HighValueCodes])

  const ageingSummary = useMemo(() => {
    const totals = {
      onHandQty: 0,
      onHandValue: 0,
      inventoryValueQty: 0,
      inventoryValue: 0,
      p1: 0,
      p2: 0,
      p3: 0,
      p4: 0,
      p5: 0,
    }

    data.stock.forEach((row) => {
      totals.onHandQty += rawNumber(row, ['On-hand quantity', 'On Hand Quantity']) || Number(row.on_hand || 0)
      totals.onHandValue += rawNumber(row, ['On-hand value', 'On Hand Value'])
      totals.inventoryValueQty += rawNumber(row, ['Inventory value quantity', 'Inventory Value Quantity'])
      totals.inventoryValue += rawNumber(row, ['Inventory value', 'Inventory Value'])
      totals.p1 += rawNumber(row, ['P1:Amount'])
      totals.p2 += rawNumber(row, ['P2:Amount'])
      totals.p3 += rawNumber(row, ['P3:Amount'])
      totals.p4 += rawNumber(row, ['P4:Amount'])
      totals.p5 += rawNumber(row, ['P5:Amount'])
    })

    totals.agedOver365 = totals.p2 + totals.p3 + totals.p4 + totals.p5
    return totals
  }, [data.stock])

  const ageingSnapshots = useMemo(
    () => data.snapshots
      .filter((s) => s.metrics?.kind === 'AGEING')
      .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date))),
    [data.snapshots],
  )

  const ageingComparison = useMemo(() => {
    const current = ageingSnapshots.at(-1) || null
    const previous = ageingSnapshots.at(-2) || null

    const currentValue = Number(current?.metrics?.over1 || 0)
    const previousValue = Number(previous?.metrics?.over1 || 0)
    const change = current && previous ? currentValue - previousValue : null
    const percent = current && previous && previousValue !== 0
      ? (change / previousValue) * 100
      : null

    const currentOnHand = Number(current?.metrics?.onHandValue || 0)
    const previousOnHand = Number(previous?.metrics?.onHandValue || 0)
    const onHandChange = current && previous ? currentOnHand - previousOnHand : null
    const onHandPercent = current && previous && previousOnHand !== 0
      ? (onHandChange / previousOnHand) * 100
      : null

    return {
      current,
      previous,
      currentValue,
      previousValue,
      change,
      percent,
      currentOnHand,
      previousOnHand,
      onHandChange,
      onHandPercent,
    }
  }, [ageingSnapshots])

  const transactionRows = useMemo(() => data.transactions.filter(matches), [data.transactions, query])

  const prPoReceiptRows = useMemo(
    () => allPrLines.filter((row) => {
      const date = receivedDate(row)
      if (!date || receivedQty(row) <= 0) return false
      return prPoReceiptWeekFilter === 'ALL' || weekStartWednesday(date) === prPoReceiptWeekFilter
    }),
    [allPrLines, prPoReceiptWeekFilter],
  )

  const prPoSummary = useMemo(() => {
    // Submission-based population: used for PRs submitted in the selected week.
    const submittedRows = weekFilteredPrLines
    const submittedPrMap = new Map()

    submittedRows.forEach((row) => {
      const prNo = String(row.pr_no || '').trim()
      if (!prNo) return
      if (!submittedPrMap.has(prNo)) {
        submittedPrMap.set(prNo, {
          requested: 0,
          received: 0,
          lineCount: 0,
          fullLines: 0,
          partialLines: 0,
          activeLines: 0,
        })
      }
      const item = submittedPrMap.get(prNo)
      const requested = requestedQty(row)
      const received = Math.min(requested > 0 ? requested : Number.MAX_SAFE_INTEGER, receivedQty(row))
      const state = receiptState(row)
      const status = lower(row.status)

      item.requested += requested
      item.received += received
      item.lineCount += 1
      if (state === 'full') item.fullLines += 1
      if (state === 'partial') item.partialLines += 1
      if (!status.includes('cancel') && !status.includes('reject')) item.activeLines += 1
    })

    const receiptRows = prPoReceiptRows

    const receivedItemQty = receiptRows.reduce(
      (sum, row) => sum + receivedQty(row),
      0,
    )

    const receivedPrNos = new Set(receiptRows.map((row) => String(row.pr_no || '').trim()).filter(Boolean))

    // Determine each PR's current receipt completion state using all its lines.
    const allPrState = new Map()
    allPrLines.forEach((row) => {
      const prNo = String(row.pr_no || '').trim()
      if (!prNo) return
      if (!allPrState.has(prNo)) {
        allPrState.set(prNo, { requested: 0, received: 0, lineCount: 0, fullLines: 0, partialLines: 0, latestReceiptDate: '' })
      }
      const p = allPrState.get(prNo)
      const requested = requestedQty(row)
      const received = receivedQty(row)
      const state = receiptState(row)
      p.requested += requested
      p.received += Math.min(requested > 0 ? requested : Number.MAX_SAFE_INTEGER, received)
      p.lineCount += 1
      if (state === 'full') p.fullLines += 1
      if (state === 'partial') p.partialLines += 1
      const rd = receivedDate(row)
      if (rd && (!p.latestReceiptDate || rd > p.latestReceiptDate)) p.latestReceiptDate = rd
    })

    let fullyReceivedPrs = 0
    let partReceivedPrs = 0
    for (const prNo of receivedPrNos) {
      const p = allPrState.get(prNo)
      if (!p) continue
      const full =
        (p.requested > 0 && p.received >= p.requested) ||
        (p.lineCount > 0 && p.fullLines === p.lineCount)
      if (full) fullyReceivedPrs += 1
      else if (p.received > 0 || p.partialLines > 0 || p.fullLines > 0) partReceivedPrs += 1
    }

    // Allocate PO value to only the item lines actually received in the selected receipt week.
    const receivedItemValue = receiptRows.reduce((sum, row) => {
      const amount = numericRowField(row, 'amount', [
        'Amount',
        'PO Amount',
        'PO Value',
        'Total Amount',
        'Value',
        'Line Amount',
        'Net Amount',
        'Line Value',
        'Total Value',
        'Purchase Amount',
      ]) ?? 0
      const requested = requestedQty(row)
      const received = receivedQty(row)
      if (!(amount > 0) || !(received > 0)) return sum
      if (!(requested > 0)) return sum + amount
      return sum + amount * Math.min(1, received / requested)
    }, 0)

    // Pending/urgent remain operational-state metrics, not receipt-date metrics.
    const urgentPendingItems = allPrLines.filter(isUrgentPendingRow).length
    const receiptNotDoneItems = allPrLines.filter(isReceiptNotDoneRow).length

    return {
      totalPrs: submittedPrMap.size,
      fullyReceivedPrs,
      partReceivedPrs,
      receivedItemLines: receiptRows.length,
      receivedPrs: receivedPrNos.size,
      urgentPendingItems,
      receiptNotDoneItems,
      receivedItemQty,
      receivedItemValue,
    }
  }, [weekFilteredPrLines, allPrLines, prPoReceiptRows])

  const today = new Date()
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(today.getDate() - 7)
  const todayIso = today.toISOString().slice(0, 10)

  const metrics = useMemo(() => {
    const pendingPr = procurementData.filter((r) => ['PR', 'PO'].includes(r.source_type) && !isClosed(r.status || r.delivery_status))
    const urgent = procurementData.filter((r) => isUrgent(r.priority) && !isClosed(r.status || r.delivery_status))
    const overdue = procurementData.filter((r) =>
      r.expected_delivery && r.expected_delivery < todayIso && !isClosed(r.delivery_status || r.status),
    )
    const recent = data.transactions.filter((r) => r.physical_date && new Date(r.physical_date) >= sevenDaysAgo)
    const receipts = recent.filter((r) => lower(r.transaction_type).includes('receipt') || Number(r.quantity) > 0)
    const issues = recent.filter((r) => lower(r.transaction_type).includes('issue') || Number(r.quantity) < 0)
    const value = data.stock.reduce((sum, r) => {
      if (hasRawField(r, ['On-hand value'])) return sum + rawNumber(r, ['On-hand value'])
      return sum + Number(r.stock_value || 0)
    }, 0)
    const agedValue = data.stock.reduce((sum, r) => {
      if (hasRawField(r, ['P2:Amount', 'P3:Amount', 'P4:Amount', 'P5:Amount'])) {
        return sum
          + rawNumber(r, ['P2:Amount'])
          + rawNumber(r, ['P3:Amount'])
          + rawNumber(r, ['P4:Amount'])
          + rawNumber(r, ['P5:Amount'])
      }
      return /12|24|36|over|old|year/i.test(r.age_band || '')
        ? sum + Number(r.stock_value || 0)
        : sum
    }, 0)
    return {
      prf: new Set(procurementData.map((r) => r.prf_no).filter(Boolean)).size,
      mrn: new Set(data.material.filter((r) => r.document_type === 'MRN').map((r) => r.document_no).filter(Boolean)).size,
      pending: pendingPr.length,
      urgent: urgent.length,
      overdue: overdue.length,
      receipts: receipts.reduce((s, r) => s + Math.abs(Number(r.quantity || 0)), 0),
      issues: issues.reduce((s, r) => s + Math.abs(Number(r.quantity || 0)), 0),
      stockValue: value,
      agedValue,
    }
  }, [data, todayIso])

  const lastSource = useMemo(() => {
    const map = new Map()
    data.sourceUpdates.forEach((r) => {
      if (!map.has(r.source_type)) map.set(r.source_type, r)
    })
    return map
  }, [data.sourceUpdates])

  const globalHits = useMemo(() => {
    if (query.length < 2) return []
    const hits = []
    for (const r of procurementData) if (matches(r)) hits.push({ type: 'PR / PO / PRF', ref: r.po_no || r.pr_no || r.prf_no, detail: r.item_description || r.item_code, view: r.source_type === 'PRF' ? 'prf' : 'prpo' })
    for (const r of data.material) if (matches(r)) hits.push({ type: r.document_type, ref: r.document_no, detail: r.item_description || r.item_code, view: r.document_type === 'MTR' ? 'mtr' : 'mrn' })
    for (const r of data.stock) if (matches(r)) hits.push({ type: 'Stock', ref: r.item_code, detail: r.item_description, view: 'stock' })
    for (const r of data.transactions) if (matches(r)) hits.push({ type: 'Transaction', ref: r.po_no || r.sales_order || r.journal_no, detail: r.item_description || r.item_code, view: 'transactions' })
    return hits.slice(0, 18)
  }, [query, data])

  const procurementColumns = [
    { key: 'prf_no', label: 'PRF' },
    { key: 'pr_no', label: 'PR' },
    { key: 'po_no', label: 'PO' },
    { key: 'vessel', label: 'Vessel / Asset', render: (v, r) => v || r.asset || '—' },
    { key: 'sr_wo', label: 'SR / WO', render: (v) => <span className="font-mono text-[11px] font-medium text-slate-700">{v || '—'}</span> },
    { key: 'priority', label: 'Priority', render: (v) => <StatusPill value={v} /> },
    { key: 'supplier', label: 'Supplier' },
    { key: 'item_code', label: 'Item' },
    { key: 'item_description', label: 'Description' },
    { key: 'qty_requested', label: 'Req.' },
    { key: 'qty_received', label: 'Rec.' },
    { key: 'balance_qty', label: 'Bal.' },
    { key: 'payment_status', label: 'Payment', render: (v) => <StatusPill value={v} /> },
    { key: 'delivery_status', label: 'Delivery', render: (v) => <StatusPill value={v} /> },
    { key: 'expected_delivery', label: 'ETA' },
    { key: 'status', label: 'Status', render: (v) => <StatusPill value={v} /> },
  ]

  const prPoColumns = [
    { key: 'raw_pr_name', label: 'PR Name', render: (_v, r) => displayValue(rawField(r, ['PR Name']), true) },
    { key: 'pr_no', label: 'PR No.', render: (v) => displayValue(v, true) },
    { key: 'po_no', label: 'PO Number', render: (v) => displayValue(v, true) },
    { key: 'priority', label: 'Priority', render: (v) => <StatusPill value={v} /> },
    { key: 'item_code', label: 'Item ID', render: (v) => displayValue(v, true) },
    { key: 'item_description', label: 'Product Name', render: (v) => displayValue(v, true) },
    { key: 'qty_requested', label: 'Quantity', render: (v, r) => v ?? rawField(r, ['Quantity']) ?? '—' },
    { key: 'unit', label: 'Unit', render: (v) => displayValue(v) },
    { key: 'raw_category', label: 'Category', render: (_v, r) => displayValue(rawField(r, ['Category'])) },
    { key: 'amount', label: 'PO Value', render: (v, r) => {
      const value = v ?? numericRowField(r, 'amount', ['PO Value'])
      return value === null || value === undefined || value === '' ? '—' : money(value)
    } },
    { key: 'status', label: 'ERP Status', render: (v, r) => <StatusPill value={v || rawField(r, ['ERP Status']) || '—'} /> },
    { key: 'pr_date', label: 'Submitted Date', render: (v, r) => v || rawField(r, ['Submitted Date']) || '—' },
    { key: 'expected_delivery', label: 'PO Delivery Date', render: (v, r) => v || rawField(r, ['PO Delivery Date']) || '—' },
    { key: 'raw_received_date', label: 'Received Date', render: (_v, r) => displayValue(rawField(r, ['Received Date'])) },
  ]

  const prSubmissionColumns = erpPrHeaders.length
    ? [
        { key: 'purch_req_id', label: 'PR Number', render: (v) => <span className="font-mono text-[11px] font-semibold text-slate-900">{displayValue(v, true)}</span> },
        { key: 'description', label: 'PR Description', render: (v) => displayValue(v, true) },
        { key: 'created_at_raw', label: 'Submitted Date', render: (v, r) => displayValue(v || r.created_at) },
        { key: 'created_by', label: 'Requested By', render: (v) => displayValue(v) },
        { key: 'site', label: 'Site', render: (v) => displayValue(v) },
        { key: 'status', label: 'ERP Status', render: (v) => <StatusPill value={v} /> },
      ]
    : [
        { key: 'pr_no', label: 'PR Number', render: (v) => displayValue(v, true) },
        { key: 'raw_pr_name', label: 'PR Description', render: (_v, r) => displayValue(rawField(r, ['PR Name', 'PR Description']), true) },
        { key: 'pr_date', label: 'Submitted Date', render: (v, r) => v || rawField(r, ['Submitted Date']) || '—' },
      ]

  const receiptItemColumns = [
    { key: 'raw_pr_name', label: 'PR Name', render: (_v, r) => displayValue(rawField(r, ['PR Name']), true) },
    { key: 'pr_no', label: 'PR No.', render: (v) => displayValue(v, true) },
    { key: 'po_no', label: 'PO Number', render: (v) => displayValue(v, true) },
    { key: 'item_code', label: 'Item ID', render: (v) => displayValue(v, true) },
    { key: 'item_description', label: 'Product Name', render: (v) => displayValue(v, true) },
    { key: 'qty_received', label: 'Received Qty', render: (v, r) => v ?? rawField(r, ['Received Qty']) ?? '—' },
    { key: 'unit', label: 'Unit', render: (v) => displayValue(v) },
    { key: 'raw_received_date', label: 'Received Date', render: (_v, r) => displayValue(rawField(r, ['Received Date'])) },
    { key: 'amount', label: 'PO Value', render: (v, r) => {
      const value = v ?? numericRowField(r, 'amount', ['PO Value'])
      return value === null || value === undefined || value === '' ? '—' : money(value)
    } },
  ]

  const mtrColumns = [
    { key: 'raw_prf_number', label: 'PRF Number', render: (_v, r) => displayValue(rawField(r, ['PRF Number'])) },
    { key: 'sr_wo', label: 'SR Number', render: (v, r) => displayValue(v || rawField(r, ['SR Number']), true) },
    { key: 'workshop', label: 'Section', render: (v, r) => displayValue(v || rawField(r, ['Section'])) },
    { key: 'raw_from_warehouse', label: 'From Warehouse', render: (_v, r) => displayValue(rawField(r, ['From Warehouse'])) },
    { key: 'remarks', label: 'Note', render: (v, r) => displayValue(v || rawField(r, ['Note'])) },
    { key: 'asset_vessel', label: 'Asset / Vessel', render: (_v, r) => displayValue(rawField(r, ['Asset / Vessel']) || r.vessel || r.asset) },
    { key: 'document_no', label: 'MTR number', render: (v, r) => displayValue(v || rawField(r, ['MTR number', 'MTR Number'])) },
    { key: 'raw_line_number', label: 'Line number', render: (_v, r) => displayValue(rawField(r, ['Line number', 'Line Number'])) },
    { key: 'item_code', label: 'Item number', render: (v, r) => displayValue(v || rawField(r, ['Item number', 'Item Number'])) },
    { key: 'item_description', label: 'Item name', render: (v, r) => displayValue(v || rawField(r, ['Item name', 'Item Name'])) },
    { key: 'requested_qty', label: 'Requested quantity', render: (v, r) => v ?? rawField(r, ['Requested quantity', 'Requested Quantity']) ?? '—' },
    { key: 'unit', label: 'Unit', render: (v, r) => displayValue(v || rawField(r, ['Unit'])) },
    { key: 'transferred_qty', label: 'Transfered quantity', render: (v, r) => v ?? rawField(r, ['Transfered quantity', 'Transferred quantity']) ?? '—' },
    { key: 'remaining_qty', label: 'Remaining quantity', render: (v, r) => v ?? rawField(r, ['Remaining quantity', 'Remaining Quantity']) ?? '—' },
    { key: 'document_date', label: 'Request date', render: (v, r) => v || rawField(r, ['Request date', 'Request Date']) || '—' },
    { key: 'raw_approved_date', label: 'Approved Date', render: (_v, r) => displayValue(rawField(r, ['Approved Date'])) },
    { key: 'raw_on_hand_srd', label: 'On-Hand SRD', render: (_v, r) => displayValue(rawField(r, ['On-Hand SRD', 'On Hand SRD'])) },
    { key: 'status', label: 'ERP Status', render: (v, r) => <StatusPill value={v || rawField(r, ['ERP Status']) || '—'} /> },
    { key: 'raw_delivery_status_erp', label: 'Delivery Status ERP', render: (_v, r) => <StatusPill value={rawField(r, ['Delivery Status ERP']) || '—'} /> },
  ]

  const mrnColumns = [
    { key: 'raw_id', label: 'ID', render: (_v, r) => displayValue(rawField(r, ['ID'])) },
    { key: 'document_date', label: 'Created', render: (v, r) => v || rawField(r, ['Created']) || '—' },
    { key: 'workshop', label: 'Workshop Name', render: (v, r) => displayValue(v || rawField(r, ['WORKSHOP NAME', 'Workshop Name'])) },
    { key: 'raw_wp_type', label: 'WP Type', render: (_v, r) => displayValue(rawField(r, ['WP TYPE'])) },
    { key: 'document_no', label: 'MRN Number', render: (v, r) => displayValue(v || rawField(r, ['MRN NUMBER', 'MRN Number']), true) },
    { key: 'raw_wp_number', label: 'WP Number', render: (_v, r) => displayValue(rawField(r, ['WP NUMBER'])) },
    { key: 'sr_wo', label: 'SR Number', render: (v, r) => displayValue(v || rawField(r, ['SR NUMBER', 'SR Number']), true) },
    { key: 'raw_boq_number', label: 'BOQ Number', render: (_v, r) => displayValue(rawField(r, ['BOQ NUMBER'])) },
    { key: 'asset', label: 'Asset / Service', render: (v, r) => displayValue(v || r.vessel || rawField(r, ['ASSET / SERVICE', 'Asset / Service'])) },
    { key: 'raw_svo_journal', label: 'SVO / Journal Number', render: (_v, r) => displayValue(rawField(r, ['SVO / JOURNAL NUMBER', 'SVO / Journal Number'])) },
    { key: 'raw_submitted_by', label: 'Submitted By', render: (_v, r) => displayValue(rawField(r, ['SUBMITTED BY', 'Submitted By'])) },
    { key: 'status', label: 'Issued Status', render: (_v, r) => <StatusPill value={mrnStatusLabel(r)} /> },
    { key: 'raw_modified_by', label: 'Modified By', render: (_v, r) => displayValue(rawField(r, ['Modified by', 'Modified By'])) },
    { key: 'raw_item_type', label: 'Item Type', render: (_v, r) => displayValue(rawField(r, ['Item Type'])) },
    { key: 'raw_path', label: 'Path', render: (_v, r) => displayValue(rawField(r, ['Path'])) },
  ]

  const mrnQuickColumns = [
    { key: 'raw_id', label: 'ID', render: (_v, r) => displayValue(rawField(r, ['ID'])) },
    { key: 'document_date', label: 'Created', render: (v, r) => v || rawField(r, ['Created']) || '—' },
    { key: 'workshop', label: 'Workshop', render: (v, r) => displayValue(v || rawField(r, ['WORKSHOP NAME', 'Workshop Name'])) },
    { key: 'document_no', label: 'MRN', render: (v, r) => displayValue(v || rawField(r, ['MRN NUMBER', 'MRN Number']), true) },
    { key: 'sr_wo', label: 'SR', render: (v, r) => displayValue(v || rawField(r, ['SR NUMBER', 'SR Number']), true) },
    { key: 'asset', label: 'Asset / Service', render: (v, r) => displayValue(v || r.vessel || rawField(r, ['ASSET / SERVICE', 'Asset / Service'])) },
    { key: 'raw_svo_journal', label: 'SVO / Journal', render: (_v, r) => displayValue(rawField(r, ['SVO / JOURNAL NUMBER', 'SVO / Journal Number'])) },
    { key: 'status', label: 'Issued Status', render: (_v, r) => <StatusPill value={mrnStatusLabel(r)} /> },
  ]

  const srIssueColumns = [
    { key: 'requested_receipt_date', label: 'Requested Date' },
    { key: 'sales_order', label: 'Sales Order', render: (v) => <span className="font-mono text-[11px] font-semibold text-slate-800">{v || '—'}</span> },
    { key: 'sr_no', label: 'SR' },
    { key: 'item_code', label: 'Item', render: (v) => <span className="font-mono text-[11px] text-slate-700">{v || '—'}</span> },
    { key: 'item_description', label: 'Product Name' },
    { key: 'quantity', label: 'Qty' },
    { key: 'unit', label: 'Unit' },
    { key: 'cost_unit_price', label: 'Cost / Unit Price', render: (v) => Number(v || 0) > 0 ? mvr(v) : '—' },
    { key: 'issue_value', label: 'Line Value', render: (v) => Number(v || 0) > 0 ? mvr(v) : '—' },
    { key: 'cost_source', label: 'Cost Source', render: (v) => <StatusPill value={v || 'Cost unavailable'} /> },
    { key: 'issue_stage', label: 'Line Status', render: (v) => <StatusPill value={v} /> },
    { key: 'workshop', label: 'Workshop' },
    { key: 'mrn_no', label: 'MRN in Delivery' },
    { key: 'service_order', label: 'Service Order' },
    { key: 'match_type', label: 'MRN Match', render: (v) => {
      const labels = {
        VERIFIED: 'Verified MRN',
        LIKELY: 'Likely MRN',
        SR_CONTEXT: 'SR context',
        AMBIGUOUS: 'Ambiguous',
        UNMATCHED: 'Unmatched',
      }
      return <StatusPill value={labels[v] || v} />
    } },
    { key: 'delivery_name', label: 'Delivery Name' },
  ]

  const materialColumns = [
    { key: 'document_no', label: 'Document' },
    { key: 'document_date', label: 'Date' },
    { key: 'vessel', label: 'Vessel / Asset', render: (v, r) => v || r.asset || '—' },
    { key: 'sr_wo', label: 'SR / WO' },
    { key: 'item_code', label: 'Item' },
    { key: 'item_description', label: 'Description' },
    { key: 'requested_qty', label: 'Requested' },
    { key: 'transferred_qty', label: 'Transferred' },
    { key: 'issued_qty', label: 'Issued' },
    { key: 'remaining_qty', label: 'Remaining' },
    { key: 'status', label: 'Status', render: (v) => <StatusPill value={v} /> },
  ]

  async function saveSnapshot() {
    const periodStart = weekStartWednesday(todayIso)
    const periodEnd = addDaysIso(periodStart, 6)
    const urgentCases = procurementData
      .filter((r) => isUrgent(r.priority) || (r.expected_delivery && r.expected_delivery < todayIso))
      .slice(0, 30)
      .map((r) => ({
        reference: r.po_no || r.pr_no || r.prf_no,
        item: r.item_description || r.item_code,
        vessel: r.vessel || r.asset,
        priority: r.priority,
        eta: r.expected_delivery,
        status: r.delivery_status || r.status,
      }))

    const decisionCount = data.notes.filter(
      (n) => ['critical', 'urgent', 'high'].includes(lower(n.priority)) || n.deadline
    ).length

    const snapshotMetrics = {
      kind: 'MEETING',
      comparisonVersion: '2',
      periodStart,
      periodEnd,
      prfSubmitted: prfWeekCounts[0]?.count || 0,
      prSubmitted: prPoWeekCounts[0]?.count || 0,
      mtrRequested: mtrWeekCounts[0]?.count || 0,
      mrnCreated: mrnWeekCounts[0]?.count || 0,
      pendingPrPo: metrics.pending,
      urgentCases: metrics.urgent,
      overdueDeliveries: metrics.overdue,
      pendingPo: allPrPoRows.filter(isReceiptNotDoneRow).length,
      agedPrSixPlus: prPoAgeing.agedSixPlus,
      oldestOpenPrDays: prPoAgeing.oldestOpenDays,
      mtrPending: mtrSummary.notTransferred + mtrSummary.partiallyTransferred,
      mtrNoStock: mtrSummary.pendingNoStock,
      mtr30: mtrSummary.aged30,
      mrnPending: mrnSummary.pending,
      mrn14: mrnSummary.pending14,
      mrn30: mrnSummary.pending30,
      mrnNoJournal: mrnSummary.noJournal,
      onHandValue: ageingSummary.onHandValue,
      agedOver365: ageingSummary.agedOver365,
      p1: ageingSummary.p1,
      p2: ageingSummary.p2,
      p3: ageingSummary.p3,
      p4: ageingSummary.p4,
      p5: ageingSummary.p5,
      top100HighValue: top100HighValueTotal,
      openActions: data.notes.length,
      decisionsRequired: decisionCount,
    }

    const existing = data.snapshots.find(
      (s) => s.snapshot_date === periodStart && s.metrics?.kind === 'MEETING'
    )

    let error
    if (existing) {
      ;({ error } = await supabase
        .from('weekly_snapshots')
        .update({
          label: 'Wednesday Meeting — ' + periodStart + ' to ' + periodEnd,
          metrics: snapshotMetrics,
          priority_cases: urgentCases,
          created_by: session.user.email,
        })
        .eq('id', existing.id))
    } else {
      ;({ error } = await supabase.from('weekly_snapshots').insert({
        snapshot_date: periodStart,
        label: 'Wednesday Meeting — ' + periodStart + ' to ' + periodEnd,
        metrics: snapshotMetrics,
        priority_cases: urgentCases,
        created_by: session.user.email,
      }))
    }

    if (!error) await loadTables(['snapshots'], true)
  }

  const vesselTerm = lower(vesselSearch).trim()
  const vesselProc = procurementData.filter((r) => !vesselTerm || [r.vessel, r.asset, r.sr_wo, r.prf_no, r.pr_no, r.po_no].some((v) => lower(v).includes(vesselTerm)))
  const vesselMat = data.material.filter((r) => !vesselTerm || [r.vessel, r.asset, r.sr_wo, r.document_no].some((v) => lower(v).includes(vesselTerm)))
  const vesselTx = data.transactions.filter((r) => !vesselTerm || [r.vessel, r.sr_wo, r.delivery_name, r.sales_order].some((v) => lower(v).includes(vesselTerm)))

  const meetingPrfStatuses = (() => {
    const statusMap = new Map(prfStatusCounts)
    const preferred = ['NOT ATTENDED', 'ITEM CREATION PENDING']
      .filter((status) => statusMap.has(status))
      .map((status) => [status, statusMap.get(status)])

    const preferredSet = new Set(preferred.map(([status]) => status))
    const remaining = prfStatusCounts.filter(([status]) => !preferredSet.has(status))

    return [...preferred, ...remaining].slice(0, 12)
  })()

  const meetingWeek = prfWeekCounts[0] || { weekStart: weekStartWednesday(todayIso), weekEnd: addDaysIso(weekStartWednesday(todayIso), 6), count: 0 }
  const previousMeetingWeek = prfWeekCounts[1] || { count: 0 }

  const meetingWeeklyChange = {
    prf: { current: prfWeekCounts[0]?.count || 0, previous: prfWeekCounts[1]?.count || 0 },
    pr: { current: prPoWeekCounts[0]?.count || 0, previous: prPoWeekCounts[1]?.count || 0 },
    mtr: { current: mtrWeekCounts[0]?.count || 0, previous: mtrWeekCounts[1]?.count || 0 },
    mrn: { current: mrnWeekCounts[0]?.count || 0, previous: mrnWeekCounts[1]?.count || 0 },
  }
  const meetingSnapshots = useMemo(
    () => data.snapshots
      .filter((s) => s.metrics?.kind === 'MEETING')
      .sort((a, b) => String(a.snapshot_date).localeCompare(String(b.snapshot_date))),
    [data.snapshots],
  )

  const verifiedMeetingSnapshots = useMemo(
    () => meetingSnapshots.filter((s) => s.metrics?.comparisonVersion === '2'),
    [meetingSnapshots],
  )

  const currentMeetingSnapshot = verifiedMeetingSnapshots.find((s) => s.snapshot_date === meetingWeek.weekStart) || null
  const previousMeetingSnapshot = [...verifiedMeetingSnapshots]
    .reverse()
    .find((s) => s.snapshot_date < meetingWeek.weekStart) || null

  const meetingStateCurrent = {
    pendingPrPo: metrics.pending,
    urgentCases: metrics.urgent,
    overdueDeliveries: metrics.overdue,
    mtr30: mtrSummary.aged30,
    mrn30: mrnSummary.pending30,
    mrnNoJournal: mrnSummary.noJournal,
    onHandValue: ageingSummary.onHandValue,
    agedOver365: ageingSummary.agedOver365,
    openActions: data.notes.length,
    decisionsRequired: data.notes.filter(
      (n) => ['critical', 'urgent', 'high'].includes(lower(n.priority)) || n.deadline
    ).length,
  }

  const meetingStatePrevious = previousMeetingSnapshot?.metrics || null

  const snapshotDeltaText = (key, formatter = (v) => fmt(v)) => {
    if (!meetingStatePrevious) return 'No verified prior snapshot yet'
    const current = Number(meetingStateCurrent[key] || 0)
    const previous = Number(meetingStatePrevious[key] || 0)
    const diff = current - previous
    if (diff === 0) return 'No change vs last snapshot'
    return (diff > 0 ? '+' : '−') + formatter(Math.abs(diff)) + ' vs last snapshot'
  }


  const meetingProcurementExceptions = useMemo(() => {
    const urgentRows = allPrPoRows.filter(isUrgentPendingRow)
    const pendingPoRows = allPrPoRows.filter(isReceiptNotDoneRow)
    const overdueRows = procurementData.filter((r) =>
      r.expected_delivery && r.expected_delivery < todayIso && !isClosed(r.delivery_status || r.status)
    )

    const rows = [...urgentRows, ...overdueRows]
    const seen = new Set()
    return rows.filter((r) => {
      const key = [r.po_no, r.pr_no, r.prf_no, r.item_code].filter(Boolean).join('|')
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    }).slice(0, 7).map((r) => ({
      ref: r.po_no || r.pr_no || r.prf_no || '—',
      detail: r.item_description || r.item_code || r.vessel || r.asset || 'No description',
      issue: isUrgent(r.priority)
        ? 'Urgent pending'
        : (r.expected_delivery && r.expected_delivery < todayIso ? 'Delivery overdue' : 'Pending'),
      eta: r.expected_delivery || '—',
    }))
  }, [allPrPoRows, procurementData, todayIso])

  const meetingDecisionNotes = useMemo(
    () => data.notes
      .filter((n) => ['critical', 'urgent', 'high'].includes(lower(n.priority)) || n.deadline)
      .slice(0, 8),
    [data.notes],
  )

  const meetingAgedPercent = ageingSummary.onHandValue > 0
    ? (ageingSummary.agedOver365 / ageingSummary.onHandValue) * 100
    : 0

  const deltaText = (current, previous, suffix = '') => {
    const diff = Number(current || 0) - Number(previous || 0)
    if (diff === 0) return 'No change'
    return (diff > 0 ? '+' : '') + fmt(diff, 0) + suffix + ' vs previous period'
  }

  const meetingSlides = [
    {
      kicker: 'MANAGEMENT REVIEW',
      title: 'Executive Summary',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>REVIEW PERIOD</span>
              <b>{formatShortDate(meetingWeek.weekStart)} – {formatShortDate(meetingWeek.weekEnd)}</b>
            </div>
            <small>Wednesday–Tuesday operational review</small>
          </div>
          <div className="meeting-metrics">
            <MetricCard label="Pending PR / PO" value={fmt(metrics.pending)} tone="warn" helper="Open procurement lines" />
            <MetricCard label="Urgent Cases" value={fmt(metrics.urgent)} tone="bad" helper="High-priority open lines" />
            <MetricCard label="Overdue Deliveries" value={fmt(metrics.overdue)} tone="bad" helper="ETA already passed" />
            <MetricCard label="MTR 30+ Days" value={fmt(mtrSummary.aged30)} tone="bad" helper="Pending item lines" />
            <MetricCard label="MRN 30+ Days" value={fmt(mrnSummary.pending30)} tone="bad" helper="Pending MRNs" />
            <MetricCard label="Stock Value Over 1 Year" value={mvr(ageingSummary.agedOver365)} tone="warn" helper={meetingAgedPercent.toFixed(1) + '% of on-hand value'} />
          </div>
        </>
      ),
    },
    {
      kicker: 'CURRENT WEEK ACTIVITY',
      title: 'Activity This Week',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>REVIEW PERIOD</span>
              <b>{formatShortDate(meetingWeek.weekStart)} – {formatShortDate(meetingWeek.weekEnd)}</b>
            </div>
            <small>Current Wednesday–Tuesday activity only</small>
          </div>
          <div className="meeting-change-grid">
            {[
              ['PRFs submitted', meetingWeeklyChange.prf.current],
              ['PRs raised', meetingWeeklyChange.pr.current],
              ['MTRs requested', meetingWeeklyChange.mtr.current],
              ['MRNs created', meetingWeeklyChange.mrn.current],
              ['Received item lines', prPoReceiptWeekCounts[0]?.lines || 0],
              ['Received quantity', prPoReceiptWeekCounts[0]?.qty || 0],
            ].map(([label, value]) => (
              <div className="meeting-change-card" key={label}>
                <span>{label}</span>
                <b>{label === 'Received quantity' ? fmt(value, 2) : fmt(value)}</b>
                <div><small>Current week</small><strong>Live activity</strong></div>
              </div>
            ))}
          </div>
        </>
      ),
    },
    {
      kicker: 'CURRENT OPERATIONAL POSITION',
      title: 'What Needs Attention Now',
      body: (
        <div className="meeting-change-grid operational">
          {[
            ['Pending PR / PO', 'pendingPrPo'],
            ['Urgent cases', 'urgentCases'],
            ['Overdue deliveries', 'overdueDeliveries'],
            ['MTR 30+ days', 'mtr30'],
            ['MRN 30+ days', 'mrn30'],
            ['MRN without SVO / Journal', 'mrnNoJournal'],
            ['Open actions', 'openActions'],
            ['Decisions required', 'decisionsRequired'],
          ].map(([label, key]) => (
            <div className="meeting-change-card compact" key={key}>
              <span>{label}</span>
              <b>{fmt(meetingStateCurrent[key])}</b>
              <div><small>Current live position</small><strong>Review / follow up</strong></div>
            </div>
          ))}
        </div>
      ),
    },
    {
      kicker: 'PROCUREMENT EXCEPTIONS',
      title: 'Items Requiring Attention',
      body: (
        <>
          <div className="meeting-exception-metrics">
            <div><span>Urgent pending items</span><b>{fmt(allPrPoRows.filter(isUrgentPendingRow).length)}</b></div>
            <div><span>Pending PO</span><b>{fmt(allPrPoRows.filter(isReceiptNotDoneRow).length)}</b></div>
            <div><span>6+ month aged PRs</span><b>{fmt(prPoAgeing.agedSixPlus)}</b></div>
            <div><span>Oldest open PR</span><b>{fmt(prPoAgeing.oldestOpenDays)}d</b></div>
          </div>
          <div className="meeting-exception-table">
            <div className="meeting-exception-head"><span>Reference</span><span>Issue / item</span><span>Exception</span><span>ETA</span></div>
            {meetingProcurementExceptions.map((x, i) => (
              <div className="meeting-exception-row" key={x.ref + i}>
                <b>{x.ref}</b>
                <span>{x.detail}</span>
                <em>{x.issue}</em>
                <small>{x.eta}</small>
              </div>
            ))}
            {!meetingProcurementExceptions.length && <div className="meeting-no-exceptions">No urgent or overdue procurement exceptions found.</div>}
          </div>
        </>
      ),
    },
    {
      kicker: 'MATERIAL EXCEPTIONS',
      title: 'Transfer & Issue Bottlenecks',
      body: (
        <div className="meeting-control-grid">
          <section>
            <div className="meeting-control-head"><span>MTR</span><b>Transfer Control</b></div>
            <div className="meeting-control-row"><span>Pending with no SRD on-hand</span><strong>{fmt(mtrSummary.pendingNoStock)}</strong></div>
            <div className="meeting-control-row critical"><span>Pending 30+ days</span><strong>{fmt(mtrSummary.aged30)}</strong></div>
          </section>
          <section>
            <div className="meeting-control-head"><span>MRN</span><b>Issue Control</b></div>
            <div className="meeting-control-row"><span>Pending / not issued</span><strong>{fmt(mrnSummary.pending)}</strong></div>
            <div className="meeting-control-row"><span>Pending 14+ days</span><strong>{fmt(mrnSummary.pending14)}</strong></div>
            <div className="meeting-control-row critical"><span>Pending 30+ days</span><strong>{fmt(mrnSummary.pending30)}</strong></div>
            <div className="meeting-control-row critical"><span>Without SVO / Journal</span><strong>{fmt(mrnSummary.noJournal)}</strong></div>
          </section>
        </div>
      ),
    },
    {
      kicker: 'INVENTORY RISK',
      title: 'Stock & Ageing Review',
      body: (
        <>
          <div className="meeting-inventory-hero">
            <div><span>On-hand Value</span><b>{mvr(ageingSummary.onHandValue)}</b><small>Current inventory value on hand</small></div>
            <div><span>Over 1 Year</span><b>{mvr(ageingSummary.agedOver365)}</b><small>{meetingAgedPercent.toFixed(1)}% of on-hand value</small></div>
            <div><span>Top 100 High Value Items</span><b>{mvr(top100HighValueTotal)}</b><small>{fmt(top100HighValue.length)} highest-value items</small></div>
          </div>
          <div className="meeting-age-buckets">
            <div><span>0–1 Year</span><b>{mvr(ageingSummary.p1)}</b></div>
            <div><span>1–3 Years</span><b>{mvr(ageingSummary.p2)}</b></div>
            <div><span>3–4 Years</span><b>{mvr(ageingSummary.p3)}</b></div>
            <div><span>4–5 Years</span><b>{mvr(ageingSummary.p4)}</b></div>
            <div><span>Over 5 Years</span><b>{mvr(ageingSummary.p5)}</b></div>
          </div>
        </>
      ),
    },
    {
      kicker: 'OWNERSHIP & FOLLOW-UP',
      title: 'Open Actions',
      body: (
        <div className="meeting-actions-table">
          <div className="meeting-actions-head"><span>Reference</span><span>Action / issue</span><span>Owner</span><span>Deadline</span></div>
          {data.notes.slice(0, 9).map((n) => (
            <div className="meeting-actions-row" key={n.id}>
              <b>{n.entity_key}</b>
              <span>{n.action || n.remark || 'No action text'}</span>
              <small>{n.owner || 'Unassigned'}</small>
              <em>{n.deadline || '—'}</em>
            </div>
          ))}
          {!data.notes.length && <div className="meeting-no-exceptions">No open actions recorded.</div>}
        </div>
      ),
    },
    {
      kicker: 'MANAGEMENT DECISIONS',
      title: 'Decisions Required',
      body: (
        <>
          <div className="meeting-decision-intro">
            <span>{fmt(meetingDecisionNotes.length)}</span>
            <div><b>Items flagged for management attention</b><small>High-priority actions or items with a deadline.</small></div>
          </div>
          <div className="meeting-decisions">
            {meetingDecisionNotes.map((n, index) => (
              <div key={n.id || index}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <section>
                  <b>{n.entity_key}</b>
                  <p>{n.action || n.remark || 'Decision / follow-up required'}</p>
                </section>
                <aside>
                  <strong>{n.owner || 'Unassigned'}</strong>
                  <small>{n.deadline || n.eta || 'No date'}</small>
                </aside>
              </div>
            ))}
            {!meetingDecisionNotes.length && <div className="meeting-no-exceptions">No high-priority decisions are currently flagged.</div>}
          </div>
        </>
      ),
    },
  ]


  const warehouseCurrentWeekStart = weekStartWednesday(todayIso)
  const warehouseWeekStart = addDaysIso(warehouseCurrentWeekStart, -7)
  const warehouseWeekEnd = addDaysIso(warehouseWeekStart, 6)
  const warehousePreviousWeekStart = addDaysIso(warehouseWeekStart, -7)

  const warehouseReceiptSummaryForWeek = (weekStart) => {
    const rows = allPrLines.filter((row) => {
      const date = receivedDate(row)
      return date && receivedQty(row) > 0 && weekStartWednesday(date) === weekStart
    })

    const prs = new Set(rows.map((row) => String(row.pr_no || '').trim()).filter(Boolean))
    const qty = rows.reduce((sum, row) => sum + receivedQty(row), 0)
    const value = rows.reduce((sum, row) => {
      const amount = numericRowField(row, 'amount', [
        'Amount', 'PO Amount', 'PO Value', 'Total Amount', 'Value',
        'Line Amount', 'Net Amount', 'Line Value', 'Total Value', 'Purchase Amount',
      ]) ?? 0
      const requested = requestedQty(row)
      const received = receivedQty(row)
      if (!(amount > 0) || !(received > 0)) return sum
      return sum + (requested > 0 ? amount * Math.min(1, received / requested) : amount)
    }, 0)

    return { rows, prs: prs.size, lines: rows.length, qty, value }
  }

  const warehouseReceiptCurrent = warehouseReceiptSummaryForWeek(warehouseWeekStart)
  const warehouseReceiptPrevious = warehouseReceiptSummaryForWeek(warehousePreviousWeekStart)

  const warehouseMonthStart = todayIso.slice(0, 7) + '-01'
  const warehouseMonthLabel = new Date(todayIso + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const warehouseReceiptMonth = useMemo(() => {
    const rows = allPrLines.filter((row) => {
      const date = receivedDate(row)
      return date && date >= warehouseMonthStart && date <= todayIso && receivedQty(row) > 0
    })

    const prs = new Set(rows.map((row) => String(row.pr_no || '').trim()).filter(Boolean))
    const qty = rows.reduce((sum, row) => sum + receivedQty(row), 0)
    const value = rows.reduce((sum, row) => {
      const amount = numericRowField(row, 'amount', [
        'Amount', 'PO Amount', 'PO Value', 'Total Amount', 'Value',
        'Line Amount', 'Net Amount', 'Line Value', 'Total Value', 'Purchase Amount',
      ]) ?? 0
      const requested = requestedQty(row)
      const received = receivedQty(row)
      if (!(amount > 0) || !(received > 0)) return sum
      return sum + (requested > 0 ? amount * Math.min(1, received / requested) : amount)
    }, 0)

    return { rows, prs: prs.size, qty, value }
  }, [allPrLines, warehouseMonthStart, todayIso])

  const warehouseMrnMonth = useMemo(() => {
    const rows = allMrnRows.filter((row) => {
      const date = mrnCreatedDate(row)
      return date && date >= warehouseMonthStart && date <= todayIso
    })
    const pending = new Set()
    rows.forEach((row) => {
      const id = mrnSourceId(row)
      if (id && mrnIsPending(row)) pending.add(id)
    })
    return { created: rows.length, pending: pending.size }
  }, [allMrnRows, warehouseMonthStart, todayIso])

  const warehouseIssueMonth = useMemo(() => {
    const rows = srIssuesEnriched.filter((row) => {
      const date = parseFlexibleDate(row.requested_receipt_date)
      return date && date >= warehouseMonthStart && date <= todayIso
    })
    const active = rows.filter((row) => row.issue_stage !== 'Cancelled')
    const priced = active.filter((row) => Number(row.cost_unit_price || 0) > 0)
    return {
      total: rows.length,
      invoiced: rows.filter((row) => row.issue_stage === 'Invoiced').length,
      delivered: rows.filter((row) => row.issue_stage === 'Delivered').length,
      openOrder: rows.filter((row) => ['Open Order', 'Delivered'].includes(row.issue_stage)).length,
      value: active.reduce((sum, row) => sum + Number(row.issue_value || 0), 0),
      pendingValue: rows
        .filter((row) => ['Open Order', 'Delivered'].includes(row.issue_stage))
        .reduce((sum, row) => sum + Number(row.issue_value || 0), 0),
      costCoverage: active.length ? (priced.length / active.length) * 100 : 0,
    }
  }, [srIssuesEnriched, warehouseMonthStart, todayIso])

  const warehouseReceiptPrState = useMemo(() => {
    const receivedPrNos = new Set(
      warehouseReceiptCurrent.rows
        .map((row) => String(row.pr_no || '').trim())
        .filter(Boolean),
    )

    const states = new Map()
    receivedPrNos.forEach((prNo) => {
      const rows = allPrLines.filter((row) => String(row.pr_no || '').trim() === prNo)
      let requested = 0
      let received = 0
      let fullLines = 0
      let partialLines = 0

      rows.forEach((row) => {
        const req = requestedQty(row)
        const rec = receivedQty(row)
        const state = receiptState(row)
        requested += req
        received += Math.min(req > 0 ? req : Number.MAX_SAFE_INTEGER, rec)
        if (state === 'full') fullLines += 1
        if (state === 'partial') partialLines += 1
      })

      const full =
        (requested > 0 && received >= requested) ||
        (rows.length > 0 && fullLines === rows.length)

      states.set(prNo, {
        prNo,
        rows,
        requested,
        received,
        full,
        partial: !full && (received > 0 || partialLines > 0 || fullLines > 0),
      })
    })

    return states
  }, [warehouseReceiptCurrent.rows, allPrLines])

  const warehouseFullyReceivedPrNos = useMemo(
    () => new Set([...warehouseReceiptPrState.values()].filter((x) => x.full).map((x) => x.prNo)),
    [warehouseReceiptPrState],
  )

  const warehousePartReceivedPrNos = useMemo(
    () => new Set([...warehouseReceiptPrState.values()].filter((x) => x.partial).map((x) => x.prNo)),
    [warehouseReceiptPrState],
  )

  const warehouseReceiptDetailRows = useMemo(() => {
    if (warehouseReceiptDetail === 'ALL') {
      return warehouseReceiptCurrent.rows
    }

    if (warehouseReceiptDetail === 'FULL') {
      return warehouseReceiptCurrent.rows.filter((row) =>
        warehouseFullyReceivedPrNos.has(String(row.pr_no || '').trim())
      )
    }

    if (warehouseReceiptDetail === 'PARTIAL') {
      return allPrLines.filter((row) =>
        warehousePartReceivedPrNos.has(String(row.pr_no || '').trim())
      )
    }

    return []
  }, [
    warehouseReceiptDetail,
    warehouseReceiptCurrent.rows,
    warehouseFullyReceivedPrNos,
    warehousePartReceivedPrNos,
    allPrLines,
  ])

  const warehouseReceiptDetailTitle =
    warehouseReceiptDetail === 'PARTIAL'
      ? 'Part Received PR Details'
      : warehouseReceiptDetail === 'FULL'
        ? 'Fully Received PR Items'
        : 'PR Receipt Items'

  const warehouseMrnCreated = useMemo(
    () => allMrnRows.filter((row) => weekStartWednesday(mrnCreatedDate(row)) === warehouseWeekStart).length,
    [allMrnRows, warehouseWeekStart],
  )

  const warehouseMrnWeekOptions = useMemo(() => {
    const latestCompletedWeek = addDaysIso(weekStartWednesday(new Date().toISOString().slice(0, 10)), -7)
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(latestCompletedWeek, index * -7)
      return { weekStart, weekEnd: addDaysIso(weekStart, 6) }
    })
  }, [])

  const warehouseMrnSelectedRows = useMemo(
    () => allMrnRows.filter((row) => weekStartWednesday(mrnCreatedDate(row)) === warehouseMrnWeekFilter),
    [allMrnRows, warehouseMrnWeekFilter],
  )

  const warehouseMrnLive = useMemo(() => {
    const issued = new Set()
    const pending = new Set()
    const pending30 = new Set()
    const noJournal = new Set()

    warehouseMrnSelectedRows.forEach((row) => {
      const id = mrnSourceId(row)
      if (!id) return
      if (mrnIsIssued(row)) issued.add(id)
      if (mrnIsPending(row)) {
        pending.add(id)
        if (mrnAgeDays(row) >= 30) pending30.add(id)
        if (!mrnHasJournal(row)) noJournal.add(id)
      }
    })

    return {
      total: warehouseMrnSelectedRows.length,
      issued: issued.size,
      pending: pending.size,
      pending30: pending30.size,
      noJournal: noJournal.size,
    }
  }, [warehouseMrnSelectedRows])

  const warehousePendingWorkshopCounts = useMemo(() => {
    const counts = new Map()
    warehouseMrnSelectedRows.forEach((row) => {
      if (!mrnIsPending(row)) return
      const workshop = String(rawField(row, ['WORKSHOP NAME']) || row.workshop || '').trim() || 'BLANK'
      counts.set(workshop, (counts.get(workshop) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [warehouseMrnSelectedRows])

  const warehouseIssueWeekOptions = useMemo(() => {
    const latestCompletedWeek = addDaysIso(weekStartWednesday(new Date().toISOString().slice(0, 10)), -7)
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(latestCompletedWeek, index * -7)
      return { weekStart, weekEnd: addDaysIso(weekStart, 6) }
    })
  }, [])

  const summarizeWarehouseIssues = (weekStart) => {
    const rows = srIssuesEnriched.filter((row) => {
      const date = parseFlexibleDate(row.requested_receipt_date)
      return date && weekStartWednesday(date) === weekStart
    })
    const active = rows.filter((row) => row.issue_stage !== 'Cancelled')
    const priced = active.filter((row) => Number(row.cost_unit_price || 0) > 0)
    return {
      rows,
      total: rows.length,
      invoiced: rows.filter((row) => row.issue_stage === 'Invoiced').length,
      delivered: rows.filter((row) => row.issue_stage === 'Delivered').length,
      openOrder: rows.filter((row) => ['Open Order', 'Delivered'].includes(row.issue_stage)).length,
      cancelled: rows.filter((row) => row.issue_stage === 'Cancelled').length,
      issueValue: active.reduce((sum, row) => sum + Number(row.issue_value || 0), 0),
      pendingValue: rows
        .filter((row) => ['Open Order', 'Delivered'].includes(row.issue_stage))
        .reduce((sum, row) => sum + Number(row.issue_value || 0), 0),
      costCoverage: active.length ? (priced.length / active.length) * 100 : 0,
      salesOrders: new Set(rows.map((row) => row.sales_order).filter(Boolean)).size,
      srs: new Set(rows.map((row) => normalizedSr(row.sr_no)).filter(Boolean)).size,
    }
  }

  const warehouseIssueReporting = useMemo(
    () => summarizeWarehouseIssues(warehouseWeekStart),
    [srIssuesEnriched, warehouseWeekStart],
  )

  const warehouseIssueWeek = useMemo(
    () => summarizeWarehouseIssues(warehouseIssueWeekFilter),
    [srIssuesEnriched, warehouseIssueWeekFilter],
  )

  const warehouseIssuePreviousWeek = useMemo(
    () => summarizeWarehouseIssues(addDaysIso(warehouseIssueWeekFilter, -7)).total,
    [srIssuesEnriched, warehouseIssueWeekFilter],
  )

  const warehouseSlides = [
    {
      kicker: 'WAREHOUSE MONTHLY SUMMARY',
      title: 'Warehouse Summary',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>MONTH-TO-DATE</span>
              <b>{warehouseMonthLabel}</b>
            </div>
            <small>{formatShortDate(warehouseMonthStart)} – {formatShortDate(todayIso)}</small>
          </div>
          <div className="meeting-metrics">
            <MetricCard label="PRs Received This Month" value={fmt(warehouseReceiptMonth.prs)} helper="Distinct PRs with receipt activity this month" />
            <MetricCard label="Received Quantity This Month" value={fmt(warehouseReceiptMonth.qty, 2)} helper="Total quantity received this month" />
            <MetricCard label="Received Value This Month" value={mvr(warehouseReceiptMonth.value)} helper="Value of items received this month" />
            <MetricCard label="MRNs Created This Month" value={fmt(warehouseMrnMonth.created)} helper="MRN records created this month" />
            <MetricCard label="Pending / Not Issued This Month" value={fmt(warehouseMrnMonth.pending)} tone="bad" helper="MRNs created this month that remain pending / not issued" />
            <MetricCard label="SR Issues This Month" value={fmt(warehouseIssueMonth.total)} helper={mvr(warehouseIssueMonth.value) + ' issue value · ' + fmt(warehouseIssueMonth.openOrder) + ' open'} />
          </div>
        </>
      ),
    },
    {
      kicker: 'RECEIPT ACTIVITY',
      title: 'PR / PO Receipts',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>REPORTING PERIOD RECEIPTS</span>
              <b>{formatShortDate(warehouseWeekStart)} – {formatShortDate(warehouseWeekEnd)}</b>
            </div>
            <small>Based on Received Date in PR / PO Tracker</small>
          </div>

          <div className="meeting-change-grid warehouse-receipt-cards">
            <button
              className={warehouseReceiptDetail === 'ALL' ? 'meeting-change-card receipt-card active' : 'meeting-change-card receipt-card'}
              onClick={() => setWarehouseReceiptDetail((current) => current === 'ALL' ? 'NONE' : 'ALL')}
            >
              <span>PRs received</span>
              <b>{fmt(warehouseReceiptCurrent.prs)}</b>
              <div>
                <small>Previous period: {fmt(warehouseReceiptPrevious.prs)}</small>
                <strong>Click to list received items</strong>
              </div>
            </button>

            <button
              className={warehouseReceiptDetail === 'FULL' ? 'meeting-change-card receipt-card active' : 'meeting-change-card receipt-card'}
              onClick={() => setWarehouseReceiptDetail((current) => current === 'FULL' ? 'NONE' : 'FULL')}
            >
              <span>Fully received PRs</span>
              <b>{fmt(warehouseFullyReceivedPrNos.size)}</b>
              <div>
                <small>Completed receipt status</small>
                <strong>Click to view items</strong>
              </div>
            </button>

            <button
              className={warehouseReceiptDetail === 'PARTIAL' ? 'meeting-change-card receipt-card active' : 'meeting-change-card receipt-card'}
              onClick={() => setWarehouseReceiptDetail((current) => current === 'PARTIAL' ? 'NONE' : 'PARTIAL')}
            >
              <span>Part received PRs</span>
              <b>{fmt(warehousePartReceivedPrNos.size)}</b>
              <div>
                <small>PRs with remaining quantities</small>
                <strong>Click to view full PR detail</strong>
              </div>
            </button>

            <div className="meeting-change-card">
              <span>Received quantity</span>
              <b>{fmt(warehouseReceiptCurrent.qty, 2)}</b>
              <div>
                <small>Previous period: {fmt(warehouseReceiptPrevious.qty, 2)}</small>
                <strong>{deltaText(warehouseReceiptCurrent.qty, warehouseReceiptPrevious.qty)}</strong>
              </div>
            </div>

            <div className="meeting-change-card">
              <span>Received value</span>
              <b>{mvr(warehouseReceiptCurrent.value)}</b>
              <div>
                <small>Previous period: {mvr(warehouseReceiptPrevious.value)}</small>
                <strong>{deltaText(warehouseReceiptCurrent.value, warehouseReceiptPrevious.value)}</strong>
              </div>
            </div>
          </div>

          {warehouseReceiptDetail !== 'NONE' && (
            <section className="warehouse-receipt-detail">
              <div className="warehouse-receipt-detail-head">
                <div>
                  <span className="eyebrow">RECEIPT DETAILS</span>
                  <h4>{warehouseReceiptDetailTitle}</h4>
                </div>
                <div>
                  <strong>{fmt(warehouseReceiptDetailRows.length)} item lines</strong>
                  <button onClick={() => setWarehouseReceiptDetail('NONE')}>Close</button>
                </div>
              </div>

              <div className="warehouse-receipt-table">
                <div className="warehouse-receipt-row warehouse-receipt-head">
                  <span>PR</span>
                  <span>PO</span>
                  <span>Item</span>
                  <span>Description</span>
                  <span>Requested</span>
                  <span>Received</span>
                  <span>Balance</span>
                  <span>Status</span>
                </div>
                {warehouseReceiptDetailRows.slice(0, 80).map((row, index) => {
                  const requested = requestedQty(row)
                  const received = receivedQty(row)
                  const balance = Math.max(0, requested - received)
                  const state = receiptState(row)
                  const status = state === 'full' ? 'Fully received' : received > 0 ? 'Part received' : 'Not received'
                  return (
                    <div className="warehouse-receipt-row" key={(row.pr_no || 'pr') + '-' + (row.item_code || index) + '-' + index}>
                      <b>{row.pr_no || '—'}</b>
                      <span>{row.po_no || '—'}</span>
                      <span>{row.item_code || '—'}</span>
                      <span title={row.item_description || ''}>{row.item_description || '—'}</span>
                      <span>{fmt(requested, 2)}</span>
                      <span>{fmt(received, 2)}</span>
                      <span>{fmt(balance, 2)}</span>
                      <em className={status === 'Fully received' ? 'good' : status === 'Part received' ? 'warn' : 'bad'}>{status}</em>
                    </div>
                  )
                })}
                {!warehouseReceiptDetailRows.length && <div className="meeting-no-exceptions">No receipt details found for this selection.</div>}
              </div>
            </section>
          )}
        </>
      ),
    },
    {
      kicker: 'MRN & ISSUE CONTROL',
      title: 'MRN Operational Position',
      body: (
        <>
          <div className="warehouse-mrn-week-selector">
            <div>
              <span className="eyebrow">MRN REPORTING WEEK</span>
              <strong>{formatShortDate(warehouseMrnWeekFilter)} – {formatShortDate(addDaysIso(warehouseMrnWeekFilter, 6))}</strong>
              <small>All figures below are based only on MRNs created in the selected week.</small>
            </div>
            <select value={warehouseMrnWeekFilter} onChange={(e) => setWarehouseMrnWeekFilter(e.target.value)}>
              {warehouseMrnWeekOptions.map((week) => (
                <option key={week.weekStart} value={week.weekStart}>
                  {formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}
                </option>
              ))}
            </select>
          </div>

          <div className="meeting-exception-metrics">
            <div><span>Total MRN records</span><b>{fmt(warehouseMrnLive.total)}</b></div>
            <div><span>Issued</span><b>{fmt(warehouseMrnLive.issued)}</b></div>
            <div><span>Pending / not issued</span><b>{fmt(warehouseMrnLive.pending)}</b></div>
            <div><span>Pending 30+ days</span><b>{fmt(warehouseMrnLive.pending30)}</b></div>
            <div><span>Without SVO / Journal</span><b>{fmt(warehouseMrnLive.noJournal)}</b></div>
            <div><span>Created in selected week</span><b>{fmt(warehouseMrnLive.total)}</b></div>
          </div>
          <div className="meeting-control-grid">
            <section>
              <div className="meeting-control-head"><span>MRN</span><b>Selected Week Control</b></div>
              <div className="meeting-control-row"><span>Pending / not issued</span><strong>{fmt(warehouseMrnLive.pending)}</strong></div>
              <div className="meeting-control-row critical"><span>Pending 30+ days</span><strong>{fmt(warehouseMrnLive.pending30)}</strong></div>
              <div className="meeting-control-row critical"><span>Without SVO / Journal</span><strong>{fmt(warehouseMrnLive.noJournal)}</strong></div>
            </section>
            <section>
              <div className="meeting-control-head"><span>WORKSHOP</span><b>Top Pending MRNs</b></div>
              {warehousePendingWorkshopCounts.map(([workshop, count]) => (
                <div className="meeting-control-row" key={workshop}><span>{workshop}</span><strong>{fmt(count)}</strong></div>
              ))}
              {!warehousePendingWorkshopCounts.length && <div className="meeting-no-exceptions">No pending MRNs in the selected week.</div>}
            </section>
          </div>
        </>
      ),
    },
    {
      kicker: 'SR ISSUE ACTIVITY',
      title: 'Issues — Reporting Period',
      body: (
        <>
          <div className="warehouse-mrn-week-selector">
            <div>
              <span className="eyebrow">ISSUE REPORTING WEEK</span>
              <strong>{formatShortDate(warehouseIssueWeekFilter)} – {formatShortDate(addDaysIso(warehouseIssueWeekFilter, 6))}</strong>
              <small>Issue activity and item details below follow the selected week.</small>
            </div>
            <select
              value={warehouseIssueWeekFilter}
              onChange={(e) => {
                setWarehouseIssueWeekFilter(e.target.value)
                setWarehouseIssueDetailOpen(false)
              }}
            >
              {warehouseIssueWeekOptions.map((week) => (
                <option key={week.weekStart} value={week.weekStart}>
                  {formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}
                </option>
              ))}
            </select>
          </div>

          <div className="meeting-exception-metrics warehouse-issue-metrics">
            <button
              className={warehouseIssueDetailOpen ? 'warehouse-issue-metric active' : 'warehouse-issue-metric'}
              onClick={() => setWarehouseIssueDetailOpen((current) => !current)}
            >
              <span>Issue lines</span>
              <b>{fmt(warehouseIssueWeek.total)}</b>
              <small>Click to list issue items</small>
            </button>
            <div><span>Invoiced</span><b>{fmt(warehouseIssueWeek.invoiced)}</b></div>
            <div><span>Open Order</span><b>{fmt(warehouseIssueWeek.openOrder)}</b><small>Includes Delivered</small></div>
            <div><span>Issue value</span><b>{mvr(warehouseIssueWeek.issueValue)}</b></div>
            <div><span>Pending value</span><b>{mvr(warehouseIssueWeek.pendingValue)}</b></div>
            <div><span>Sales orders</span><b>{fmt(warehouseIssueWeek.salesOrders)}</b></div>
            <div><span>Service requests</span><b>{fmt(warehouseIssueWeek.srs)}</b></div>
          </div>

          {warehouseIssueDetailOpen && (
            <section className="warehouse-receipt-detail warehouse-issue-detail">
              <div className="warehouse-receipt-detail-head">
                <div>
                  <span className="eyebrow">ISSUE ITEM DETAILS</span>
                  <h4>{formatShortDate(warehouseIssueWeekFilter)} – {formatShortDate(addDaysIso(warehouseIssueWeekFilter, 6))}</h4>
                </div>
                <div>
                  <strong>{fmt(warehouseIssueWeek.rows.length)} item lines</strong>
                  <button onClick={() => setWarehouseIssueDetailOpen(false)}>Close</button>
                </div>
              </div>

              <div className="warehouse-issue-table">
                <div className="warehouse-issue-row warehouse-receipt-head">
                  <span>Date</span>
                  <span>Sales Order</span>
                  <span>Item</span>
                  <span>Product Name</span>
                  <span>Qty</span>
                  <span>Unit Cost</span>
                  <span>Line Value</span>
                  <span>SR</span>
                  <span>Status</span>
                </div>
                {warehouseIssueWeek.rows.slice(0, 120).map((row, index) => (
                  <div className="warehouse-issue-row" key={(row.sales_order || 'issue') + '-' + (row.item_code || index) + '-' + index}>
                    <span>{parseFlexibleDate(row.requested_receipt_date) || '—'}</span>
                    <b>{row.sales_order || '—'}</b>
                    <span>{row.item_code || '—'}</span>
                    <span title={row.item_description || ''}>{row.item_description || '—'}</span>
                    <span>{fmt(row.quantity, 2)}</span>
                    <span>{Number(row.cost_unit_price || 0) > 0 ? mvr(row.cost_unit_price) : '—'}</span>
                    <span>{Number(row.issue_value || 0) > 0 ? mvr(row.issue_value) : '—'}</span>
                    <span>{row.sr_no || '—'}</span>
                    <em>{row.issue_stage || row.issue_state || '—'}</em>
                  </div>
                ))}
                {!warehouseIssueWeek.rows.length && (
                  <div className="meeting-no-exceptions">No issue item records found for the selected week.</div>
                )}
              </div>
            </section>
          )}

          <div className="meeting-period-banner" style={{ marginTop: 18 }}>
            <div>
              <span>PERIOD-ON-PERIOD ISSUE ACTIVITY</span>
              <b>{fmt(warehouseIssuePreviousWeek)} → {fmt(warehouseIssueWeek.total)} records</b>
            </div>
            <small>{deltaText(warehouseIssueWeek.total, warehouseIssuePreviousWeek)}</small>
          </div>
        </>
      ),
    },
  ]

  const inventoryConsumption = useMemo(() => {
    const yearStart = new Date().getFullYear() + '-01-01'
    const stockMap = new Map(
      data.stock.map((row) => [String(row.item_code || '').trim().toUpperCase(), row])
    )
    const map = new Map()

    data.transactions.forEach((row) => {
      const status = lower(row.status)
      const date = parseFlexibleDate(row.physical_date)
      if (!date || date < yearStart) return
      if (!status.includes('sold') && !status.includes('deducted')) return

      const itemCode = String(row.item_code || '').trim()
      if (!itemCode) return
      const key = itemCode.toUpperCase()
      const current = map.get(key) || {
        item_code: itemCode,
        item_description: row.item_description || '',
        quantity: 0,
        value: 0,
      }
      current.quantity += Math.abs(Number(row.quantity || 0))
      current.value += Math.abs(Number(row.cost || 0))
      if (!current.item_description) current.item_description = row.item_description || ''
      map.set(key, current)
    })

    return [...map.values()]
      .map((row) => {
        const stock = stockMap.get(String(row.item_code || '').trim().toUpperCase())
        return {
          ...row,
          item_description: stock?.item_description || row.item_description,
          on_hand: Number(stock?.on_hand || 0),
          stock_value: Number(stock?.stock_value || 0),
        }
      })
      .sort((a, b) => b.value - a.value)
  }, [data.transactions, data.stock])

  const inventoryHighUseTop100 = useMemo(
    () => inventoryConsumption.slice(0, 100),
    [inventoryConsumption],
  )

  const inventoryHighUseLowStock = useMemo(
    () => inventoryHighUseTop100.filter((row) => row.on_hand > 0 && row.on_hand <= 5),
    [inventoryHighUseTop100],
  )

  const inventoryHighUseOutOfStock = useMemo(
    () => inventoryHighUseTop100.filter((row) => row.on_hand <= 0),
    [inventoryHighUseTop100],
  )

  const inventoryPresentationProcurement = useMemo(() => {
    const monthStart = todayIso.slice(0, 7) + '-01'
    const submittedPrs = new Set()
    const receiptPendingPos = new Set()
    const urgentPendingPrs = new Set()

    allPrLines.forEach((row) => {
      const prNo = String(row.pr_no || '').trim()
      const poNo = String(row.po_no || '').trim()
      const submitted = prSubmittedDate(row)

      if (prNo && submitted && submitted >= monthStart && submitted <= todayIso) submittedPrs.add(prNo)
      if (poNo && isReceiptNotDoneRow(row)) receiptPendingPos.add(poNo)
      if (prNo && isUrgentPendingRow(row)) urgentPendingPrs.add(prNo)
    })

    return {
      submittedThisMonth: submittedPrs.size,
      receiptPendingPos: receiptPendingPos.size,
      urgentPendingPrs: urgentPendingPrs.size,
      agedThreeToSix: prPoAgeing.agedThreeToSix,
      agedSixPlus: prPoAgeing.agedSixPlus,
      oldestOpenDays: prPoAgeing.oldestOpenDays,
      paymentPendingPos: pendingPaymentPoCount,
    }
  }, [allPrLines, prPoAgeing, pendingPaymentPoCount, todayIso])

  const inventoryPresentationMaterials = useMemo(() => {
    const mtrMap = new Map()
    allMtrRows.forEach((row) => {
      const no = String(row.document_no || '').trim()
      if (!no) return
      const req = mtrRequestedQty(row)
      const tr = mtrTransferredQty(row)
      const rem = mtrRemainingQty(row)
      const current = mtrMap.get(no) || { requested: 0, transferred: 0, remaining: 0, rows: [] }
      current.requested += req
      current.transferred += tr
      current.remaining += rem
      current.rows.push(row)
      mtrMap.set(no, current)
    })

    let mtrPending = 0
    let mtrPartial = 0
    let mtrNoStock = 0
    let mtr30 = 0
    for (const entry of mtrMap.values()) {
      const pending = entry.remaining > 0 || (entry.requested > 0 && entry.transferred < entry.requested)
      if (!pending) continue
      mtrPending += 1
      if (entry.transferred > 0) mtrPartial += 1
      if (entry.rows.some((row) => !mtrStockAvailable(row))) mtrNoStock += 1
      if (entry.rows.some((row) => mtrAgeDays(row) >= 30)) mtr30 += 1
    }

    const mrnPending = new Set()
    const mrn30 = new Set()
    const mrnNoJournal = new Set()
    allMrnRows.forEach((row) => {
      if (!mrnIsPending(row)) return
      const id = mrnSourceId(row)
      if (!id) return
      mrnPending.add(id)
      if (mrnAgeDays(row) >= 30) mrn30.add(id)
      if (!mrnHasJournal(row)) mrnNoJournal.add(id)
    })

    return {
      mtrTotal: mtrMap.size,
      mtrPending,
      mtrPartial,
      mtrNoStock,
      mtr30,
      mrnTotal: allMrnRows.length,
      mrnPending: mrnPending.size,
      mrn30: mrn30.size,
      mrnNoJournal: mrnNoJournal.size,
    }
  }, [allMtrRows, allMrnRows])

  const inventoryPresentationSlides = [
    {
      kicker: 'MATERIALS & PROCUREMENT SUMMARY',
      title: 'Operational Position',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>MONTH-TO-DATE + CURRENT OPEN POSITION</span>
              <b>{warehouseMonthLabel}</b>
            </div>
            <small>Procurement, receipts, payments, material transfers and inventory risk</small>
          </div>
          <div className="meeting-metrics">
            <MetricCard label="PRs Submitted This Month" value={fmt(inventoryPresentationProcurement.submittedThisMonth)} helper="Distinct purchase requisitions submitted" />
            <MetricCard label="PRs Received This Month" value={fmt(warehouseReceiptMonth.prs)} helper={fmt(warehouseReceiptMonth.qty, 2) + ' quantity received'} />
            <MetricCard label="Received Value This Month" value={mvr(warehouseReceiptMonth.value)} helper="Receipt value recorded this month" />
            <MetricCard label="Pending Payment POs" value={fmt(pendingPaymentsSummary.total)} tone="warn" helper={mvr(pendingPaymentsSummary.totalValue) + ' pending value'} />
            <MetricCard label="Pending MTRs" value={fmt(inventoryPresentationMaterials.mtrPending)} tone="warn" helper={fmt(inventoryPresentationMaterials.mtrNoStock) + ' with no SRD stock'} />
            <MetricCard label="Pending MRNs" value={fmt(inventoryPresentationMaterials.mrnPending)} tone="warn" helper={fmt(inventoryPresentationMaterials.mrn30) + ' pending 30+ days'} />
            <MetricCard label="High-Use Low Stock" value={fmt(inventoryHighUseLowStock.length)} helper="Top 100 consumption-value items at 1–5 on hand" />
            <MetricCard label="High-Use Out of Stock" value={fmt(inventoryHighUseOutOfStock.length)} tone="bad" helper="Top 100 consumption-value items with zero stock" />
          </div>
        </>
      ),
    },
    {
      kicker: 'PROCUREMENT CONTROL',
      title: 'PR / PO Open Position',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>OPEN PROCUREMENT FOLLOW-UP</span>
              <b>{fmt(inventoryPresentationProcurement.receiptPendingPos)} POs awaiting receipt</b>
            </div>
            <small>Ageing, urgency, receipts and payment follow-up</small>
          </div>
          <div className="meeting-exception-metrics">
            <div><span>PRs Submitted This Month</span><b>{fmt(inventoryPresentationProcurement.submittedThisMonth)}</b></div>
            <div><span>POs Receipt Not Done</span><b>{fmt(inventoryPresentationProcurement.receiptPendingPos)}</b></div>
            <div><span>Urgent Pending PRs</span><b>{fmt(inventoryPresentationProcurement.urgentPendingPrs)}</b></div>
            <div><span>PRs Aged 3–6 Months</span><b>{fmt(inventoryPresentationProcurement.agedThreeToSix)}</b></div>
            <div><span>PRs Aged 6+ Months</span><b>{fmt(inventoryPresentationProcurement.agedSixPlus)}</b></div>
            <div><span>Oldest Open PR</span><b>{fmt(inventoryPresentationProcurement.oldestOpenDays)} days</b></div>
            <div><span>Payment Pending POs</span><b>{fmt(inventoryPresentationProcurement.paymentPendingPos)}</b></div>
          </div>
          <div className="meeting-period-banner" style={{ marginTop: 18 }}>
            <div>
              <span>PROCUREMENT PRIORITY</span>
              <b>{fmt(inventoryPresentationProcurement.urgentPendingPrs + inventoryPresentationProcurement.agedSixPlus)} high-attention PRs</b>
            </div>
            <small>Urgent pending plus PRs aged six months or more</small>
          </div>
        </>
      ),
    },
    {
      kicker: 'RECEIPTS & DELIVERY',
      title: 'Goods Receipt Performance',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>LAST COMPLETED WEEK</span>
              <b>{formatShortDate(warehouseWeekStart)} – {formatShortDate(warehouseWeekEnd)}</b>
            </div>
            <small>Compared with the previous Wednesday–Tuesday period</small>
          </div>
          <div className="meeting-change-grid warehouse-receipt-cards">
            <div className="meeting-change-card">
              <span>PRs received</span>
              <b>{fmt(warehouseReceiptCurrent.prs)}</b>
              <div><small>Previous: {fmt(warehouseReceiptPrevious.prs)}</small><strong>{deltaText(warehouseReceiptCurrent.prs, warehouseReceiptPrevious.prs)}</strong></div>
            </div>
            <div className="meeting-change-card">
              <span>Received quantity</span>
              <b>{fmt(warehouseReceiptCurrent.qty, 2)}</b>
              <div><small>Previous: {fmt(warehouseReceiptPrevious.qty, 2)}</small><strong>{deltaText(warehouseReceiptCurrent.qty, warehouseReceiptPrevious.qty)}</strong></div>
            </div>
            <div className="meeting-change-card">
              <span>Received value</span>
              <b>{mvr(warehouseReceiptCurrent.value)}</b>
              <div><small>Previous: {mvr(warehouseReceiptPrevious.value)}</small><strong>{deltaText(warehouseReceiptCurrent.value, warehouseReceiptPrevious.value)}</strong></div>
            </div>
            <div className="meeting-change-card">
              <span>Fully received PRs</span>
              <b>{fmt(warehouseFullyReceivedPrNos.size)}</b>
              <div><small>Completed receipt position</small></div>
            </div>
            <div className="meeting-change-card">
              <span>Part received PRs</span>
              <b>{fmt(warehousePartReceivedPrNos.size)}</b>
              <div><small>PRs still carrying balance</small></div>
            </div>
          </div>
        </>
      ),
    },
    {
      kicker: 'PAYMENT CONTROL',
      title: 'Pending Payments',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>CURRENT PAYMENT EXPOSURE</span>
              <b>{mvr(pendingPaymentsSummary.totalValue)}</b>
            </div>
            <small>{fmt(pendingPaymentsSummary.total)} purchase orders awaiting payment action</small>
          </div>
          <div className="meeting-exception-metrics">
            <div><span>Pending POs</span><b>{fmt(pendingPaymentsSummary.total)}</b></div>
            <div><span>Urgent POs</span><b>{fmt(pendingPaymentsSummary.urgent)}</b></div>
            {pendingPaymentsSummary.statusCounts.slice(0, 5).map(([status, count]) => (
              <div key={status}><span>{status}</span><b>{fmt(count)}</b></div>
            ))}
          </div>
          <div className="meeting-period-banner" style={{ marginTop: 18 }}>
            <div>
              <span>MANAGEMENT FOCUS</span>
              <b>{fmt(pendingPaymentsSummary.urgent)} urgent payment POs</b>
            </div>
            <small>Prioritize payment blockers affecting delivery and receipt completion</small>
          </div>
        </>
      ),
    },
    {
      kicker: 'MATERIAL FLOW',
      title: 'MTR / MRN Control',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>WAREHOUSE MATERIAL MOVEMENT</span>
              <b>MTR → MRN → SR Issue</b>
            </div>
            <small>Current transfer and issue-control position</small>
          </div>
          <div className="meeting-exception-metrics">
            <div><span>Total MTRs</span><b>{fmt(inventoryPresentationMaterials.mtrTotal)}</b></div>
            <div><span>Pending MTRs</span><b>{fmt(inventoryPresentationMaterials.mtrPending)}</b></div>
            <div><span>Partially Transferred</span><b>{fmt(inventoryPresentationMaterials.mtrPartial)}</b></div>
            <div><span>Pending · No SRD Stock</span><b>{fmt(inventoryPresentationMaterials.mtrNoStock)}</b></div>
            <div><span>MTR Pending 30+ Days</span><b>{fmt(inventoryPresentationMaterials.mtr30)}</b></div>
            <div><span>Pending MRNs</span><b>{fmt(inventoryPresentationMaterials.mrnPending)}</b></div>
            <div><span>MRN Pending 30+ Days</span><b>{fmt(inventoryPresentationMaterials.mrn30)}</b></div>
            <div><span>MRN Without SVO / Journal</span><b>{fmt(inventoryPresentationMaterials.mrnNoJournal)}</b></div>
          </div>
        </>
      ),
    },
    {
      kicker: 'INVENTORY RISK',
      title: 'Consumption-Driven Stock Position',
      body: (
        <>
          <div className="meeting-period-banner">
            <div>
              <span>TOP 100 ITEMS BY CONSUMPTION VALUE</span>
              <b>{fmt(inventoryHighUseLowStock.length + inventoryHighUseOutOfStock.length)} items require attention</b>
            </div>
            <small>High-use inventory risk, with ageing kept as a secondary control</small>
          </div>
          <div className="meeting-exception-metrics">
            <div><span>High-Use Low Stock</span><b>{fmt(inventoryHighUseLowStock.length)}</b></div>
            <div><span>High-Use Out of Stock</span><b>{fmt(inventoryHighUseOutOfStock.length)}</b></div>
            <div><span>YTD Consumption Value</span><b>{mvr(inventoryConsumption.reduce((sum, row) => sum + row.value, 0))}</b></div>
            <div><span>Current Inventory Value</span><b>{mvr(ageingSummary.onHandValue)}</b></div>
            <div><span>Aged 1+ Year</span><b>{mvr(ageingSummary.agedOver365)}</b></div>
          </div>
          <div className="warehouse-receipt-table" style={{ marginTop: 18 }}>
            <div className="warehouse-receipt-row warehouse-receipt-head">
              <span>Rank</span><span>Item</span><span>Description</span><span>Consumption Value</span><span>On Hand</span><span>Status</span><span></span><span></span>
            </div>
            {inventoryHighUseTop100
              .filter((row) => row.on_hand <= 5)
              .slice(0, 10)
              .map((row, index) => (
                <div className="warehouse-receipt-row" key={row.item_code || index}>
                  <b>{inventoryHighUseTop100.findIndex((x) => x.item_code === row.item_code) + 1}</b>
                  <span>{row.item_code || '—'}</span>
                  <span title={row.item_description || ''}>{row.item_description || '—'}</span>
                  <strong>{mvr(row.value)}</strong>
                  <span>{fmt(row.on_hand, 2)}</span>
                  <em>{row.on_hand <= 0 ? 'OUT OF STOCK' : 'LOW STOCK'}</em>
                  <span></span><span></span>
                </div>
              ))}
          </div>
        </>
      ),
    },
  ]
  const pendingPaymentsSummary = useMemo(() => {
    const rows = data.pendingPayments || []
    const totalValue = rows.reduce((sum, row) => sum + Number(row.po_value || 0), 0)
    const urgent = rows.filter((row) => isUrgent(row.priority)).length
    const statusCounts = new Map()
    rows.forEach((row) => {
      const status = String(row.status || '').trim() || 'BLANK'
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1)
    })
    return {
      total: rows.length,
      totalValue,
      urgent,
      statusCounts: [...statusCounts.entries()].sort((a, b) => b[1] - a[1]),
    }
  }, [data.pendingPayments])

  const pendingPaymentDetailRows = useMemo(() => {
    const rows = data.pendingPayments || []
    if (pendingPaymentDetailFilter === 'ALL') return rows
    if (pendingPaymentDetailFilter === 'URGENT') return rows.filter((row) => isUrgent(row.priority))
    return rows.filter((row) => String(row.status || '').trim() === pendingPaymentDetailFilter)
  }, [data.pendingPayments, pendingPaymentDetailFilter])

  const pendingPaymentDetailTitle =
    pendingPaymentDetailFilter === 'ALL'
      ? 'All Pending Payment POs'
      : pendingPaymentDetailFilter === 'URGENT'
        ? 'Urgent Pending Payment POs'
        : pendingPaymentDetailFilter

  const overviewPeriod = useMemo(() => {
    const rangeStart = overviewFrom <= overviewTo ? overviewFrom : overviewTo
    const rangeEnd = overviewFrom <= overviewTo ? overviewTo : overviewFrom
    const inRange = (date) => Boolean(date && date >= rangeStart && date <= rangeEnd)

    const submittedPrNos = new Set()
    const receivedPrNos = new Set()
    let receivedQtyTotal = 0
    let receivedValueTotal = 0

    allPrLines.forEach((row) => {
      const prNo = String(row.pr_no || '').trim()
      if (prNo && inRange(prSubmittedDate(row))) submittedPrNos.add(prNo)

      const rDate = receivedDate(row)
      const rQty = receivedQty(row)
      if (rDate && inRange(rDate) && rQty > 0) {
        if (prNo) receivedPrNos.add(prNo)
        receivedQtyTotal += rQty

        const amount = numericRowField(row, 'amount', [
          'Amount', 'PO Amount', 'PO Value', 'Total Amount', 'Value',
          'Line Amount', 'Net Amount', 'Line Value', 'Total Value', 'Purchase Amount',
        ]) ?? 0
        const requested = requestedQty(row)
        receivedValueTotal += amount > 0
          ? (requested > 0 ? amount * Math.min(1, rQty / requested) : amount)
          : 0
      }
    })

    const mtrNos = new Set(
      allMtrRows
        .filter((row) => inRange(mtrRequestDate(row)))
        .map((row) => String(row.document_no || '').trim())
        .filter(Boolean),
    )

    const mrnRowsPeriod = allMrnRows.filter((row) => inRange(mrnCreatedDate(row)))
    const mrnNos = new Set(mrnRowsPeriod.map((row) => String(row.document_no || '').trim()).filter(Boolean))
    const pendingMrnNos = new Set(
      mrnRowsPeriod
        .filter((row) => mrnIsPending(row))
        .map((row) => String(row.document_no || '').trim())
        .filter(Boolean),
    )

    const issueRows = srIssuesEnriched.filter((row) => inRange(parseFlexibleDate(row.requested_receipt_date)))
    const issueQty = issueRows.reduce((sum, row) => sum + Math.abs(Number(row.quantity || 0)), 0)

    const pendingPaymentValue = (data.pendingPayments || []).reduce((sum, row) => sum + Number(row.po_value || 0), 0)

    return {
      rangeStart,
      rangeEnd,
      submittedPrs: submittedPrNos.size,
      receivedPrs: receivedPrNos.size,
      receivedQty: receivedQtyTotal,
      receivedValue: receivedValueTotal,
      mtrs: mtrNos.size,
      mrns: mrnNos.size,
      pendingMrns: pendingMrnNos.size,
      issueRecords: issueRows.length,
      issueQty,
      pendingPaymentPos: (data.pendingPayments || []).length,
      pendingPaymentValue,
      stockQty: Number(ageingSnapshots.at(-1)?.metrics?.onHandQty || 0),
      stockValue: Number(ageingSnapshots.at(-1)?.metrics?.onHandValue || 0),
      agedValue: Number(ageingSnapshots.at(-1)?.metrics?.over1 || 0),
    }
  }, [
    overviewFrom,
    overviewTo,
    allPrLines,
    allMtrRows,
    allMrnRows,
    srIssuesEnriched,
    data.pendingPayments,
    ageingSnapshots,
  ])

  const overviewMovementMax = Math.max(overviewPeriod.receivedQty, overviewPeriod.issueQty, 1)
  const overviewPeriodLabel =
    overviewPeriod.rangeStart === overviewPeriod.rangeEnd
      ? formatShortDate(overviewPeriod.rangeStart)
      : formatShortDate(overviewPeriod.rangeStart) + ' – ' + formatShortDate(overviewPeriod.rangeEnd)

  function applyOverviewDateRange() {
    const from = overviewFromDraft || todayIso
    const to = overviewToDraft || todayIso
    setOverviewFrom(from <= to ? from : to)
    setOverviewTo(from <= to ? to : from)
  }


  const homePaymentTotal = useMemo(
    () => homeDashboard.pendingPayments.reduce((sum, row) => sum + Number(row.po_value || 0), 0),
    [homeDashboard.pendingPayments],
  )

  const homePaymentUrgent = useMemo(
    () => homeDashboard.pendingPayments.filter((row) => isUrgent(row.priority)).length,
    [homeDashboard.pendingPayments],
  )

  const homePaymentStatusCounts = useMemo(() => {
    const counts = new Map()
    homeDashboard.pendingPayments.forEach((row) => {
      const status = String(row.status || '').trim() || 'BLANK'
      counts.set(status, (counts.get(status) || 0) + 1)
    })
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  }, [homeDashboard.pendingPayments])

  const homeTopPaymentSuppliers = useMemo(() => {
    const totals = new Map()
    homeDashboard.pendingPayments.forEach((row) => {
      const supplier = String(row.supplier || 'Unknown supplier').trim() || 'Unknown supplier'
      totals.set(supplier, (totals.get(supplier) || 0) + Number(row.po_value || 0))
    })
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
  }, [homeDashboard.pendingPayments])

  const homeActivityDays = useMemo(() => {
    const counts = new Map()
    homeDashboard.activityUpdates.forEach((row) => {
      const date = String(row.imported_at || '').slice(0, 10)
      if (date) counts.set(date, (counts.get(date) || 0) + 1)
    })

    const today = new Date()
    return Array.from({ length: 35 }, (_, index) => {
      const date = new Date(today)
      date.setDate(today.getDate() - (34 - index))
      const iso = date.toISOString().slice(0, 10)
      return {
        iso,
        label: date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
        count: counts.get(iso) || 0,
      }
    })
  }, [homeDashboard.activityUpdates])

  if (checking) return <div className="splash">Loading SRD Warehouse System…</div>
  if (!session) return <AuthScreen />
  if (recoveringPassword) return <PasswordRecovery />
  if (access === null) return <div className="splash">Checking portal access…</div>
  if (access === false) return <AccessDenied email={session.user.email} />

  return (
    <div className="app-shell bg-slate-50">
      <aside className="sidebar !bg-[#0B1F3A] !border-r !border-white/10 !shadow-none">
        <div className="brand !border-white/10">
          <div className="brand-box !rounded-xl !bg-white/10 !text-white !shadow-none ring-1 ring-white/10">SRD</div>
          <div>
            <strong>SRD Warehouse</strong>
            <span>System</span>
          </div>
        </div>

        <nav className="enterprise-nav space-y-5">
          {NAV_GROUPS.map(([group, keys]) => {
            const items = NAV.filter(([key]) => keys.includes(key) && (canEdit || key !== 'updates'))
            if (!items.length) return null
            return (
              <div className="nav-group !mb-0" key={group}>
                <div className="nav-group-label !px-3 !pb-2 !text-[10px] !font-bold !uppercase !tracking-widest !text-slate-500">{group}</div>
                {items.map(([key, label, icon]) => (
                  <button
                    key={key}
                    className={
                      'nav-item group relative !min-h-0 !rounded-lg !pl-6 !pr-3 !py-2.5 !text-sm !font-medium transition-all duration-200 ' +
                      (view === key
                        ? '!bg-white/10 !text-white before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:rounded-full before:bg-blue-400'
                        : '!text-slate-300 hover:!bg-white/[0.06] hover:!text-white')
                    }
                    onClick={() => setView(key)}
                  >
                    <span className="!grid !h-5 !w-5 !place-items-center !bg-transparent !text-current">
                      <LineIcon name={key} className="h-[18px] w-[18px]" />
                    </span>
                    <span>{label}</span>
                  </button>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="sidebar-bottom">
          <span>{session.user.email}</span>
          <small>{access.role}</small>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar !min-h-[68px] !border-b !border-slate-200 !bg-white/95 !px-7 !shadow-sm backdrop-blur !items-center">
          <div className="topbar-context !border-slate-200">
            <span>SRD Warehouse</span>
            <strong>{NAV.find(([key]) => key === view)?.[1] || 'Workspace'}</strong>
          </div>
          <div className="search-wrap !min-h-[42px] !max-w-xl !rounded-xl !border-slate-200 !bg-slate-50 !px-3.5 transition focus-within:!border-blue-400 focus-within:!bg-white focus-within:!shadow-[0_0_0_3px_rgba(59,130,246,0.10)]">
            <LineIcon name="search" className="h-[18px] w-[18px] text-slate-400" />
            <input
              placeholder="Search PRF, PR, PO, MTR, MRN, item, vessel or SR…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && <button onClick={() => setSearch('')}>×</button>}
          </div>
          <div className="top-actions !items-center">
            <button className="secondary !inline-flex !items-center !gap-2 !rounded-lg !border-slate-200 !bg-white !px-3.5 !py-2 !text-sm !font-medium !text-slate-700 hover:!bg-slate-50" onClick={refreshCurrentView}>
              <LineIcon name="refresh" className="h-4 w-4" />{loading ? 'Refreshing…' : 'Refresh'}
            </button>
            {canEdit && (
              <button className="primary !inline-flex !items-center !gap-2 !rounded-lg !bg-blue-600 !px-4 !py-2 !text-sm !font-semibold !text-white !shadow-sm hover:!bg-blue-700" onClick={() => setView('updates')}>
                <LineIcon name="upload" className="h-4 w-4" />Update data
              </button>
            )}
          </div>
        </header>

        {query.length >= 2 && (
          <section className="search-results">
            <div className="search-result-head">
              <strong>Unified search</strong>
              <span>{globalHits.length} matching results shown</span>
            </div>
            <div className="search-hit-grid">
              {globalHits.map((hit, i) => (
                <button key={i} onClick={() => setView(hit.view)}>
                  <span>{hit.type}</span>
                  <b>{hit.ref || 'No reference'}</b>
                  <small>{hit.detail || '—'}</small>
                </button>
              ))}
              {!globalHits.length && <span className="muted">No matching records.</span>}
            </div>
          </section>
        )}

        <section className="content !bg-[#F8FAFC]">
          {view === 'home' && (
            <section className="home-dashboard-shell">
              <div className="home-dashboard-head">
                <div>
                  <span className="eyebrow">SHIPBUILDING & REPAIR DIVISION · MATERIALS MANAGEMENT</span>
                  <h1>Dashboard</h1>
                  <p>Warehouse, procurement and inventory control overview.</p>
                </div>

                <div className="home-dashboard-actions">
                  <button className="secondary" onClick={refreshCurrentView}>
                    <LineIcon name="refresh" className="h-4 w-4" />
                    {loading ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button className="secondary" onClick={() => setView('overview')}>
                    <LineIcon name="overview" className="h-4 w-4" />
                    Analytics
                  </button>
                  <button className="secondary" onClick={() => setView('stock')}>
                    <LineIcon name="stock" className="h-4 w-4" />
                    Inventory
                  </button>
                  {canEdit && (
                    <button className="primary" onClick={() => setView('updates')}>
                      <LineIcon name="upload" className="h-4 w-4" />
                      Update Data
                    </button>
                  )}
                </div>
              </div>

              <div className="home-dashboard-tabs">
                {[
                  ['overview', 'Overview', 'overview'],
                  ['prpo', 'Procurement', 'prpo'],
                  ['mtr', 'Materials', 'mtr'],
                  ['stock', 'Inventory Management', 'stock'],
                  ['mrn', 'MRN & Issues', 'mrn'],
                  ['warehouse', 'Reporting', 'history'],
                ].map(([target, label, icon]) => (
                  <button key={target} onClick={() => setView(target)}>
                    <LineIcon name={icon} className="h-4 w-4" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>

              <div className="home-kpi-grid">
                {[
                  {
                    label: 'Total Items',
                    value: fmt(homeDashboard.totalItems),
                    helper: 'Items in current inventory list',
                    icon: 'stock',
                    tone: 'green',
                    target: 'stock',
                  },
                  {
                    label: 'High-Use Low Stock',
                    value: fmt(homeDashboard.lowStockItems),
                    helper: 'Top 100 consumption-value items at 5 units or less',
                    icon: 'stock',
                    tone: 'blue',
                    target: 'stock',
                  },
                  {
                    label: 'High-Use Out of Stock',
                    value: fmt(homeDashboard.outOfStockItems),
                    helper: 'Top 100 consumption-value items with zero on-hand',
                    icon: 'prpo',
                    tone: 'orange',
                    target: 'stock',
                  },
                  {
                    label: 'Inventory Value',
                    value: mvr(homeSummary.stock_value),
                    helper: 'Current SRD on-hand value',
                    icon: 'stock',
                    tone: 'violet',
                    target: 'stock',
                  },
                ].map((card) => (
                  <button
                    key={card.label}
                    className={'home-kpi-card tone-' + card.tone}
                    onClick={() => setView(card.target)}
                  >
                    <span className="home-kpi-icon">
                      <LineIcon name={card.icon} className="h-5 w-5" />
                    </span>
                    <div>
                      <span className="home-kpi-label">{card.label}</span>
                      <strong>{card.value}</strong>
                      <small>{card.helper}</small>
                    </div>
                    <span className="home-kpi-arrow">↗</span>
                  </button>
                ))}
              </div>

              <div className="home-dashboard-main">
                <section className="home-analytics-card home-performance-panel">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">WAREHOUSE PERFORMANCE</span>
                      <h3>Operational Snapshot</h3>
                    </div>
                    <button onClick={() => setView('overview')}>Open analytics →</button>
                  </div>

                  <div className="home-snapshot-chart">
                    {[
                      ['PRF Register', Number(homeSummary.prf_count || 0), 'prf'],
                      ['MRN Register', Number(homeSummary.mrn_count || 0), 'mrn'],
                      ['Pending PR / PO', Number(homeSummary.pending_count || 0), 'prpo'],
                    ].map(([label, value, target]) => {
                      const maxValue = Math.max(
                        Number(homeSummary.prf_count || 0),
                        Number(homeSummary.mrn_count || 0),
                        Number(homeSummary.pending_count || 0),
                        1,
                      )
                      const width = Math.max(4, Math.min(100, (Number(value) / maxValue) * 100))
                      return (
                        <button key={label} className="home-snapshot-row" onClick={() => setView(target)}>
                          <span className="home-snapshot-label">{label}</span>
                          <span className="home-snapshot-track">
                            <span className="home-snapshot-fill" style={{ width: width + '%' }} />
                          </span>
                          <strong>{fmt(value)}</strong>
                        </button>
                      )
                    })}
                  </div>

                  <div className="home-value-strip">
                    <div>
                      <span>Inventory Value</span>
                      <strong>{mvr(homeSummary.stock_value)}</strong>
                    </div>
                    <div>
                      <span>Aged Stock Value</span>
                      <strong>{mvr(homeSummary.aged_value)}</strong>
                    </div>
                    <div>
                      <span>Aged Share</span>
                      <strong>
                        {Number(homeSummary.stock_value || 0) > 0
                          ? fmt((Number(homeSummary.aged_value || 0) / Number(homeSummary.stock_value || 0)) * 100, 1) + '%'
                          : '0.0%'}
                      </strong>
                    </div>
                  </div>
                </section>

                <section className="home-analytics-card home-inventory-health">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">INVENTORY HEALTH</span>
                      <h3>Current Value Position</h3>
                    </div>
                    <button onClick={() => setView('stock')}>Stock details →</button>
                  </div>

                  <div className="home-donut-wrap">
                    <div
                      className="home-donut"
                      style={{
                        '--aged': Math.max(
                          0,
                          Math.min(
                            100,
                            Number(homeSummary.stock_value || 0) > 0
                              ? (Number(homeSummary.aged_value || 0) / Number(homeSummary.stock_value || 0)) * 100
                              : 0,
                          ),
                        ) + '%',
                      }}
                    >
                      <div>
                        <strong>{mvr(homeSummary.stock_value)}</strong>
                        <span>Total</span>
                      </div>
                    </div>

                    <div className="home-donut-legend">
                      <div>
                        <span className="dot current" />
                        <section>
                          <b>Current / Other Stock</b>
                          <small>{mvr(Math.max(0, Number(homeSummary.stock_value || 0) - Number(homeSummary.aged_value || 0)))}</small>
                        </section>
                      </div>
                      <div>
                        <span className="dot aged" />
                        <section>
                          <b>Aged Stock</b>
                          <small>{mvr(homeSummary.aged_value)}</small>
                        </section>
                      </div>
                    </div>
                  </div>
                </section>
              </div>

              <div className="home-dashboard-insights">
                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">TOP INVENTORY</span>
                      <h3>Highest Stock Value Items</h3>
                    </div>
                    <button onClick={() => setView('stock')}>View inventory →</button>
                  </div>

                  <div className="home-top-stock-list">
                    {homeDashboard.topStock.map((row, index) => {
                      const max = Math.max(...homeDashboard.topStock.map((item) => Number(item.stock_value || 0)), 1)
                      const width = Math.max(3, (Number(row.stock_value || 0) / max) * 100)
                      return (
                        <button key={row.item_code || index} onClick={() => setView('stock')}>
                          <span className="home-rank">{index + 1}</span>
                          <section>
                            <div>
                              <b>{row.item_code || '—'}</b>
                              <small>{row.item_description || 'No description'}</small>
                            </div>
                            <div className="home-stock-bar">
                              <span style={{ width: width + '%' }} />
                            </div>
                          </section>
                          <strong>{mvr(row.stock_value)}</strong>
                        </button>
                      )
                    })}
                    {!homeDashboard.topStock.length && <EmptyState title="No stock data" text="Upload the latest stock or ageing source." />}
                  </div>
                </section>

                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">PAYMENTS</span>
                      <h3>Pending Payment Position</h3>
                    </div>
                    <button onClick={() => setView('payments')}>View payments →</button>
                  </div>

                  <div className="home-payment-hero">
                    <div>
                      <span>Total Pending Value</span>
                      <strong>{mvr(homePaymentTotal)}</strong>
                      <small>{fmt(homeDashboard.pendingPayments.length)} purchase orders</small>
                    </div>
                    <div>
                      <span>Urgent</span>
                      <strong>{fmt(homePaymentUrgent)}</strong>
                      <small>priority POs</small>
                    </div>
                  </div>

                  <div className="home-payment-status-list">
                    {homePaymentStatusCounts.map(([status, count]) => (
                      <button key={status} onClick={() => setView('payments')}>
                        <span>{status}</span>
                        <strong>{fmt(count)}</strong>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">ACTIVITY</span>
                      <h3>Latest Data Updates</h3>
                    </div>
                    <button onClick={() => setView('history')}>History →</button>
                  </div>

                  <div className="home-update-list">
                    {homeDashboard.recentUpdates.map((row, index) => (
                      <button key={(row.source_type || '') + index} onClick={() => setView('history')}>
                        <span className="home-update-dot" />
                        <section>
                          <b>{humanSource(row.source_type)}</b>
                          <small>{row.file_name || 'Source update'}</small>
                        </section>
                        <div>
                          <strong>{fmt(row.row_count)}</strong>
                          <small>{row.imported_at ? new Date(row.imported_at).toLocaleDateString() : '—'}</small>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="home-issue-month">
                    <span>SR issue records this month</span>
                    <strong>{fmt(homeDashboard.issueCountMonth)}</strong>
                  </div>
                </section>
              </div>

              <div className="home-dashboard-ageing">
                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">INVENTORY AGEING</span>
                      <h3>Ageing Value Profile</h3>
                    </div>
                    <button onClick={() => setView('stock')}>Ageing details →</button>
                  </div>

                  {homeDashboard.ageing?.metrics ? (
                    <div className="home-ageing-profile">
                      {[
                        ['1–2 Years', Number(homeDashboard.ageing.metrics.p2 || 0)],
                        ['2–3 Years', Number(homeDashboard.ageing.metrics.p3 || 0)],
                        ['3–4 Years', Number(homeDashboard.ageing.metrics.p4 || 0)],
                        ['4+ Years', Number(homeDashboard.ageing.metrics.p5 || 0)],
                      ].map(([label, value], index, rows) => {
                        const max = Math.max(...rows.map((item) => Number(item[1] || 0)), 1)
                        return (
                          <button key={label} onClick={() => setView('stock')}>
                            <span>{label}</span>
                            <div className="home-ageing-track">
                              <span style={{ width: Math.max(4, (value / max) * 100) + '%' }} />
                            </div>
                            <strong>{mvr(value)}</strong>
                          </button>
                        )
                      })}
                      <div className="home-ageing-total">
                        <span>Stock over 1 year</span>
                        <strong>{mvr(homeDashboard.ageing.metrics.over1)}</strong>
                        <small>Snapshot {homeDashboard.ageing.snapshot_date || '—'}</small>
                      </div>
                    </div>
                  ) : (
                    <EmptyState title="No ageing snapshot" text="Upload the latest inventory ageing file." />
                  )}
                </section>

                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">SUPPLIER EXPOSURE</span>
                      <h3>Top Pending Payment Suppliers</h3>
                    </div>
                    <button onClick={() => setView('payments')}>Payments →</button>
                  </div>

                  <div className="home-supplier-list">
                    {homeTopPaymentSuppliers.map(([supplier, value], index) => {
                      const max = Math.max(...homeTopPaymentSuppliers.map((item) => Number(item[1] || 0)), 1)
                      return (
                        <button key={supplier} onClick={() => setView('payments')}>
                          <span className="home-rank">{index + 1}</span>
                          <section>
                            <b>{supplier}</b>
                            <div className="home-supplier-track">
                              <span style={{ width: Math.max(4, (Number(value) / max) * 100) + '%' }} />
                            </div>
                          </section>
                          <strong>{mvr(value)}</strong>
                        </button>
                      )
                    })}
                  </div>
                </section>
              </div>

              <div className="home-dashboard-secondary">
                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">TOP QUANTITY</span>
                      <h3>Largest On-Hand Quantities</h3>
                    </div>
                    <button onClick={() => setView('stock')}>Inventory →</button>
                  </div>

                  <div className="home-quantity-list">
                    {homeDashboard.topQuantity.map((row, index) => {
                      const max = Math.max(...homeDashboard.topQuantity.map((item) => Number(item.on_hand || 0)), 1)
                      const width = Math.max(3, (Number(row.on_hand || 0) / max) * 100)
                      return (
                        <button key={row.item_code || index} onClick={() => setView('stock')}>
                          <div className="home-quantity-meta">
                            <span>{row.item_code || '—'}</span>
                            <small>{row.item_description || 'No description'}</small>
                            <strong>{fmt(row.on_hand, 2)}</strong>
                          </div>
                          <div className="home-quantity-track">
                            <span style={{ width: width + '%' }} />
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </section>

                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">HIGH-CONSUMPTION STOCK ALERT</span>
                      <h3>High-Use Items at 5 Units or Less</h3>
                    </div>
                    <button onClick={() => setView('stock')}>Review stock →</button>
                  </div>

                  <div className="home-low-stock-table">
                    <div className="home-low-stock-head">
                      <span>Item</span>
                      <span>On Hand</span>
                      <span>Status</span>
                    </div>
                    {homeDashboard.lowStock.map((row, index) => (
                      <button key={row.item_code || index} onClick={() => setView('stock')}>
                        <section>
                          <b>{row.item_code || '—'}</b>
                          <small>{row.item_description || 'No description'}</small>
                        </section>
                        <strong>{fmt(row.on_hand, 2)}</strong>
                        <em>{Number(row.on_hand || 0) <= 2 ? 'Critical' : 'Low'}</em>
                      </button>
                    ))}
                    {!homeDashboard.lowStock.length && <EmptyState title="No high-use low-stock items" text="None of the top 100 consumption-value items are at 5 units or less." />}
                  </div>
                </section>

                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">ACTIVITY MAP</span>
                      <h3>Source Update Activity</h3>
                    </div>
                    <button onClick={() => setView('history')}>History →</button>
                  </div>

                  <div className="home-activity-map">
                    {homeActivityDays.map((day) => (
                      <span
                        key={day.iso}
                        className={
                          'home-activity-cell ' +
                          (day.count >= 3 ? 'level-3' : day.count === 2 ? 'level-2' : day.count === 1 ? 'level-1' : 'level-0')
                        }
                        title={day.label + ': ' + day.count + ' update' + (day.count === 1 ? '' : 's')}
                      />
                    ))}
                  </div>
                  <div className="home-activity-legend">
                    <span>35 days ago</span>
                    <div>
                      <i className="level-0" />
                      <i className="level-1" />
                      <i className="level-2" />
                      <i className="level-3" />
                    </div>
                    <span>Today</span>
                  </div>
                </section>
              </div>

              <div className="home-dashboard-lower">
                <section className="home-analytics-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">QUICK ACCESS</span>
                      <h3>Operations Modules</h3>
                    </div>
                  </div>

                  <div className="home-quick-grid">
                    {[
                      ['prf', 'PRF Tracker', 'Request register and procurement movement.'],
                      ['prpo', 'PR & PO Tracker', 'Delivery, receipts, ageing and follow-up.'],
                      ['payments', 'Pending Payments', 'Current payment list and priority.'],
                      ['mtr', 'MTR Tracker', 'Requested and transferred quantities.'],
                      ['mrn', 'MRN & Issues', 'Issue status and pending material release.'],
                      ['stock', 'Stock & Ageing', 'Inventory value and ageing position.'],
                    ].map(([target, label, text]) => (
                      <button key={target} onClick={() => setView(target)}>
                        <span className="quick-icon">
                          <LineIcon name={target} className="h-4 w-4" />
                        </span>
                        <section>
                          <b>{label}</b>
                          <small>{text}</small>
                        </section>
                        <span>→</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="home-analytics-card home-attention-card">
                  <div className="home-card-head">
                    <div>
                      <span className="eyebrow">ATTENTION</span>
                      <h3>Current Follow-up</h3>
                    </div>
                  </div>

                  <button className="home-attention-row" onClick={() => setView('prpo')}>
                    <div>
                      <span>Pending PR / PO</span>
                      <small>Open procurement position</small>
                    </div>
                    <strong>{fmt(homeSummary.pending_count)}</strong>
                  </button>

                  <button className="home-attention-row" onClick={() => setView('stock')}>
                    <div>
                      <span>Aged Inventory Value</span>
                      <small>Review ageing exposure</small>
                    </div>
                    <strong>{mvr(homeSummary.aged_value)}</strong>
                  </button>

                  <button className="home-attention-row" onClick={() => setView('warehouse')}>
                    <div>
                      <span>Warehouse Reporting</span>
                      <small>Weekly operational presentation</small>
                    </div>
                    <strong>→</strong>
                  </button>
                </section>
              </div>
            </section>
          )}

          {view === 'overview' && (
            <>
              <PageHeader
                title="Overview"
                subtitle="Warehouse, procurement and materials control for a selected reporting period."
              />

              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <span className="eyebrow">SRD WAREHOUSE OVERVIEW</span>
                    <h3 className="mt-1 text-lg font-semibold tracking-tight text-slate-800">{overviewPeriodLabel}</h3>
                    <p className="mt-1 text-xs text-slate-500">Selected reporting period</p>
                  </div>

                  <div className="overview-date-loader">
                    <label>
                      <span>From</span>
                      <input
                        type="date"
                        value={overviewFromDraft}
                        max={overviewToDraft || undefined}
                        onChange={(e) => setOverviewFromDraft(e.target.value)}
                      />
                    </label>
                    <label>
                      <span>To</span>
                      <input
                        type="date"
                        value={overviewToDraft}
                        min={overviewFromDraft || undefined}
                        onChange={(e) => setOverviewToDraft(e.target.value)}
                      />
                    </label>
                    <button className="primary" onClick={applyOverviewDateRange}>
                      Load Data
                    </button>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ['PRs Submitted', fmt(overviewPeriod.submittedPrs), 'Procurement activity', 'prpo', 'blue'],
                    ['PRs Received', fmt(overviewPeriod.receivedPrs), 'Distinct PRs received selected period', 'prpo', 'emerald'],
                    ['Received Quantity', fmt(overviewPeriod.receivedQty, 2), 'Total quantity received', 'prpo', 'emerald'],
                    ['Received Value', mvr(overviewPeriod.receivedValue), 'Received value in selected period', 'prpo', 'teal'],
                    ['Pending Payment POs', fmt(overviewPeriod.pendingPaymentPos), 'Current pending-payment list', 'payments', 'amber'],
                    ['Pending Payment Value', mvr(overviewPeriod.pendingPaymentValue), 'Combined pending PO value', 'payments', 'amber'],
                    ['MTRs Created', fmt(overviewPeriod.mtrs), 'Created selected period', 'mtr', 'violet'],
                    ['MRNs Created', fmt(overviewPeriod.mrns), 'Created selected period', 'mrn', 'indigo'],
                    ['Pending / Not Issued MRNs', fmt(overviewPeriod.pendingMrns), 'Created selected period and still pending', 'mrn', 'rose'],
                    ['SR Issue Records', fmt(overviewPeriod.issueRecords), 'Issue records selected period', 'mrn', 'cyan'],
                    ['Stock Value', mvr(overviewPeriod.stockValue), 'Current SRD on-hand value', 'stock', 'slate'],
                    ['Stock Over 1 Year', mvr(overviewPeriod.agedValue), 'Current ageing exposure', 'stock', 'orange'],
                  ].map(([label, value, helper, target, accent]) => (
                    <button
                      key={label}
                      onClick={() => setView(target)}
                      className={
                        'group rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md ' +
                        (accent === 'emerald' ? 'hover:bg-emerald-50/30' :
                         accent === 'amber' ? 'hover:bg-amber-50/30' :
                         accent === 'rose' ? 'hover:bg-rose-50/30' :
                         accent === 'violet' ? 'hover:bg-violet-50/30' :
                         accent === 'indigo' ? 'hover:bg-indigo-50/30' :
                         accent === 'cyan' ? 'hover:bg-cyan-50/30' :
                         accent === 'orange' ? 'hover:bg-orange-50/30' :
                         accent === 'teal' ? 'hover:bg-teal-50/30' :
                         accent === 'blue' ? 'hover:bg-blue-50/30' :
                         'hover:bg-slate-50')
                      }
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
                        <span className="text-slate-300 transition group-hover:text-blue-500">↗</span>
                      </div>
                      <strong className="mt-3 block text-2xl font-semibold tracking-tight text-slate-900">{value}</strong>
                      <small className="mt-1 block text-[11px] leading-4 text-slate-500">{helper}</small>
                    </button>
                  ))}
                </div>
              </section>

              <div className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_.85fr]">
                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="eyebrow">MATERIAL MOVEMENT</span>
                      <h3 className="mt-1 text-base font-semibold text-slate-800">Received vs Issued — {overviewPeriodLabel}</h3>
                      <p className="mt-1 text-xs text-slate-500">Quantity movement for the selected reporting period.</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold text-slate-500">SELECTED PERIOD</span>
                  </div>

                  <div className="mt-7 space-y-6">
                    <div>
                      <div className="mb-2 flex items-end justify-between">
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Received Quantity</span>
                          <b className="mt-1 block text-xl font-semibold text-slate-900">{fmt(overviewPeriod.receivedQty, 2)}</b>
                        </div>
                        <small className="text-[11px] text-slate-500">{fmt(overviewPeriod.receivedPrs)} PRs received</small>
                      </div>
                      <div className="h-8 overflow-hidden rounded-lg bg-slate-100">
                        <div
                          className="h-full rounded-lg bg-emerald-500 transition-all"
                          style={{ width: Math.max(2, (overviewPeriod.receivedQty / overviewMovementMax) * 100) + '%' }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="mb-2 flex items-end justify-between">
                        <div>
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">Issued Quantity</span>
                          <b className="mt-1 block text-xl font-semibold text-slate-900">{fmt(overviewPeriod.issueQty, 2)}</b>
                        </div>
                        <small className="text-[11px] text-slate-500">{fmt(overviewPeriod.issueRecords)} issue records</small>
                      </div>
                      <div className="h-8 overflow-hidden rounded-lg bg-slate-100">
                        <div
                          className="h-full rounded-lg bg-amber-500 transition-all"
                          style={{ width: Math.max(2, (overviewPeriod.issueQty / overviewMovementMax) * 100) + '%' }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="mt-7 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Receipt Value</span>
                      <b className="mt-1 block text-sm text-slate-800">{mvr(overviewPeriod.receivedValue)}</b>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Current Inventory Value</span>
                      <b className="mt-1 block text-sm text-slate-800">{mvr(overviewPeriod.stockValue)}</b>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400">Aged Over 1 Year</span>
                      <b className="mt-1 block text-sm text-slate-800">{mvr(overviewPeriod.agedValue)}</b>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div>
                    <span className="eyebrow">CONTROL POSITION</span>
                    <h3 className="mt-1 text-base font-semibold text-slate-800">What needs attention</h3>
                    <p className="mt-1 text-xs text-slate-500">Current operational follow-up items.</p>
                  </div>

                  <div className="mt-5 space-y-3">
                    {[
                      ['Pending Payments', overviewPeriod.pendingPaymentPos, 'payments', 'MVR ' + money(overviewPeriod.pendingPaymentValue)],
                      ['Pending / Not Issued MRNs', overviewPeriod.pendingMrns, 'mrn', 'Created selected period'],
                      ['Stock Over 1 Year', null, 'stock', mvr(overviewPeriod.agedValue)],
                      ['SR Issue Records', overviewPeriod.issueRecords, 'mrn', 'Selected period'],
                    ].map(([label, count, target, detail]) => (
                      <button
                        key={label}
                        onClick={() => setView(target)}
                        className="flex w-full items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50/50"
                      >
                        <div>
                          <b className="block text-xs font-semibold text-slate-700">{label}</b>
                          <small className="mt-0.5 block text-[10px] text-slate-500">{detail}</small>
                        </div>
                        <strong className="text-lg font-semibold text-slate-900">{count === null ? '→' : fmt(count)}</strong>
                      </button>
                    ))}
                  </div>

                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Latest source updates</span>
                    <div className="mt-3 space-y-2">
                      {['PR', 'PO', 'MRN', 'AGEING'].map((source) => {
                        const x = lastSource.get(source)
                        return (
                          <div key={source} className="flex items-center justify-between gap-3 text-[11px]">
                            <b className="text-slate-600">{humanSource(source)}</b>
                            <span className="text-slate-400">{x ? new Date(x.imported_at).toLocaleDateString() : 'Not loaded'}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </section>
              </div>
            </>
          )}

          {view === 'prf' && (
            <>
              <PageHeader title="PRF Tracker" subtitle="PRF / IPF requests and their movement into PR, MTR and PO." />

              <section className="prf-weekly-summary !rounded-xl !border !border-slate-200 !bg-white !p-4 !shadow-sm">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">WEEKLY SUBMISSIONS</span>
                    <h3>Submitted PRFs by week</h3>
                  </div>
                  <span>Wednesday–Tuesday</span>
                </div>

                <div className="prf-week-grid !grid !gap-2 sm:!grid-cols-3 lg:!grid-cols-6">
                  <button
                    className={'prf-week-card !min-h-[64px] !rounded-lg !border !px-3 !py-2.5 ' + (prfWeekFilter === 'ALL' ? '!border-blue-200 !bg-blue-50 !text-blue-700' : '!border-slate-200 !bg-white hover:!border-slate-300 hover:!bg-slate-50')}
                    onClick={() => selectPrfWeek('ALL')}
                  >
                    <span className="!text-[10px] !font-semibold !uppercase !tracking-wider !text-blue-600">ALL PRFs</span>
                    <strong className="!text-xl !font-semibold !tracking-tight !text-blue-700">{fmt(allPrfRows.filter((r) => r.pr_date).length)}</strong>
                  </button>

                  {prfWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={'prf-week-card !min-h-[64px] !rounded-lg !border !px-3 !py-2.5 ' + (prfWeekFilter === week.weekStart ? '!border-blue-200 !bg-blue-50' : '!border-slate-200 !bg-white hover:!border-slate-300 hover:!bg-slate-50')}
                      onClick={() => selectPrfWeek(week.weekStart)}
                    >
                      <span className="!text-[10px] !font-semibold !uppercase !tracking-wider !text-slate-400">{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong className="!text-lg !font-semibold !tracking-tight !text-slate-800">{fmt(week.count)} {week.count === 1 ? 'PRF' : 'PRFs'}</strong>
                    </button>
                  ))}
                </div>

                {prfWeekFilter !== 'ALL' && (
                  <div className="prf-filter-note">
                    Showing PRFs submitted {formatShortDate(prfWeekFilter)} – {formatShortDate(addDaysIso(prfWeekFilter, 6))}
                    <button onClick={() => selectPrfWeek('ALL')}>Clear week</button>
                  </div>
                )}
              </section>

              <section className="prf-status-summary !rounded-xl !border !border-slate-200 !bg-white !p-4 !shadow-sm">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">STATUS SUMMARY</span>
                    <h3>
                      PRF quantity by status
                      {prfWeekFilter !== 'ALL'
                        ? ' — ' + formatShortDate(prfWeekFilter) + '–' + formatShortDate(addDaysIso(prfWeekFilter, 6))
                        : ''}
                    </h3>
                  </div>
                  <span>
                    {fmt(weekFilteredPrfRows.length)}
                    {prfWeekFilter === 'ALL' ? ' total PRFs' : ' PRFs in selected week'}
                  </span>
                </div>

                <div className="prf-status-grid !grid !gap-2 sm:!grid-cols-3 lg:!grid-cols-6">
                  <button
                    className={'prf-status-card !min-h-[64px] !rounded-lg !border !px-3 !py-2.5 ' + (prfStatusFilter === 'ALL' ? '!border-blue-200 !bg-blue-50' : '!border-slate-200 !bg-white hover:!border-slate-300 hover:!bg-slate-50')}
                    onClick={() => setPrfStatusFilter('ALL')}
                  >
                    <span className="!text-[10px] !font-semibold !uppercase !tracking-wider !text-blue-600">{prfWeekFilter === 'ALL' ? 'ALL PRFs' : 'ALL IN WEEK'}</span>
                    <strong className="!text-xl !font-semibold !tracking-tight !text-blue-700">{fmt(weekFilteredPrfRows.length)}</strong>
                  </button>

                  {prfStatusCounts.map(([status, count]) => (
                    <button
                      key={status}
                      className={'prf-status-card !min-h-[64px] !rounded-lg !border !px-3 !py-2.5 ' + (prfStatusFilter === status ? '!border-blue-200 !bg-blue-50' : '!border-slate-200 !bg-white hover:!border-slate-300 hover:!bg-slate-50')}
                      onClick={() => setPrfStatusFilter(status)}
                    >
                      <span className="!text-[10px] !font-semibold !uppercase !tracking-wider !text-slate-400">{status}</span>
                      <strong className="!text-lg !font-semibold !tracking-tight !text-slate-800">{fmt(count)}</strong>
                    </button>
                  ))}
                </div>

                {prfStatusFilter !== 'ALL' && (
                  <div className="prf-filter-note">
                    Showing <b>{prfStatusFilter}</b>
                    <button onClick={() => setPrfStatusFilter('ALL')}>Clear filter</button>
                  </div>
                )}
              </section>

              <DataTable
                className="prf-data-table !rounded-xl !border !border-slate-200 !bg-white !shadow-sm [&_thead]:!bg-slate-50 [&_th]:!bg-slate-50 [&_th]:!px-3 [&_th]:!py-3 [&_th]:!text-xs [&_th]:!font-semibold [&_th]:!uppercase [&_th]:!tracking-wide [&_th]:!text-slate-500 [&_tbody_tr]:!border-b [&_tbody_tr]:!border-slate-100 [&_td]:!px-3 [&_td]:!py-3 [&_td]:!text-slate-700 [&_.mini-button]:!rounded-md [&_.mini-button]:!border [&_.mini-button]:!border-slate-200 [&_.mini-button]:!bg-slate-50 [&_.mini-button]:!px-3 [&_.mini-button]:!py-1 [&_.mini-button]:!text-xs [&_.mini-button]:!font-medium [&_.mini-button]:!text-slate-600 [&_.mini-button]:!transition-colors hover:[&_.mini-button]:!border-blue-200 hover:[&_.mini-button]:!bg-blue-50 hover:[&_.mini-button]:!text-blue-600"
                rows={prfRows}
                noteType="procurement"
                noteMap={noteMap}
                onUpdate={canEdit ? openNote : undefined}
                columns={[
                  { key: 'prf_no', label: 'PRF / IPF', render: (v) => <span className="font-mono text-[11px] font-semibold text-slate-900">{v || '—'}</span> },
                  { key: 'linked_pr_mtr', label: 'PR / MTR', render: (v) => <span className="font-mono text-[11px] font-medium text-slate-700">{v || '—'}</span> },
                  { key: 'workshop', label: 'Workshop' },
                  { key: 'asset', label: 'Asset / Service', render: (v, r) => v || r.vessel || '—' },
                  { key: 'sr_wo', label: 'SR / WO' },
                  { key: 'work_order_type', label: 'Work Order Type' },
                  { key: 'purchase_from', label: 'Purchase From' },
                  { key: 'purchase_type', label: 'Purchase Type' },
                  { key: 'required_date', label: 'Required Date' },
                  { key: 'processed_date', label: 'Processed Date' },
                  { key: 'requested_by', label: 'Requested By' },
                  { key: 'status', label: 'Status', render: (v) => <PrfStatusBadge value={v} /> },
                  { key: 'latest_updates', label: 'Latest Updates', render: (v) => <span className="block max-w-[320px] whitespace-normal text-[11px] leading-5 text-slate-600">{v || '—'}</span> },
                  { key: 'cancel_reject_reason', label: 'Cancel / Reject Reason' },
                ]}
              />
            </>
          )}

          {view === 'prpo' && (
            <>
              <PageHeader
                title="PR & PO Tracker"
                subtitle="Live Simplix PR submissions combined with the current PR/PO procurement and receipt position."
              />

              <section className="prpo-section-card">
                <div className="prpo-section-title">
                  <div>
                    <span className="eyebrow">01 · PR SUBMISSION ACTIVITY</span>
                    <h3>When were PRs raised?</h3>
                    <p>This section uses the latest <b>Simplix PR sync</b>. Selecting a week filters the live PR header records below.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {erpPrHeaders.length > 0 && <span className="prpo-date-basis live">SIMPLIX SYNC · {fmt(erpPrHeaders.length)} PRs</span>}
                    <span className="prpo-date-basis">DATE BASIS · SUBMITTED DATE</span>
                  </div>
                </div>

                <div className="prf-week-grid">
                  <button
                    className={prPoWeekFilter === 'ALL' ? 'prf-week-card active' : 'prf-week-card'}
                    onClick={() => selectPrPoWeek('ALL')}
                  >
                    <span>ALL SUBMITTED PRs</span>
                    <strong>{fmt(erpPrHeaders.length || new Set(allPrLines.map((r) => r.pr_no).filter(Boolean)).size)} PRs</strong>
                  </button>

                  {prPoWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={prPoWeekFilter === week.weekStart ? 'prf-week-card active' : 'prf-week-card'}
                      onClick={() => selectPrPoWeek(week.weekStart)}
                    >
                      <span>{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong>{fmt(week.count)} {week.count === 1 ? 'PR raised' : 'PRs raised'}</strong>
                    </button>
                  ))}
                </div>

                <div className="prpo-filter-explainer">
                  <span className="prpo-filter-badge">SUBMITTED DATE FILTER</span>
                  <b>
                    {prPoWeekFilter === 'ALL'
                      ? 'All PR submission dates'
                      : 'PRs raised ' + formatShortDate(prPoWeekFilter) + ' – ' + formatShortDate(addDaysIso(prPoWeekFilter, 6))}
                  </b>
                  {prPoWeekFilter !== 'ALL' && <button onClick={() => selectPrPoWeek('ALL')}>Clear submission filter</button>}
                </div>

                <div className="pr-submission-detail-head">
                  <div>
                    <span className="eyebrow">PRs · SUBMITTED DATE</span>
                    <h4>
                      {prPoWeekFilter === 'ALL'
                        ? 'All submitted PRs'
                        : formatShortDate(prPoWeekFilter) + ' – ' + formatShortDate(addDaysIso(prPoWeekFilter, 6))}
                    </h4>
                  </div>
                  <div>
                    <strong>{fmt(prSubmissionCounts.prs)} PR{prSubmissionCounts.prs === 1 ? '' : 's'}</strong>
                    <span>{erpPrHeaders.length ? 'Live Simplix headers' : fmt(prSubmissionCounts.lines) + ' item line' + (prSubmissionCounts.lines === 1 ? '' : 's')}</span>
                  </div>
                </div>
                <DataTable rows={prSubmissionRows} columns={prSubmissionColumns} limit={250} />
              </section>

              <section className="prpo-section-card">
                <div className="prpo-section-title">
                  <div>
                    <span className="eyebrow">02 · CURRENT OPEN POSITION</span>
                    <h3>What needs attention now?</h3>
                    <p>These are <b>live status metrics</b>. They are not limited to the PR submission week selected above.</p>
                  </div>
                  <span className="prpo-date-basis live">LIVE POSITION</span>
                </div>

                <div className="metric-grid prpo-metrics prpo-operational-metrics">
                  <MetricCard
                    label="3–6 Month Aged PRs"
                    value={fmt(prPoAgeing.agedThreeToSix)}
                    helper="Open PRs currently aged 3–6 months"
                    tone="warn"
                    active={prPoAgeFilter === '3TO6'}
                    onClick={() => selectPrPoAge('3TO6')}
                  />
                  <MetricCard
                    label="6+ Month Aged PRs"
                    value={fmt(prPoAgeing.agedSixPlus)}
                    helper={prPoAgeing.agedSixPlus > 0 ? 'Oldest open: ' + fmt(prPoAgeing.oldestOpenDays) + ' days' : 'No PRs currently over 6 months'}
                    tone="bad"
                    active={prPoAgeFilter === '6PLUS'}
                    onClick={() => selectPrPoAge('6PLUS')}
                  />
                  <MetricCard
                    label="Urgent Items Pending"
                    value={fmt(prPoSummary.urgentPendingItems)}
                    helper="Urgent / critical / high-priority open item lines"
                    tone="bad"
                    active={prPoUrgentFilter}
                    onClick={togglePrPoUrgent}
                  />
                  <MetricCard
                    label="Pending PO"
                    value={fmt(prPoSummary.receiptNotDoneItems)}
                    helper="PO exists and Received Qty is still 0"
                    tone="warn"
                    active={prPoReceiptPendingFilter}
                    onClick={togglePrPoReceiptPending}
                  />
                  <MetricCard
                    label="Pending Payments"
                    value={fmt(pendingPaymentPoCount)}
                    helper="POs with payment pending / payment request sent"
                    tone="warn"
                    active={prPoPaymentPendingFilter}
                    onClick={togglePrPoPaymentPending}
                  />
                </div>

                {prPoPaymentPendingFilter && (
                  <div className="prpo-payment-pending-detail">
                    <div className="prpo-receipt-detail-head">
                      <div>
                        <span className="eyebrow">PENDING PAYMENTS · LIVE POSITION</span>
                        <h4>POs awaiting payment</h4>
                      </div>
                      <div>
                        <strong>{fmt(pendingPaymentPoCount)} POs</strong>
                        <span>{fmt(pendingPaymentRows.length)} item lines</span>
                        <button onClick={() => setPrPoPaymentPendingFilter(false)}>Close</button>
                      </div>
                    </div>
                    <DataTable
                      rows={pendingPaymentRows}
                      columns={[
                        { key: 'po_no', label: 'PO Number', render: (v) => displayValue(v, true) },
                        { key: 'pr_no', label: 'PR No.', render: (v) => displayValue(v, true) },
                        { key: 'supplier', label: 'Supplier' },
                        { key: 'item_code', label: 'Item' },
                        { key: 'item_description', label: 'Product Name' },
                        { key: 'payment_status', label: 'Payment Status', render: (v) => <StatusPill value={v || 'Pending'} /> },
                        { key: 'delivery_status', label: 'Delivery Status', render: (v) => <StatusPill value={v} /> },
                        { key: 'expected_delivery', label: 'ETA' },
                      ]}
                      limit={200}
                    />
                  </div>
                )}
              </section>

              <section className="prpo-section-card">
                <div className="prpo-section-title">
                  <div>
                    <span className="eyebrow">03 · RECEIPT ACTIVITY</span>
                    <h3>What was actually received?</h3>
                    <p>This section uses <b>Received Date</b>, independently from the PR submission filter above.</p>
                  </div>
                  <span className="prpo-date-basis receipt">DATE BASIS · RECEIVED DATE</span>
                </div>

                <div className="prpo-receipt-week-grid">
                  <button
                    className={prPoReceiptWeekFilter === 'ALL' ? 'prpo-receipt-week active' : 'prpo-receipt-week'}
                    onClick={() => selectPrPoReceiptWeek('ALL')}
                  >
                    <span>ALL RECEIPTS</span>
                    <strong>All dates</strong>
                  </button>
                  {prPoReceiptWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={prPoReceiptWeekFilter === week.weekStart ? 'prpo-receipt-week active' : 'prpo-receipt-week'}
                      onClick={() => selectPrPoReceiptWeek(week.weekStart)}
                    >
                      <span>{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong>{fmt(week.lines)} lines</strong>
                      <small>{fmt(week.prs)} PRs · {fmt(week.qty, 2)} qty</small>
                    </button>
                  ))}
                </div>

                <div className="metric-grid prpo-metrics prpo-receipt-metrics">
                  <MetricCard
                    label="PRs Fully Received"
                    value={fmt(prPoSummary.fullyReceivedPrs)}
                    helper="PRs with a receipt in this period and now fully received"
                  />
                  <MetricCard
                    label="PRs Partially Received"
                    value={fmt(prPoSummary.partReceivedPrs)}
                    helper="PRs with a receipt in this period but balance remains"
                    tone="warn"
                  />
                  <MetricCard
                    label="Received Item Lines"
                    value={fmt(prPoSummary.receivedItemLines)}
                    helper={fmt(prPoSummary.receivedPrs) + ' distinct PRs received'}
                  />
                  <MetricCard
                    label="Received Quantity"
                    value={fmt(prPoSummary.receivedItemQty, 2)}
                    helper="Quantity received by Received Date"
                  />
                  <MetricCard
                    label="Received Items Value"
                    value={money(prPoSummary.receivedItemValue)}
                    helper="Mapped value of items received in this period"
                  />
                </div>

                <div className="prpo-receipt-detail-head">
                  <div>
                    <span className="eyebrow">RECEIVED ITEMS · SELECTED PERIOD</span>
                    <h4>
                      {prPoReceiptWeekFilter === 'ALL'
                        ? 'All received items'
                        : formatShortDate(prPoReceiptWeekFilter) + ' – ' + formatShortDate(addDaysIso(prPoReceiptWeekFilter, 6))}
                    </h4>
                  </div>
                  <div>
                    <strong>{fmt(prPoReceiptRows.length)} item lines</strong>
                    <span>{fmt(new Set(prPoReceiptRows.map((r) => r.pr_no).filter(Boolean)).size)} PRs</span>
                  </div>
                </div>
                <DataTable rows={prPoReceiptRows} columns={receiptItemColumns} limit={150} />
              </section>

            </>
          )}

          {view === 'payments' && (
            <>
              <PageHeader
                title="Pending Payments"
                subtitle="Current pending payment list uploaded from Procurement."
              />

              <div className="metric-grid prpo-metrics prpo-operational-metrics">
                <MetricCard
                  label="Total POs"
                  value={fmt(pendingPaymentsSummary.total)}
                  helper="Click to show all POs"
                  tone="warn"
                  active={pendingPaymentDetailFilter === 'ALL'}
                  onClick={() => setPendingPaymentDetailFilter('ALL')}
                />
                <MetricCard
                  label="Total PO Value"
                  value={mvr(pendingPaymentsSummary.totalValue)}
                  helper="Click to show all POs"
                  active={pendingPaymentDetailFilter === 'ALL'}
                  onClick={() => setPendingPaymentDetailFilter('ALL')}
                />
                <MetricCard
                  label="Urgent"
                  value={fmt(pendingPaymentsSummary.urgent)}
                  helper="Click to show urgent POs"
                  tone="bad"
                  active={pendingPaymentDetailFilter === 'URGENT'}
                  onClick={() => setPendingPaymentDetailFilter('URGENT')}
                />
                {pendingPaymentsSummary.statusCounts.slice(0, 3).map(([status, count]) => (
                  <MetricCard
                    key={status}
                    label={status}
                    value={fmt(count)}
                    helper="Click to show details"
                    active={pendingPaymentDetailFilter === status}
                    onClick={() => setPendingPaymentDetailFilter(status)}
                  />
                ))}
              </div>

              <section className="prpo-section-card">
                <div className="prpo-section-title">
                  <div>
                    <span className="eyebrow">PROCUREMENT · PENDING PAYMENT LIST</span>
                    <h3>{pendingPaymentDetailTitle}</h3>
                    <p>{fmt(pendingPaymentDetailRows.length)} PO{pendingPaymentDetailRows.length === 1 ? '' : 's'} shown from the uploaded Pending Payment List.</p>
                  </div>
                  <span className="prpo-date-basis live">CURRENT LIST</span>
                </div>

                <DataTable
                  rows={pendingPaymentDetailRows}
                  columns={[
                    { key: 'po_no', label: 'PO Number', render: (v) => <span className="font-mono text-[11px] font-semibold text-slate-800">{v || '—'}</span> },
                    { key: 'po_date', label: 'PO Date' },
                    { key: 'supplier', label: 'Supplier' },
                    { key: 'status', label: 'Status', render: (v) => <StatusPill value={v} /> },
                    { key: 'priority', label: 'Priority', render: (v) => <StatusPill value={v} /> },
                    { key: 'po_value', label: 'PO Value', render: (v) => mvr(v) },
                  ]}
                  limit={300}
                />
              </section>
            </>
          )}

          {view === 'mtr' && (
            <>
              <PageHeader title="MTR Tracker" subtitle="Requested, transferred and remaining quantities by vessel / SR." />

              <section className="prf-weekly-summary mrn-weekly-strip mrn-hero-strip">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">WEEKLY MTR REQUESTS</span>
                    <h3>MTRs requested by week</h3>
                  </div>
                  <span>Wednesday–Tuesday</span>
                </div>
                <div className="prf-week-grid">
                  <button
                    className={mtrWeekFilter === 'ALL' ? 'prf-week-card active' : 'prf-week-card'}
                    onClick={() => selectMtrWeek('ALL')}
                  >
                    <span>ALL WEEKS</span>
                    <strong>{fmt(new Set(allMtrRows.map((r) => r.document_no).filter(Boolean)).size)} MTRs</strong>
                  </button>
                  {mtrWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={mtrWeekFilter === week.weekStart ? 'prf-week-card active' : 'prf-week-card'}
                      onClick={() => selectMtrWeek(week.weekStart)}
                    >
                      <span>{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong>{fmt(week.count)} {week.count === 1 ? 'MTR' : 'MTRs'}</strong>
                    </button>
                  ))}
                </div>
                {mtrWeekFilter !== 'ALL' && (
                  <div className="prf-filter-note">
                    Showing MTRs requested {formatShortDate(mtrWeekFilter)} – {formatShortDate(addDaysIso(mtrWeekFilter, 6))}
                    <button onClick={() => selectMtrWeek('ALL')}>Clear week</button>
                  </div>
                )}
              </section>

              <div className="metric-grid mtr-metrics mrn-primary-metrics mrn-summary-band">
                <MetricCard label="Total MTRs" value={fmt(mtrSummary.totalMtrs)} helper="Distinct MTR numbers" />
                <MetricCard
                  label="Fully Transferred MTRs"
                  value={fmt(mtrSummary.fullyTransferred)}
                  helper="All requested quantity transferred"
                  active={mtrControlFilter === 'FULL'}
                  onClick={() => selectMtrControl('FULL')}
                />
                <MetricCard
                  label="Partially Transferred MTRs"
                  value={fmt(mtrSummary.partiallyTransferred)}
                  helper="Transfer started; balance remains"
                  tone="warn"
                  active={mtrControlFilter === 'PARTIAL'}
                  onClick={() => selectMtrControl('PARTIAL')}
                />
                <MetricCard
                  label="Not Transferred / Pending"
                  value={fmt(mtrSummary.notTransferred)}
                  helper="No quantity transferred yet"
                  tone="bad"
                  active={mtrControlFilter === 'NOT_TRANSFERRED'}
                  onClick={() => selectMtrControl('NOT_TRANSFERRED')}
                />
                <MetricCard label="Total Requested Qty" value={fmt(mtrSummary.requestedQty, 2)} />
                <MetricCard label="Total Transferred Qty" value={fmt(mtrSummary.transferredQty, 2)} />
                <MetricCard label="Total Remaining Qty" value={fmt(mtrSummary.remainingQty, 2)} tone="warn" />
                <MetricCard
                  label="Pending with No SRD On-Hand"
                  value={fmt(mtrSummary.pendingNoStock)}
                  helper="Pending item lines where SRD on-hand is not available"
                  tone="warn"
                  active={mtrControlFilter === 'NO_STOCK'}
                  onClick={() => selectMtrControl('NO_STOCK')}
                />
                <MetricCard
                  label="Pending 30+ Days"
                  value={fmt(mtrSummary.aged30)}
                  helper="Pending item lines"
                  tone="bad"
                  active={mtrControlFilter === 'AGE30'}
                  onClick={() => selectMtrControl('AGE30')}
                />
              </div>

              <div className="mtr-breakdown-grid mrn-analysis-grid">
                <section className="prf-status-summary">
                  <div className="prf-status-head">
                    <div><span className="eyebrow">ERP STATUS</span><h3>Item lines by ERP status</h3></div>
                    <span>{fmt(weekFilteredMtrRows.length)} lines</span>
                  </div>
                  <div className="prf-status-grid">
                    {mtrStatusCounts.slice(0, 12).map(([status, count]) => (
                      <button
                        key={status}
                        className={mtrStatusFilter === status ? 'prf-status-card active' : 'prf-status-card'}
                        onClick={() => selectMtrStatus(status)}
                      >
                        <span>{mrnStatusDisplay(status)}</span>
                        <strong>{fmt(count)}</strong>
                        <span className={mrnStatusFilter === mrnStatusDisplay(status) ? 'mrn-card-chevron open' : 'mrn-card-chevron'} aria-hidden="true">⌄</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="prf-status-summary">
                  <div className="prf-status-head">
                    <div><span className="eyebrow">DELIVERY STATUS ERP</span><h3>Item lines by delivery status</h3></div>
                    <span>{fmt(weekFilteredMtrRows.length)} lines</span>
                  </div>
                  <div className="prf-status-grid">
                    {mtrDeliveryCounts.slice(0, 12).map(([status, count]) => (
                      <button
                        key={status}
                        className={mtrDeliveryFilter === status ? 'prf-status-card active' : 'prf-status-card'}
                        onClick={() => selectMtrDelivery(status)}
                      >
                        <span>{status}</span>
                        <strong>{fmt(count)}</strong>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              {(mtrControlFilter !== 'ALL' || mtrStatusFilter !== 'ALL' || mtrDeliveryFilter !== 'ALL') && (
                <div className="prf-filter-note prpo-age-note">
                  Showing filtered MTR item lines
                  <button onClick={() => {
                    setMtrControlFilter('ALL')
                    setMtrStatusFilter('ALL')
                    setMtrDeliveryFilter('ALL')
                  }}>Clear MTR filter</button>
                </div>
              )}

              <div className="prpo-visible-count">
                <strong>{fmt(mtrVisibleCounts.mtrs)} MTR{mtrVisibleCounts.mtrs === 1 ? '' : 's'}</strong>
                <span>{fmt(mtrVisibleCounts.lines)} item line{mtrVisibleCounts.lines === 1 ? '' : 's'} shown</span>
              </div>

              <DataTable rows={mtrRows} columns={mtrColumns} noteType="material" noteMap={noteMap} onUpdate={canEdit ? openNote : undefined} />
            </>
          )}

          {view === 'mrn' && (
            <>
              <PageHeader title="MRN & Issues" subtitle="Material request progress from creation through ERP issue / journal posting." />

              <section className="prf-weekly-summary mrn-weekly-strip mrn-hero-strip">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">WEEKLY MRNs CREATED</span>
                    <h3>MRNs created by week</h3>
                  </div>
                  <span>Wednesday–Tuesday</span>
                </div>
                <div className="prf-week-grid">
                  <button
                    className={mrnWeekFilter === 'ALL' ? 'prf-week-card active' : 'prf-week-card'}
                    onClick={() => selectMrnWeek('ALL')}
                  >
                    <span>ALL WEEKS</span>
                    <strong>{fmt(allMrnRows.length)} MRN records</strong>
                  </button>
                  {mrnWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={mrnWeekFilter === week.weekStart ? 'prf-week-card active' : 'prf-week-card'}
                      onClick={() => selectMrnWeek(week.weekStart)}
                    >
                      <span>{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong>{fmt(week.count)} {week.count === 1 ? 'record' : 'records'}</strong>
                    </button>
                  ))}
                </div>
                <div className="mrn-period-context">
                  <div>
                    <span>SELECTED MRN PERIOD</span>
                    <b>
                      {mrnWeekFilter === 'ALL'
                        ? 'All MRN creation dates'
                        : formatShortDate(mrnWeekFilter) + ' – ' + formatShortDate(addDaysIso(mrnWeekFilter, 6))}
                    </b>
                  </div>
                  <small>
                    {mrnWeekFilter === 'ALL'
                      ? 'Summary and breakdowns below use all MRN records.'
                      : 'Summary and breakdowns below only use MRNs created in this selected week.'}
                  </small>
                  {mrnWeekFilter !== 'ALL' && <button onClick={() => selectMrnWeek('ALL')}>Clear week</button>}
                </div>
              </section>

              <div className="metric-grid mtr-metrics mrn-primary-metrics mrn-summary-band">
                <div className="mrn-summary-card total">
                  <MetricCard label="Total MRN Records" value={fmt(mrnSummary.total)} helper="One unique source ID per record" />
                </div>
                <div className="mrn-summary-card issued">
                  <MetricCard
                    label="Issued MRNs"
                    value={fmt(mrnSummary.issued)}
                    helper="Issued / completed in ERP"
                    active={mrnControlFilter === 'ISSUED'}
                    onClick={() => selectMrnControl('ISSUED')}
                  />
                </div>
                <div className="mrn-summary-card pending">
                  <MetricCard
                    label="Pending / Not Issued"
                    value={fmt(mrnSummary.pending)}
                    helper="No lines issued yet"
                    tone="bad"
                    active={mrnControlFilter === 'PENDING'}
                    onClick={() => selectMrnControl('PENDING')}
                  />
                </div>
              </div>

              <div className="mtr-breakdown-grid mrn-analysis-grid">
                <section className="prf-status-summary mrn-analysis-panel mrn-status-panel">
                  <div className="prf-status-head">
                    <div><span className="eyebrow">ISSUED STATUS · SELECTED PERIOD</span><h3>MRN records by issued status</h3></div>
                    <span>{fmt(mrnSummary.total)} records</span>
                  </div>
                  <div className="prf-status-grid">
                    {mrnStatusCounts.slice(0, 12).map(([status, count]) => (
                      <button
                        key={status}
                        className={mrnStatusFilter === mrnStatusDisplay(status) ? 'prf-status-card active' : 'prf-status-card'}
                        onClick={() => selectMrnStatus(mrnStatusDisplay(status))}
                      >
                        <span>{status}</span>
                        <strong>{fmt(count)}</strong>
                        <span className={mrnStatusFilter === status ? 'mrn-card-chevron open' : 'mrn-card-chevron'} aria-hidden="true">⌄</span>
                      </button>
                    ))}
                  </div>
                  {mrnStatusFilter !== 'ALL' && (
                    <div className="mrn-breakdown-expand">
                      <div className="mrn-breakdown-expand-head">
                        <div>
                          <span className="eyebrow">ISSUED STATUS DETAILS</span>
                          <h4>{mrnStatusFilter}</h4>
                        </div>
                        <div>
                          <strong>{fmt(weekFilteredMrnRows.filter((row) => mrnStatusLabel(row) === mrnStatusFilter).length)} records</strong>
                          <button onClick={() => selectMrnStatus(mrnStatusFilter)}>Collapse</button>
                        </div>
                      </div>
                      <DataTable
                        rows={weekFilteredMrnRows.filter((row) => mrnStatusLabel(row) === mrnStatusFilter)}
                        columns={mrnQuickColumns}
                        limit={150}
                      />
                    </div>
                  )}
                </section>

                <section className="prf-status-summary mrn-analysis-panel mrn-workshop-panel">
                  <div className="prf-status-head">
                    <div><span className="eyebrow">WORKSHOP · SELECTED PERIOD</span><h3>MRNs by workshop</h3></div>
                    <span>Top workshops</span>
                  </div>
                  <div className="prf-status-grid">
                    {mrnWorkshopCounts.slice(0, 12).map(([workshop, count]) => (
                      <button
                        key={workshop}
                        className={mrnWorkshopFilter === workshop ? 'prf-status-card active' : 'prf-status-card'}
                        onClick={() => selectMrnWorkshop(workshop)}
                      >
                        <span>{workshop}</span>
                        <strong>{fmt(count)}</strong>
                        <span className={mrnWorkshopFilter === workshop ? 'mrn-card-chevron open' : 'mrn-card-chevron'} aria-hidden="true">⌄</span>
                      </button>
                    ))}
                  </div>
                  {mrnWorkshopFilter !== 'ALL' && (
                    <div className="mrn-breakdown-expand">
                      <div className="mrn-breakdown-expand-head">
                        <div>
                          <span className="eyebrow">WORKSHOP DETAILS</span>
                          <h4>{mrnWorkshopFilter}</h4>
                        </div>
                        <div>
                          <strong>{fmt(weekFilteredMrnRows.filter((row) => (String(rawField(row, ['WORKSHOP NAME']) || row.workshop || '').trim() || 'BLANK') === mrnWorkshopFilter).length)} records</strong>
                          <button onClick={() => selectMrnWorkshop(mrnWorkshopFilter)}>Collapse</button>
                        </div>
                      </div>
                      <DataTable
                        rows={weekFilteredMrnRows.filter((row) => (String(rawField(row, ['WORKSHOP NAME']) || row.workshop || '').trim() || 'BLANK') === mrnWorkshopFilter)}
                        columns={mrnQuickColumns}
                        limit={150}
                      />
                    </div>
                  )}
                </section>
              </div>

              <section className="prf-status-summary mrn-wp-panel">
                <div className="prf-status-head">
                  <div><span className="eyebrow">WP TYPE · SELECTED PERIOD</span><h3>MRNs by WP type</h3></div>
                  <span>Click to filter</span>
                </div>
                <div className="prf-status-grid">
                  {mrnWpTypeCounts.slice(0, 12).map(([wpType, count]) => (
                    <button
                      key={wpType}
                      className={mrnWpTypeFilter === wpType ? 'prf-status-card active' : 'prf-status-card'}
                      onClick={() => selectMrnWpType(wpType)}
                    >
                      <span>{wpType}</span>
                      <strong>{fmt(count)}</strong>
                    </button>
                  ))}
                </div>
              </section>

              <div className="mrn-section-divider">
                <span>ERP ISSUE ACTIVITY</span>
                <b>Independent from the MRN creation-week filter above</b>
              </div>
              <section className="prf-status-summary sr-issues-section sr-issues-feature">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">ACTUAL SR ISSUE ACTIVITY</span>
                    <h3>Actual SR Issue Activity</h3><p>Sales-order issue lines, invoice status and weekly movement</p>
                  </div>
                  <span>{data.srIssues.length ? fmt(srIssueSummary.total) + (srIssueWeekFilter === 'ALL' ? ' issue lines · all weeks' : ' issue lines · selected week') : 'No SR issue file loaded'}</span>
                </div>

                {!data.srIssues.length ? (
                  <EmptyState
                    title="No SR issue export loaded"
                    text="Upload the latest SR Issues / Issued Items export in Update Centre to verify actual issue activity against MRNs."
                  />
                ) : (
                  <>
                    <div className="metric-grid sr-issue-metrics">
                      <MetricCard label="Issue Lines" value={fmt(srIssueSummary.total)} helper={fmt(srIssueSummary.salesOrders) + ' sales orders · ' + fmt(srIssueSummary.srs) + ' SRs'} active={srIssueFilter === 'ALL'} onClick={() => setSrIssueFilter('ALL')} />
                      <div className="sr-kpi-accent sr-kpi-completed"><MetricCard label="Invoiced" value={fmt(srIssueSummary.invoiced)} helper="Completed ERP issue lines" active={srIssueFilter === 'INVOICED'} onClick={() => setSrIssueFilter(srIssueFilter === 'INVOICED' ? 'ALL' : 'INVOICED')} /></div>
                      <div className="sr-kpi-accent sr-kpi-pending"><MetricCard label="Open Order" value={fmt(srIssueSummary.openOrder)} helper="Open Order + Delivered lines pending invoice" tone="warn" active={srIssueFilter === 'PENDING'} onClick={() => setSrIssueFilter(srIssueFilter === 'PENDING' ? 'ALL' : 'PENDING')} /></div>
                      <MetricCard label="Issue Value" value={mvr(srIssueSummary.issueValue)} helper="SR line value with transaction cost fallback" />
                      <MetricCard label="Pending Value" value={mvr(srIssueSummary.pendingValue)} helper="Value of Open Order lines" tone="warn" active={srIssueFilter === 'PENDING'} onClick={() => setSrIssueFilter(srIssueFilter === 'PENDING' ? 'ALL' : 'PENDING')} />
                      <div className="metric-card sr-week-card !min-h-[108px] !rounded-xl !border !border-slate-200 !bg-white !p-4 !shadow-sm">
                        <div className="sr-week-card-head">
                          <span>Selected Period</span>
                          <select value={srIssueWeekFilter} onChange={(e) => setSrIssueWeekFilter(e.target.value)}>
                            <option value="ALL">All weeks</option>
                            {srIssueWeekOptions.map((week, index) => (
                              <option key={week.weekStart} value={week.weekStart}>
                                {index === 0 ? 'This week · ' : index === 1 ? 'Previous week · ' : ''}
                                {formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <strong>{fmt(srIssueSummary.selectedWeek)}</strong>
                        <small>{srIssueWeekFilter === 'ALL' ? 'Issue lines across all available weeks' : 'Issue lines in selected Wednesday–Tuesday week'}</small>
                      </div>
                    </div>

                    <div className="sr-issue-context-bar">
                      <div><span>Selected period</span><b>{srIssueWeekFilter === 'ALL' ? 'All weeks' : formatShortDate(srIssueWeekFilter) + ' – ' + formatShortDate(addDaysIso(srIssueWeekFilter, 6))}</b></div>
                      <div><span>Issue lines</span><b>{fmt(srIssueRows.length)}</b></div>
                      <div><span>SRs</span><b>{fmt(new Set(srIssueRows.map((r) => normalizedSr(r.sr_no)).filter(Boolean)).size)}</b></div>
                      <div><span>Sales orders</span><b>{fmt(new Set(srIssueRows.map((r) => r.sales_order).filter(Boolean)).size)}</b></div>
                      {srIssueFilter !== 'ALL' && <button onClick={() => setSrIssueFilter('ALL')}>Clear issue filter</button>}
                    </div>

                    <div className="sr-selected-week-heading">
                      <div>
                        <span className="eyebrow">{srIssueWeekFilter === 'ALL' ? 'ITEMS FROM ALL WEEKS' : 'ITEMS FROM SELECTED WEEK'}</span>
                        <h4>{srIssueWeekFilter === 'ALL' ? 'All available SR issue records' : formatShortDate(srIssueWeekFilter) + ' – ' + formatShortDate(addDaysIso(srIssueWeekFilter, 6))}</h4>
                      </div>
                      <strong>{fmt(srIssueRows.length)} issue lines</strong>
                    </div>
                    <DataTable rows={srIssueRows} columns={srIssueColumns} limit={250} />
                  </>
                )}
              </section>

              <div className="mrn-active-filter-bar">
                <div>
                  <span>DETAIL RECORDS</span>
                  <b>{fmt(mrnVisibleCounts.records)} MRN records</b>
                </div>
                <div className="mrn-active-filter-chips">
                  <span>Period: {mrnWeekFilter === 'ALL' ? 'All dates' : formatShortDate(mrnWeekFilter) + ' – ' + formatShortDate(addDaysIso(mrnWeekFilter, 6))}</span>
                  {mrnStatusFilter !== 'ALL' && <span>Status: {mrnStatusFilter}</span>}
                  {mrnWorkshopFilter !== 'ALL' && <span>Workshop: {mrnWorkshopFilter}</span>}
                  {mrnWpTypeFilter !== 'ALL' && <span>WP Type: {mrnWpTypeFilter}</span>}
                  {mrnControlFilter !== 'ALL' && <span>Control: {mrnControlFilter}</span>}
                </div>
                {(mrnControlFilter !== 'ALL' || mrnStatusFilter !== 'ALL' || mrnWorkshopFilter !== 'ALL' || mrnWpTypeFilter !== 'ALL' || mrnWeekFilter !== 'ALL') && (
                  <button onClick={() => {
                    setMrnWeekFilter('ALL')
                    setMrnControlFilter('ALL')
                    setMrnStatusFilter('ALL')
                    setMrnWorkshopFilter('ALL')
                    setMrnWpTypeFilter('ALL')
                  }}>Clear filters</button>
                )}
              </div>

              <div className="prpo-visible-count">
                <strong>{fmt(mrnVisibleCounts.records)} MRN record{mrnVisibleCounts.records === 1 ? '' : 's'}</strong>
                <span>{fmt(mrnVisibleCounts.mrnNumbers)} distinct MRN number{mrnVisibleCounts.mrnNumbers === 1 ? '' : 's'} shown</span>
              </div>

              <DataTable rows={mrnRows} columns={mrnColumns} noteType="material" noteMap={noteMap} onUpdate={canEdit ? openNote : undefined} />
            </>
          )}

          {view === 'vessel' && (
            <>
              <PageHeader title="Vessel / SR View" subtitle="See the complete procurement, transfer and issue trail for one vessel or service request." />
              <div className="vessel-search">
                <input value={vesselSearch} onChange={(e) => setVesselSearch(e.target.value)} placeholder="Type vessel, asset, SR, WO or reference…" />
              </div>
              {!vesselTerm ? (
                <EmptyState title="Search for a vessel or SR" text="This view joins PRF/PR/PO, MTR/MRN and ERP movement." />
              ) : (
                <div className="joined-grid">
                  <section className="panel wide">
                    <div className="panel-head"><h3>Procurement</h3><span>{vesselProc.length} records</span></div>
                    <DataTable rows={vesselProc} columns={procurementColumns.slice(0, 10)} noteType="procurement" noteMap={noteMap} onUpdate={canEdit ? openNote : undefined} limit={100} />
                  </section>
                  <section className="panel wide">
                    <div className="panel-head"><h3>MTR / MRN</h3><span>{vesselMat.length} records</span></div>
                    <DataTable rows={vesselMat} columns={materialColumns} noteType="material" noteMap={noteMap} onUpdate={canEdit ? openNote : undefined} limit={100} />
                  </section>
                  <section className="panel wide">
                    <div className="panel-head"><h3>ERP Issues / Receipts</h3><span>{vesselTx.length} records</span></div>
                    <DataTable rows={vesselTx} limit={100} columns={[
                      { key: 'physical_date', label: 'Date' },
                      { key: 'transaction_type', label: 'Type', render: (v) => <StatusPill value={v} /> },
                      { key: 'item_code', label: 'Item' },
                      { key: 'item_description', label: 'Description' },
                      { key: 'quantity', label: 'Qty' },
                      { key: 'sales_order', label: 'SO' },
                      { key: 'journal_no', label: 'Journal' },
                      { key: 'delivery_name', label: 'Delivery name' },
                      { key: 'sr_wo', label: 'SR / WO' },
                    ]} />
                  </section>
                </div>
              )}
            </>
          )}

          {view === 'stock' && (
            <>
              <PageHeader
                title="Stock & Ageing"
                subtitle="Inventory ageing report with on-hand valuation and age-bucket values."
              />

              <div className="metric-grid stock-ageing-metrics">
                <MetricCard label="Items" value={fmt(data.stock.length)} helper="Unique item IDs loaded" />
                <MetricCard label="On-hand quantity" value={fmt(ageingSummary.onHandQty, 2)} helper="Physical on-hand quantity" />
                <MetricCard label="On-hand value" value={mvr(ageingSummary.onHandValue)} helper="Value of current on-hand stock" />
                <MetricCard label="Top 100 High Value Items" value={fmt(top100HighValue.length) + ' Items'} helper={'Combined on-hand value: ' + mvr(top100HighValueTotal)} tone="warn" active={stockAgeFilter === 'HIGH100'} onClick={() => setStockAgeFilter(stockAgeFilter === 'HIGH100' ? 'ALL' : 'HIGH100')} />
                <MetricCard label="P2 — 1 to 3 Years" value={mvr(ageingSummary.p2)} helper="Stock aged 366–1095 days" active={stockAgeFilter === 'P2'} onClick={() => setStockAgeFilter(stockAgeFilter === 'P2' ? 'ALL' : 'P2')} />
                <MetricCard label="P3 — 3 to 4 Years" value={mvr(ageingSummary.p3)} helper="Stock aged 1096–1460 days" active={stockAgeFilter === 'P3'} onClick={() => setStockAgeFilter(stockAgeFilter === 'P3' ? 'ALL' : 'P3')} />
                <MetricCard label="P4 — 4 to 5 Years" value={mvr(ageingSummary.p4)} helper="Stock aged 1461–1825 days" active={stockAgeFilter === 'P4'} onClick={() => setStockAgeFilter(stockAgeFilter === 'P4' ? 'ALL' : 'P4')} />
                <MetricCard label="P5 — Over 5 Years" value={mvr(ageingSummary.p5)} helper="Stock aged more than 1825 days" tone="bad" active={stockAgeFilter === 'P5'} onClick={() => setStockAgeFilter(stockAgeFilter === 'P5' ? 'ALL' : 'P5')} />
                <MetricCard label="Stock Value Over 1 Year" value={mvr(ageingSummary.agedOver365)} helper="Combined value of stock aged more than 365 days" tone="warn" active={stockAgeFilter === 'AGED365'} onClick={() => setStockAgeFilter(stockAgeFilter === 'AGED365' ? 'ALL' : 'AGED365')} />
              </div>

              {ageingComparison.current && (
                <>
                  <div className="ageing-headline-comparison">
                    <section className="ageing-headline-card">
                      <div className="ageing-headline-title">
                        <span className="eyebrow">TOTAL ON-HAND VALUE</span>
                        <strong>{ageingComparison.onHandChange === null ? '—' : ((ageingComparison.onHandChange >= 0 ? '+' : '−') + mvr(Math.abs(ageingComparison.onHandChange)))}</strong>
                        <small>{ageingComparison.onHandPercent === null ? 'No previous week yet' : ((ageingComparison.onHandPercent >= 0 ? '+' : '') + ageingComparison.onHandPercent.toFixed(2) + '% vs previous period')}</small>
                      </div>
                      <div className="ageing-headline-values">
                        <div><span>LAST WEEK</span><b>{ageingComparison.previous ? mvr(ageingComparison.previousOnHand) : '—'}</b><small>{ageingComparison.previous?.snapshot_date || '—'}</small></div>
                        <i>→</i>
                        <div><span>THIS WEEK</span><b>{mvr(ageingComparison.currentOnHand)}</b><small>{ageingComparison.current.snapshot_date}</small></div>
                      </div>
                    </section>

                    <section className="ageing-headline-card">
                      <div className="ageing-headline-title">
                        <span className="eyebrow">STOCK VALUE OVER 1 YEAR</span>
                        <strong>{ageingComparison.change === null ? '—' : ((ageingComparison.change >= 0 ? '+' : '−') + mvr(Math.abs(ageingComparison.change)))}</strong>
                        <small>{ageingComparison.percent === null ? 'No previous week yet' : ((ageingComparison.percent >= 0 ? '+' : '') + ageingComparison.percent.toFixed(2) + '% vs previous period')}</small>
                      </div>
                      <div className="ageing-headline-values">
                        <div><span>LAST WEEK</span><b>{ageingComparison.previous ? mvr(ageingComparison.previousValue) : '—'}</b><small>{ageingComparison.previous?.snapshot_date || '—'}</small></div>
                        <i>→</i>
                        <div><span>THIS WEEK</span><b>{mvr(ageingComparison.currentValue)}</b><small>{ageingComparison.current.snapshot_date}</small></div>
                      </div>
                    </section>
                  </div>
                  <AgeingTrend snapshots={ageingSnapshots} />
                </>
              )}

              {stockAgeFilter !== 'ALL' && (
                <div className="prf-filter-note prpo-age-note">
                  Showing items in <b>{stockAgeFilter === 'AGED365' ? 'all ageing buckets over 1 year' : stockAgeFilter === 'HIGH100' ? 'Top 100 High Value Items' : stockAgeFilter}</b>
                  <button onClick={() => setStockAgeFilter('ALL')}>Clear ageing filter</button>
                </div>
              )}

              <DataTable
                rows={stockRows}
                noteType="stock"
                noteMap={noteMap}
                onUpdate={canEdit ? openNote : undefined}
                columns={[
                  { key: 'raw_item_group', label: 'Item Group', render: (_v, r) => rawField(r, ['Item group']) || '—' },
                  { key: 'item_code', label: 'Item Number' },
                  { key: 'item_description', label: 'Product Name' },
                  { key: 'unit', label: 'Inventory Unit' },
                  { key: 'on_hand', label: 'On-hand Qty', render: (_v, r) => fmt(rawNumber(r, ['On-hand quantity']) || Number(r.on_hand || 0), 2) },
                  { key: 'raw_on_hand_value', label: 'On-hand Value', render: (_v, r) => mvr(rawNumber(r, ['On-hand value'])) },
                  { key: 'raw_inventory_value_qty', label: 'Inventory Value Qty', render: (_v, r) => fmt(rawNumber(r, ['Inventory value quantity']), 2) },
                  { key: 'raw_inventory_value', label: 'Inventory Value', render: (_v, r) => mvr(rawNumber(r, ['Inventory value'])) },
                  { key: 'unit_cost', label: 'Average Unit Cost', render: (_v, r) => mvr(rawNumber(r, ['Average unit cost']) || Number(r.unit_cost || 0)) },
                  { key: 'raw_p1_qty', label: 'P1 Qty (0–365)', render: (_v, r) => fmt(rawNumber(r, ['P1:Quantity']), 2) },
                  { key: 'raw_p1_amt', label: 'P1 Amount', render: (_v, r) => mvr(rawNumber(r, ['P1:Amount'])) },
                  { key: 'raw_p2_qty', label: 'P2 Qty (366–1095)', render: (_v, r) => fmt(rawNumber(r, ['P2:Quantity']), 2) },
                  { key: 'raw_p2_amt', label: 'P2 Amount', render: (_v, r) => mvr(rawNumber(r, ['P2:Amount'])) },
                  { key: 'raw_p3_qty', label: 'P3 Qty (1096–1460)', render: (_v, r) => fmt(rawNumber(r, ['P3:Quantity']), 2) },
                  { key: 'raw_p3_amt', label: 'P3 Amount', render: (_v, r) => mvr(rawNumber(r, ['P3:Amount'])) },
                  { key: 'raw_p4_qty', label: 'P4 Qty (1461–1825)', render: (_v, r) => fmt(rawNumber(r, ['P4:Quantity']), 2) },
                  { key: 'raw_p4_amt', label: 'P4 Amount', render: (_v, r) => mvr(rawNumber(r, ['P4:Amount'])) },
                  { key: 'raw_p5_qty', label: 'P5 Qty (1825+)', render: (_v, r) => fmt(rawNumber(r, ['P5:Quantity']), 2) },
                  { key: 'raw_p5_amt', label: 'P5 Amount', render: (_v, r) => mvr(rawNumber(r, ['P5:Amount'])) },
                ]}
              />
            </>
          )}


          {view === 'updates' && canEdit && (
            <>
              <PageHeader title="Update Centre" subtitle="Load fresh ERP/Form exports and keep meeting remarks, actions and history intact." />
              <ImportPanel onApplied={async () => {
                setLoaded({
                  procurement: false,
                  material: false,
                  stock: false,
                  transactions: false,
                  srIssues: false,
                  lld: false,
                  notes: false,
                  sourceUpdates: false,
                  snapshots: false,
                  pendingPayments: false,
                })
                await loadHomeSummary()
                await loadForView('updates', true)
              }} email={session.user.email} />
            </>
          )}

          {view === 'warehouse' && (
            <>
              <PageHeader
                title="Warehouse Presentation"
                subtitle="Last week reporting period focused on receipt activity, MRN issue control and SR issue activity."
                actions={
                  <>
                    <button className="secondary" onClick={toggleWarehouseFullscreen}>
                      {warehouseFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                    </button>
                    <button className="secondary" onClick={() => window.print()}>Print / PDF</button>
                  </>
                }
              />
              <section id="warehouse-presentation-shell" className="meeting-shell warehouse-presentation-shell">
                <div className="meeting-workspace">
                  <aside className="meeting-agenda">
                    <div className="meeting-agenda-head">
                      <span>WAREHOUSE REVIEW</span>
                      <strong>Presentation</strong>
                    </div>
                    <div className="meeting-agenda-list">
                      {warehouseSlides.map((item, i) => (
                        <button
                          key={item.title}
                          className={i === slide ? 'meeting-agenda-item active' : 'meeting-agenda-item'}
                          onClick={() => setSlide(i)}
                        >
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <div>
                            <small>{item.kicker}</small>
                            <b>{item.title}</b>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="meeting-agenda-foot">
                      <span>SRD Warehouse System</span>
                      <small>Warehouse operational presentation</small>
                    </div>
                  </aside>

                  <div className="meeting-stage">
                    <div className="meeting-slide-topline">
                      <span>Slide {Math.min(slide + 1, warehouseSlides.length)} of {warehouseSlides.length}</span>
                      <div><i style={{ width: ((Math.min(slide, warehouseSlides.length - 1) + 1) / warehouseSlides.length * 100) + '%' }} /></div>
                    </div>

                    <div className="meeting-slide">
                      <div className="meeting-slide-header">
                        <div>
                          <span className="meeting-kicker">{warehouseSlides[Math.min(slide, warehouseSlides.length - 1)].kicker}</span>
                          <h2>{warehouseSlides[Math.min(slide, warehouseSlides.length - 1)].title}</h2>
                        </div>
                        <div className="meeting-slide-mark">SRD</div>
                      </div>
                      <div className="meeting-body">{warehouseSlides[Math.min(slide, warehouseSlides.length - 1)].body}</div>
                      <footer>
                        <span>Shipbuilding & Repair Division · Materials Management</span>
                        <span>{formatShortDate(warehouseWeekStart)} – {formatShortDate(warehouseWeekEnd)}</span>
                      </footer>
                    </div>

                    <div className="meeting-controls">
                      <button className="secondary" onClick={() => setSlide(Math.max(0, Math.min(slide, warehouseSlides.length - 1) - 1))} disabled={Math.min(slide, warehouseSlides.length - 1) === 0}>Previous</button>
                      <span>{Math.min(slide, warehouseSlides.length - 1) + 1} / {warehouseSlides.length}</span>
                      <button className="primary" onClick={() => setSlide(Math.min(warehouseSlides.length - 1, Math.min(slide, warehouseSlides.length - 1) + 1))} disabled={Math.min(slide, warehouseSlides.length - 1) === warehouseSlides.length - 1}>Next</button>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {view === 'inventoryPresentation' && (
            <>
              <PageHeader
                title="Inventory Presentation"
                subtitle="Inventory value, ageing, high-value exposure and consumption-driven stock risk."
                actions={
                  <>
                    <button className="secondary" onClick={toggleInventoryFullscreen}>
                      {inventoryFullscreen ? 'Exit Full Screen' : 'Full Screen'}
                    </button>
                    <button className="secondary" onClick={() => window.print()}>Print / PDF</button>
                  </>
                }
              />
              <section id="inventory-presentation-shell" className="meeting-shell warehouse-presentation-shell">
                <div className="meeting-workspace">
                  <aside className="meeting-agenda">
                    <div className="meeting-agenda-head">
                      <span>INVENTORY REVIEW</span>
                      <strong>Presentation</strong>
                    </div>
                    <div className="meeting-agenda-list">
                      {inventoryPresentationSlides.map((item, i) => (
                        <button
                          key={item.title}
                          className={i === inventorySlide ? 'meeting-agenda-item active' : 'meeting-agenda-item'}
                          onClick={() => setInventorySlide(i)}
                        >
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <div>
                            <small>{item.kicker}</small>
                            <b>{item.title}</b>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="meeting-agenda-foot">
                      <span>SRD Warehouse System</span>
                      <small>Inventory management presentation</small>
                    </div>
                  </aside>

                  <div className="meeting-stage">
                    <div className="meeting-slide-topline">
                      <span>Slide {Math.min(inventorySlide + 1, inventoryPresentationSlides.length)} of {inventoryPresentationSlides.length}</span>
                      <div><i style={{ width: ((Math.min(inventorySlide, inventoryPresentationSlides.length - 1) + 1) / inventoryPresentationSlides.length * 100) + '%' }} /></div>
                    </div>

                    <div className="meeting-slide">
                      <div className="meeting-slide-header">
                        <div>
                          <span className="meeting-kicker">{inventoryPresentationSlides[Math.min(inventorySlide, inventoryPresentationSlides.length - 1)].kicker}</span>
                          <h2>{inventoryPresentationSlides[Math.min(inventorySlide, inventoryPresentationSlides.length - 1)].title}</h2>
                        </div>
                        <div className="meeting-slide-mark">SRD</div>
                      </div>
                      <div className="meeting-body">{inventoryPresentationSlides[Math.min(inventorySlide, inventoryPresentationSlides.length - 1)].body}</div>
                      <footer>
                        <span>Shipbuilding & Repair Division · Materials Management</span>
                        <span>Inventory Review</span>
                      </footer>
                    </div>

                    <div className="meeting-controls">
                      <button className="secondary" onClick={() => setInventorySlide(Math.max(0, inventorySlide - 1))} disabled={inventorySlide === 0}>Previous</button>
                      <span>{inventorySlide + 1} / {inventoryPresentationSlides.length}</span>
                      <button className="primary" onClick={() => setInventorySlide(Math.min(inventoryPresentationSlides.length - 1, inventorySlide + 1))} disabled={inventorySlide === inventoryPresentationSlides.length - 1}>Next</button>
                    </div>
                  </div>
                </div>
              </section>
            </>
          )}

          {view === 'history' && (
            <>
              <PageHeader title="History" subtitle="Source update log and saved weekly meeting snapshots." />
              <div className="dashboard-grid history-grid">
                <section className="panel">
                  <div className="panel-head"><div><span className="eyebrow">UPDATE HISTORY</span><h3>Source uploads</h3></div></div>
                  <div className="history-list">
                    {data.sourceUpdates.map((x) => (
                      <div key={x.id}>
                        <section><b>{humanSource(x.source_type)}</b><span>{x.file_name || 'Manual update'}</span></section>
                        <small>{fmt(x.row_count)} rows</small>
                        <time>{new Date(x.imported_at).toLocaleString()}</time>
                      </div>
                    ))}
                    {!data.sourceUpdates.length && <EmptyState />}
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-head"><div><span className="eyebrow">MEETING HISTORY</span><h3>Weekly snapshots</h3></div></div>
                  <div className="history-list">
                    {data.snapshots.map((x) => (
                      <div key={x.id}>
                        <section><b>{x.label || x.snapshot_date}</b><span>Saved figures retained for comparison</span></section>
                        <small>{x.metrics?.pending ?? 0} pending</small>
                        <time>{x.snapshot_date}</time>
                      </div>
                    ))}
                    {!data.snapshots.length && <EmptyState title="No snapshots yet" text="Save one from Wednesday Meeting." />}
                  </div>
                </section>
              </div>
            </>
          )}
        </section>
      </main>

      <NoteModal
        state={noteState}
        note={noteState ? noteMap.get(noteState.type + '|' + noteState.key) : null}
        onClose={() => setNoteState(null)}
        onSave={saveNote}
      />
    </div>
  )
}
