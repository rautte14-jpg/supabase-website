import { useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { SOURCE_OPTIONS, detectSource, entityKey, humanSource, mapRows, normalizeSheetRows } from './importers'

const NAV = [
  ['overview', 'Overview', '⌂'],
  ['prf', 'PRF Tracker', 'P'],
  ['prpo', 'PR & PO Tracker', 'O'],
  ['mtr', 'MTR Tracker', 'T'],
  ['mrn', 'MRN & Issues', 'M'],
  ['vessel', 'Vessel / SR View', 'V'],
  ['stock', 'Stock & Ageing', 'S'],
  ['transactions', 'Receipts & Issues', 'R'],
  ['updates', 'Update Centre', 'U'],
  ['meeting', 'Wednesday Meeting', 'W'],
  ['history', 'History', 'H'],
]

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

function dateRowField(row, directKey, rawNames = []) {
  const direct = row?.[directKey]
  const value = direct || rawField(row, rawNames)
  if (!value) return ''
  const d = new Date(String(value).slice(0, 10) + (String(value).includes('T') ? '' : 'T12:00:00'))
  if (!Number.isNaN(d.valueOf())) return d.toISOString().slice(0, 10)
  const fallback = new Date(value)
  return Number.isNaN(fallback.valueOf()) ? '' : fallback.toISOString().slice(0, 10)
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
  return String(row?.status || rawField(row, ['Issued Status']) || '').trim() || 'BLANK'
}

function mrnIsIssued(row) {
  const status = lower(mrnStatusLabel(row))
  return (
    status === 'issued' ||
    status.includes('issued') ||
    status.includes('complete') ||
    status.includes('completed') ||
    status.includes('posted')
  ) && !status.includes('not issued') && !status.includes('unissued')
}

function mrnIsCancelled(row) {
  const status = lower(mrnStatusLabel(row))
  return status.includes('cancel') || status.includes('reject')
}

function mrnIsPending(row) {
  return !mrnIsIssued(row) && !mrnIsCancelled(row)
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
        <h1>Inventory Control Centre</h1>
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
    tone,
    onClick ? 'clickable' : '',
    active ? 'active' : '',
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
  let cls = ''
  if (['urgent', 'critical', 'overdue', 'pending', 'delayed'].some((x) => l.includes(x))) cls = 'bad'
  if (['received', 'complete', 'completed', 'delivered', 'closed'].some((x) => l.includes(x))) cls = 'good'
  if (['progress', 'partial', 'transit', 'processing'].some((x) => l.includes(x))) cls = 'warn'
  return <span className={'status-pill ' + cls}>{text}</span>
}

function EmptyState({ title = 'No records yet', text = 'Use Update Centre to load the latest source file.' }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  )
}

function DataTable({ rows, columns, onUpdate, noteType, noteMap, limit = 300 }) {
  const visible = rows.slice(0, limit)
  if (!rows.length) return <EmptyState />
  return (
    <div className="table-wrap">
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
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
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
      } else if (source === 'MTR' || source === 'MRN') {
        const { error } = await supabase.from('material_records').delete().eq('document_type', source)
        if (error) throw error
        await insertBatches('material_records', mapped)
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
        for (let i = 0; i < mapped.length; i += 400) {
          const { error } = await supabase.from('stock_items').upsert(mapped.slice(i, i + 400), { onConflict: 'item_code' })
          if (error) throw error
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

export default function App() {
  const [session, setSession] = useState(null)
  const [checking, setChecking] = useState(true)
  const [access, setAccess] = useState(null)
  const [view, setView] = useState('overview')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({
    procurement: [],
    material: [],
    stock: [],
    transactions: [],
    lld: [],
    notes: [],
    sourceUpdates: [],
    snapshots: [],
  })
  const [noteState, setNoteState] = useState(null)
  const [vesselSearch, setVesselSearch] = useState('')
  const [slide, setSlide] = useState(0)
  const [prfStatusFilter, setPrfStatusFilter] = useState('ALL')
  const [prfWeekFilter, setPrfWeekFilter] = useState('ALL')
  const [prPoWeekFilter, setPrPoWeekFilter] = useState('ALL')
  const [prPoAgeFilter, setPrPoAgeFilter] = useState('ALL')
  const [prPoUrgentFilter, setPrPoUrgentFilter] = useState(false)
  const [prPoReceiptPendingFilter, setPrPoReceiptPendingFilter] = useState(false)
  const [mtrWeekFilter, setMtrWeekFilter] = useState('ALL')
  const [mtrControlFilter, setMtrControlFilter] = useState('ALL')
  const [mtrStatusFilter, setMtrStatusFilter] = useState('ALL')
  const [mtrDeliveryFilter, setMtrDeliveryFilter] = useState('ALL')
  const [mrnWeekFilter, setMrnWeekFilter] = useState('ALL')
  const [mrnControlFilter, setMrnControlFilter] = useState('ALL')
  const [mrnStatusFilter, setMrnStatusFilter] = useState('ALL')
  const [mrnWorkshopFilter, setMrnWorkshopFilter] = useState('ALL')
  const [mrnWpTypeFilter, setMrnWpTypeFilter] = useState('ALL')

  const canEdit = access && ['admin', 'editor'].includes(lower(access.role))
  const isAdmin = access && lower(access.role) === 'admin'

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setChecking(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setChecking(false)
    })
    return () => listener.subscription.unsubscribe()
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

  async function loadAll() {
    if (!session || !access) return
    setLoading(true)
    try {
      const [
        procurement,
        material,
        stock,
        transactions,
        lld,
        notes,
        sourceUpdates,
        snapshots,
      ] = await Promise.all([
        fetchAllRows('procurement_records', 'updated_at', false),
        fetchAllRows('material_records', 'updated_at', false),
        fetchAllRows('stock_items', 'item_code', true),
        fetchAllRows('inventory_transactions', 'physical_date', false),
        fetchAllRows('lld_updates', 'updated_at', false),
        fetchAllRows('case_notes', 'updated_at', false),
        fetchAllRows('source_updates', 'imported_at', false),
        fetchAllRows('weekly_snapshots', 'snapshot_date', false),
      ])

      setData({
        procurement,
        material,
        stock,
        transactions,
        lld,
        notes,
        sourceUpdates,
        snapshots,
      })
    } catch (error) {
      console.error('Failed to load portal data', error)
    }
    setLoading(false)
  }

  useEffect(() => {
    if (access) loadAll()
  }, [access?.email])

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
      await loadAll()
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
  }

  function togglePrPoUrgent() {
    setPrPoUrgentFilter((current) => !current)
    setPrPoAgeFilter('ALL')
    setPrPoReceiptPendingFilter(false)
  }

  function togglePrPoReceiptPending() {
    setPrPoReceiptPendingFilter((current) => !current)
    setPrPoAgeFilter('ALL')
    setPrPoUrgentFilter(false)
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
    setMrnStatusFilter((current) => current === status ? 'ALL' : status)
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
        weekEnd: addDaysIso(weekStart, 7),
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

  const prPoWeekCounts = useMemo(() => {
    const weekSets = new Map()
    allPrLines.forEach((row) => {
      const weekStart = weekStartWednesday(prSubmittedDate(row))
      const prNo = String(row.pr_no || '').trim()
      if (!weekStart || !prNo) return
      if (!weekSets.has(weekStart)) weekSets.set(weekStart, new Set())
      weekSets.get(weekStart).add(prNo)
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 7),
        count: weekSets.get(weekStart)?.size || 0,
      }
    })
  }, [allPrLines])

  const weekFilteredPrLines = useMemo(
    () => allPrLines.filter((row) =>
      prPoWeekFilter === 'ALL' || weekStartWednesday(prSubmittedDate(row)) === prPoWeekFilter
    ),
    [allPrLines, prPoWeekFilter],
  )

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
      if (!weekStart || !mtrNo || !isSundayToWednesday(mtrRequestDate(row))) return
      if (!weekSets.has(weekStart)) weekSets.set(weekStart, new Set())
      weekSets.get(weekStart).add(mtrNo)
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 7),
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
    let stockAvailablePending = 0
    let pendingNoStock = 0
    let aged7 = 0
    let aged14 = 0
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

      if (pending && mtrStockAvailable(row)) stockAvailablePending += 1
      if (pending && !mtrStockAvailable(row)) pendingNoStock += 1

      const age = mtrAgeDays(row)
      if (pending && age >= 7) aged7 += 1
      if (pending && age >= 14) aged14 += 1
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
      stockAvailablePending,
      pendingNoStock,
      aged7,
      aged14,
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
      if (mtrControlFilter === 'STOCK_PENDING' && !(pending && mtrStockAvailable(row))) return false
      if (mtrControlFilter === 'NO_STOCK' && !(pending && !mtrStockAvailable(row))) return false
      if (mtrControlFilter === 'AGE7' && !(pending && mtrAgeDays(row) >= 7)) return false
      if (mtrControlFilter === 'AGE14' && !(pending && mtrAgeDays(row) >= 14)) return false
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
    const weekSets = new Map()
    allMrnRows.forEach((row) => {
      const weekStart = weekStartWednesday(mrnCreatedDate(row))
      const mrnNo = String(row.document_no || '').trim()
      if (!weekStart || !mrnNo || !isSundayToWednesday(mrnCreatedDate(row))) return
      if (!weekSets.has(weekStart)) weekSets.set(weekStart, new Set())
      weekSets.get(weekStart).add(mrnNo)
    })

    const currentWeek = weekStartWednesday(new Date().toISOString().slice(0, 10))
    return Array.from({ length: 8 }, (_, index) => {
      const weekStart = addDaysIso(currentWeek, index * -7)
      return {
        weekStart,
        weekEnd: addDaysIso(weekStart, 7),
        count: weekSets.get(weekStart)?.size || 0,
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
    const all = new Set()
    const issued = new Set()
    const pending = new Set()
    const pending7 = new Set()
    const pending14 = new Set()
    const pending30 = new Set()
    const noJournal = new Set()
    const withJournal = new Set()

    weekFilteredMrnRows.forEach((row) => {
      const mrnNo = String(row.document_no || '').trim()
      if (!mrnNo) return
      all.add(mrnNo)

      if (mrnIsIssued(row)) issued.add(mrnNo)
      if (mrnIsPending(row)) {
        pending.add(mrnNo)
        const age = mrnAgeDays(row)
        if (age >= 7) pending7.add(mrnNo)
        if (age >= 14) pending14.add(mrnNo)
        if (age >= 30) pending30.add(mrnNo)
        if (!mrnHasJournal(row)) noJournal.add(mrnNo)
      }

      if (mrnHasJournal(row)) withJournal.add(mrnNo)
    })

    return {
      total: all.size,
      issued: issued.size,
      pending: pending.size,
      pending7: pending7.size,
      pending14: pending14.size,
      pending30: pending30.size,
      noJournal: noJournal.size,
      withJournal: withJournal.size,
      issuedSet: issued,
      pendingSet: pending,
      pending7Set: pending7,
      pending14Set: pending14,
      pending30Set: pending30,
      noJournalSet: noJournal,
      withJournalSet: withJournal,
    }
  }, [weekFilteredMrnRows])

  const mrnStatusCounts = useMemo(() => {
    const sets = new Map()
    weekFilteredMrnRows.forEach((row) => {
      const status = mrnStatusLabel(row)
      const mrnNo = String(row.document_no || '').trim()
      if (!mrnNo) return
      if (!sets.has(status)) sets.set(status, new Set())
      sets.get(status).add(mrnNo)
    })
    return [...sets.entries()]
      .map(([status, values]) => [status, values.size])
      .sort((a, b) => b[1] - a[1])
  }, [weekFilteredMrnRows])

  const mrnWorkshopCounts = useMemo(() => {
    const sets = new Map()
    weekFilteredMrnRows.forEach((row) => {
      const workshop = String(row.workshop || '').trim() || 'BLANK'
      const mrnNo = String(row.document_no || '').trim()
      if (!mrnNo) return
      if (!sets.has(workshop)) sets.set(workshop, new Set())
      sets.get(workshop).add(mrnNo)
    })
    return [...sets.entries()]
      .map(([workshop, values]) => [workshop, values.size])
      .sort((a, b) => b[1] - a[1])
  }, [weekFilteredMrnRows])

  const mrnWpTypeCounts = useMemo(() => {
    const sets = new Map()
    weekFilteredMrnRows.forEach((row) => {
      const wpType = mrnWpType(row)
      const mrnNo = String(row.document_no || '').trim()
      if (!mrnNo) return
      if (!sets.has(wpType)) sets.set(wpType, new Set())
      sets.get(wpType).add(mrnNo)
    })
    return [...sets.entries()]
      .map(([wpType, values]) => [wpType, values.size])
      .sort((a, b) => b[1] - a[1])
  }, [weekFilteredMrnRows])

  const mrnRows = useMemo(
    () => weekFilteredMrnRows.filter((row) => {
      if (!matches(row)) return false

      const mrnNo = String(row.document_no || '').trim()
      if (mrnControlFilter === 'ISSUED' && !mrnSummary.issuedSet.has(mrnNo)) return false
      if (mrnControlFilter === 'PENDING' && !mrnSummary.pendingSet.has(mrnNo)) return false
      if (mrnControlFilter === 'AGE7' && !mrnSummary.pending7Set.has(mrnNo)) return false
      if (mrnControlFilter === 'AGE14' && !mrnSummary.pending14Set.has(mrnNo)) return false
      if (mrnControlFilter === 'AGE30' && !mrnSummary.pending30Set.has(mrnNo)) return false
      if (mrnControlFilter === 'NO_JOURNAL' && !mrnSummary.noJournalSet.has(mrnNo)) return false
      if (mrnControlFilter === 'WITH_JOURNAL' && !mrnSummary.withJournalSet.has(mrnNo)) return false

      if (mrnStatusFilter !== 'ALL' && mrnStatusLabel(row) !== mrnStatusFilter) return false

      const workshop = String(row.workshop || '').trim() || 'BLANK'
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
    mrns: new Set(mrnRows.map((r) => r.document_no).filter(Boolean)).size,
    rows: mrnRows.length,
  }), [mrnRows])
  const stockRows = useMemo(() => data.stock.filter(matches), [data.stock, query])
  const transactionRows = useMemo(() => data.transactions.filter(matches), [data.transactions, query])

  const prPoSummary = useMemo(() => {
    const prMap = new Map()

    weekFilteredPrLines.forEach((row) => {
      const prNo = String(row.pr_no || '').trim()
      if (!prNo) return

      if (!prMap.has(prNo)) {
        prMap.set(prNo, {
          requested: 0,
          received: 0,
          submitted: null,
          lineCount: 0,
          fullLines: 0,
          partialLines: 0,
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
      if (state === 'partial') item.partialLines += 1
      if (!status.includes('cancel') && !status.includes('reject')) item.activeLines += 1

      const dateIso = prSubmittedDate(row)
      if (dateIso) {
        const d = new Date(dateIso + 'T12:00:00')
        if (!Number.isNaN(d.valueOf()) && (!item.submitted || d < item.submitted)) item.submitted = d
      }
    })

    const prs = [...prMap.values()].filter((p) => p.activeLines > 0)
    const isFullyReceived = (p) =>
      (p.requested > 0 && p.received >= p.requested) ||
      (p.lineCount > 0 && p.fullLines === p.lineCount)

    const fullyReceived = prs.filter(isFullyReceived)
    const partReceived = prs.filter((p) =>
      !isFullyReceived(p) && (p.received > 0 || p.partialLines > 0 || p.fullLines > 0)
    )

    const receivedItemQty = weekFilteredPrLines.reduce(
      (sum, row) => sum + receivedQty(row),
      0,
    )

    const poMap = new Map()
    weekFilteredPrLines.forEach((row, index) => {
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
      if (!(amount > 0) || !(received > 0)) return

      const poNo = String(row.po_no || '').trim()
      const key = poNo || 'LINE-' + (row.id ?? index)

      if (!poMap.has(key)) poMap.set(key, { value: 0, requested: 0, received: 0 })
      const po = poMap.get(key)
      po.value = poNo ? Math.max(po.value, amount) : po.value + amount
      po.requested += requested
      po.received += received
    })

    const receivedItemValue = [...poMap.values()].reduce((sum, po) => {
      if (!(po.value > 0) || !(po.received > 0)) return sum
      if (!(po.requested > 0)) return sum + po.value
      return sum + po.value * Math.min(1, po.received / po.requested)
    }, 0)

    const urgentPendingItems = weekFilteredPrLines.filter(isUrgentPendingRow).length
    const receiptNotDoneItems = weekFilteredPrLines.filter(isReceiptNotDoneRow).length

    return {
      totalPrs: prMap.size,
      fullyReceivedPrs: fullyReceived.length,
      partReceivedPrs: partReceived.length,
      urgentPendingItems,
      receiptNotDoneItems,
      receivedItemQty,
      receivedItemValue,
    }
  }, [weekFilteredPrLines])

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
    const value = data.stock.reduce((sum, r) => sum + Number(r.stock_value || 0), 0)
    const aged = data.stock.filter((r) => /12|24|36|over|old|year/i.test(r.age_band || ''))
    return {
      prf: new Set(procurementData.map((r) => r.prf_no).filter(Boolean)).size,
      mrn: new Set(data.material.filter((r) => r.document_type === 'MRN').map((r) => r.document_no).filter(Boolean)).size,
      pending: pendingPr.length,
      urgent: urgent.length,
      overdue: overdue.length,
      receipts: receipts.reduce((s, r) => s + Math.abs(Number(r.quantity || 0)), 0),
      issues: issues.reduce((s, r) => s + Math.abs(Number(r.quantity || 0)), 0),
      stockValue: value,
      agedValue: aged.reduce((sum, r) => sum + Number(r.stock_value || 0), 0),
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
    { key: 'sr_wo', label: 'SR / WO' },
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
    { key: 'raw_prf_description', label: 'PRF Description', render: (_v, r) => displayValue(rawField(r, ['PRF Description'])) },
    { key: 'prf_no', label: 'PRF Number', render: (v) => displayValue(v, true) },
    { key: 'sr_wo', label: 'SR Number', render: (v) => displayValue(v, true) },
    { key: 'asset_vessel', label: 'Asset / Vessel', render: (_v, r) => rawField(r, ['Asset / Vessel']) || r.asset || r.vessel || '—' },
    { key: 'section', label: 'Section' },
    { key: 'purchase_from', label: 'From', render: (v, r) => v || rawField(r, ['From']) || '—' },
    { key: 'purchase_type', label: 'Type', render: (v, r) => v || rawField(r, ['Type']) || '—' },
    { key: 'raw_pr_name', label: 'PR Name', render: (_v, r) => displayValue(rawField(r, ['PR Name']), true) },
    { key: 'pr_no', label: 'PR No.', render: (v) => displayValue(v, true) },
    { key: 'po_no', label: 'PO Number', render: (v) => displayValue(v, true) },
    { key: 'priority', label: 'Priority', render: (v) => <StatusPill value={v} /> },
    { key: 'raw_line_no', label: '#', render: (_v, r) => displayValue(rawField(r, ['#'])) },
    { key: 'item_code', label: 'Item ID', render: (v) => displayValue(v, true) },
    { key: 'item_description', label: 'Product Name', render: (v) => displayValue(v, true) },
    { key: 'qty_requested', label: 'Quantity', render: (v, r) => v ?? rawField(r, ['Quantity']) ?? '—' },
    { key: 'unit', label: 'Unit' },
    { key: 'raw_category', label: 'Category', render: (_v, r) => rawField(r, ['Category']) || '—' },
    { key: 'amount', label: 'PO Value', render: (v, r) => {
      const value = v ?? numericRowField(r, 'amount', ['PO Value'])
      return value === null || value === undefined || value === '' ? '—' : money(value)
    } },
    { key: 'raw_on_hand', label: 'On-Hand', render: (_v, r) => rawField(r, ['On-Hand', 'On Hand']) || '—' },
    { key: 'status', label: 'ERP Status', render: (v, r) => <StatusPill value={v || rawField(r, ['ERP Status'])} /> },
    { key: 'pr_date', label: 'Submitted Date', render: (v, r) => v || rawField(r, ['Submitted Date']) || '—' },
    { key: 'expected_delivery', label: 'PO Delivery Date', render: (v, r) => v || rawField(r, ['PO Delivery Date']) || '—' },
    { key: 'raw_po_erp_status', label: 'PO ERP Status', render: (_v, r) => <StatusPill value={rawField(r, ['PO ERP Status', 'PO ERP']) || '—'} /> },
    { key: 'supplier', label: 'Supplier' },
    { key: 'raw_received_date', label: 'Received Date', render: (_v, r) => rawField(r, ['Received Date']) || '—' },
    { key: 'qty_received', label: 'Received Qty', render: (v, r) => v ?? rawField(r, ['Received Qty']) ?? '—' },
    { key: 'balance_qty', label: 'Balance Qty', render: (v, r) => v ?? rawField(r, ['Balance Qty']) ?? '—' },
    { key: 'delivery_status', label: 'Delivery Status', render: (v, r) => <StatusPill value={v || rawField(r, ['Delivery Status']) || '—'} /> },
    { key: 'raw_delivery_note', label: 'Delivery Note', render: (_v, r) => rawField(r, ['Delivery Note']) || '—' },
    { key: 'raw_receipt', label: 'Receipt', render: (_v, r) => rawField(r, ['Receipt']) || '—' },
    { key: 'raw_age', label: 'Age (Months & Days)', render: (_v, r) => rawField(r, ['Age (Months & Days)', 'Age']) || '—' },
    { key: 'raw_rec_week', label: 'Rec Week', render: (_v, r) => rawField(r, ['Rec Week']) || '—' },
    { key: 'latest_updates', label: 'PD Status Updates', render: (v, r) => v || rawField(r, ['PD Status Updates']) || '—' },
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
    { key: 'status', label: 'Issued Status', render: (v, r) => <StatusPill value={v || rawField(r, ['Issued Status']) || '—'} /> },
    { key: 'raw_modified_by', label: 'Modified By', render: (_v, r) => displayValue(rawField(r, ['Modified by', 'Modified By'])) },
    { key: 'raw_item_type', label: 'Item Type', render: (_v, r) => displayValue(rawField(r, ['Item Type'])) },
    { key: 'raw_path', label: 'Path', render: (_v, r) => displayValue(rawField(r, ['Path'])) },
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
    const { error } = await supabase.from('weekly_snapshots').insert({
      label: 'Wednesday Meeting ' + todayIso,
      metrics,
      priority_cases: urgentCases,
      created_by: session.user.email,
    })
    if (!error) await loadAll()
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

  const meetingSlides = [
    {
      kicker: 'WEEKLY CONTROL VIEW',
      title: 'SRD Inventory Overview',
      body: (
        <div className="meeting-metrics">
          <MetricCard label="PRFs tracked" value={metrics.prf} />
          <MetricCard label="MRNs tracked" value={metrics.mrn} />
          <MetricCard label="Pending PR / PO" value={metrics.pending} tone="warn" />
          <MetricCard label="Urgent cases" value={metrics.urgent} tone="bad" />
          <MetricCard label="Overdue delivery" value={metrics.overdue} tone="bad" />
          <MetricCard label="Stock value" value={money(metrics.stockValue)} />
        </div>
      ),
    },
    {
      kicker: 'REQUEST PIPELINE',
      title: 'PRFs & MRNs',
      body: (
        <div className="meeting-two">
          <div className="meeting-stat"><span>PRFs</span><b>{metrics.prf}</b><small>Request → PR / MTR follow-up</small></div>
          <div className="meeting-stat"><span>MRNs</span><b>{metrics.mrn}</b><small>Material request → ERP issue against SR</small></div>
        </div>
      ),
    },
    {
      kicker: 'PRF STATUS CONTROL',
      title:
        'PRF Status Breakdown' +
        (prfWeekFilter !== 'ALL'
          ? ' — ' + formatShortDate(prfWeekFilter) + '–' + formatShortDate(addDaysIso(prfWeekFilter, 7))
          : ''),
      body: (
        <>
          <div className="meeting-week-picker">
            <button
              className={prfWeekFilter === 'ALL' ? 'meeting-week-chip active' : 'meeting-week-chip'}
              onClick={() => selectPrfWeek('ALL')}
            >
              ALL WEEKS
            </button>
            {prfWeekCounts.map((week) => (
              <button
                key={week.weekStart}
                className={prfWeekFilter === week.weekStart ? 'meeting-week-chip active' : 'meeting-week-chip'}
                onClick={() => selectPrfWeek(week.weekStart)}
              >
                {formatShortDate(week.weekStart)}–{formatShortDate(week.weekEnd)}
                <b>{fmt(week.count)}</b>
              </button>
            ))}
          </div>

          <div className="meeting-prf-total">
            <span>{prfWeekFilter === 'ALL' ? 'Total PRFs in current register' : 'PRFs submitted in selected week'}</span>
            <strong>{fmt(weekFilteredPrfRows.length)}</strong>
          </div>

          <div className="meeting-status-grid">
            {meetingPrfStatuses.map(([status, count]) => (
              <div
                className={
                  status === 'NOT ATTENDED' || status === 'ITEM CREATION PENDING'
                    ? 'meeting-status-card highlight'
                    : 'meeting-status-card'
                }
                key={status}
              >
                <span>{status}</span>
                <b>{fmt(count)}</b>
              </div>
            ))}
          </div>

          {!meetingPrfStatuses.length && (
            <EmptyState title="No PRF status data for this week" text="Choose another week or upload the PRF / IPF register." />
          )}
        </>
      ),
    },
    {
      kicker: 'MTR MOVEMENT CONTROL',
      title:
        'MTR Transfer Status' +
        (mtrWeekFilter !== 'ALL'
          ? ' — ' + formatShortDate(mtrWeekFilter) + '–' + formatShortDate(addDaysIso(mtrWeekFilter, 7))
          : ''),
      body: (
        <>
          <div className="meeting-week-picker">
            <button
              className={mtrWeekFilter === 'ALL' ? 'meeting-week-chip active' : 'meeting-week-chip'}
              onClick={() => selectMtrWeek('ALL')}
            >
              ALL WEEKS
            </button>
            {mtrWeekCounts.map((week) => (
              <button
                key={week.weekStart}
                className={mtrWeekFilter === week.weekStart ? 'meeting-week-chip active' : 'meeting-week-chip'}
                onClick={() => selectMtrWeek(week.weekStart)}
              >
                {formatShortDate(week.weekStart)}–{formatShortDate(week.weekEnd)}
                <b>{fmt(week.count)}</b>
              </button>
            ))}
          </div>
          <div className="meeting-metrics">
            <MetricCard label="MTRs" value={fmt(mtrSummary.totalMtrs)} helper="Distinct MTR numbers" />
            <MetricCard label="Fully transferred" value={fmt(mtrSummary.fullyTransferred)} />
            <MetricCard label="Partially transferred" value={fmt(mtrSummary.partiallyTransferred)} tone="warn" />
            <MetricCard label="Not transferred" value={fmt(mtrSummary.notTransferred)} tone="bad" />
            <MetricCard label="Stock available, pending" value={fmt(mtrSummary.stockAvailablePending)} tone="bad" helper="Item lines" />
            <MetricCard label="30+ day pending" value={fmt(mtrSummary.aged30)} tone="bad" helper="Item lines" />
          </div>
        </>
      ),
    },
    {
      kicker: 'MRN / ISSUE CONTROL',
      title:
        'MRN Issue Status' +
        (mrnWeekFilter !== 'ALL'
          ? ' — ' + formatShortDate(mrnWeekFilter) + '–' + formatShortDate(addDaysIso(mrnWeekFilter, 7))
          : ''),
      body: (
        <>
          <div className="meeting-week-picker">
            <button
              className={mrnWeekFilter === 'ALL' ? 'meeting-week-chip active' : 'meeting-week-chip'}
              onClick={() => selectMrnWeek('ALL')}
            >
              ALL WEEKS
            </button>
            {mrnWeekCounts.map((week) => (
              <button
                key={week.weekStart}
                className={mrnWeekFilter === week.weekStart ? 'meeting-week-chip active' : 'meeting-week-chip'}
                onClick={() => selectMrnWeek(week.weekStart)}
              >
                {formatShortDate(week.weekStart)}–{formatShortDate(week.weekEnd)}
                <b>{fmt(week.count)}</b>
              </button>
            ))}
          </div>
          <div className="meeting-metrics">
            <MetricCard label="MRNs" value={fmt(mrnSummary.total)} helper="Distinct MRN numbers" />
            <MetricCard label="Issued" value={fmt(mrnSummary.issued)} />
            <MetricCard label="Pending / Not issued" value={fmt(mrnSummary.pending)} tone="bad" />
            <MetricCard label="14+ day pending" value={fmt(mrnSummary.pending14)} tone="warn" />
            <MetricCard label="30+ day pending" value={fmt(mrnSummary.pending30)} tone="bad" />
            <MetricCard label="Pending without SVO / Journal" value={fmt(mrnSummary.noJournal)} tone="bad" />
          </div>
        </>
      ),
    },
    {
      kicker: 'MOVEMENT',
      title: 'Receipts & Issues — last 7 days',
      body: (
        <div className="meeting-two">
          <div className="meeting-stat"><span>Received</span><b>{fmt(metrics.receipts, 2)}</b><small>Total quantity</small></div>
          <div className="meeting-stat"><span>Issued</span><b>{fmt(metrics.issues, 2)}</b><small>Total quantity</small></div>
        </div>
      ),
    },
    {
      kicker: 'INVENTORY HEALTH',
      title: 'Stock & Ageing',
      body: (
        <div className="meeting-two">
          <div className="meeting-stat"><span>Current stock value</span><b>{money(metrics.stockValue)}</b><small>From latest on-hand upload</small></div>
          <div className="meeting-stat"><span>Aged stock value</span><b>{money(metrics.agedValue)}</b><small>Based on uploaded ageing bands</small></div>
        </div>
      ),
    },
    {
      kicker: 'DECISIONS & OWNERS',
      title: 'Open Actions',
      body: (
        <div className="meeting-list">
          {data.notes.slice(0, 10).map((n) => (
            <div key={n.id}>
              <b>{n.entity_key}</b>
              <span>{n.action || n.remark || 'No action text'}</span>
              <small>{n.owner || 'No owner'} {n.deadline ? '• ' + n.deadline : ''}</small>
            </div>
          ))}
          {!data.notes.length && <EmptyState title="No actions recorded yet" text="Use Add update on tracker rows." />}
        </div>
      ),
    },
  ]

  if (checking) return <div className="splash">Loading SRD Inventory Control Centre…</div>
  if (!session) return <AuthScreen />
  if (access === null) return <div className="splash">Checking portal access…</div>
  if (access === false) return <AccessDenied email={session.user.email} />

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-box">SRD</div>
          <div>
            <strong>Inventory</strong>
            <span>Control Centre</span>
          </div>
        </div>

        <nav>
          {NAV
            .filter(([key]) => canEdit || key !== 'updates')
            .map(([key, label, icon]) => (
              <button key={key} className={view === key ? 'nav-item active' : 'nav-item'} onClick={() => setView(key)}>
                <span className="nav-icon">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
        </nav>

        <div className="sidebar-bottom">
          <span>{session.user.email}</span>
          <small>{access.role}</small>
          <button onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="search-wrap">
            <span>⌕</span>
            <input
              placeholder="Search PRF, PR, PO, MTR, MRN, item, vessel or SR…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && <button onClick={() => setSearch('')}>×</button>}
          </div>
          <div className="top-actions">
            <button className="secondary" onClick={loadAll}>{loading ? 'Refreshing…' : 'Refresh'}</button>
            {canEdit && <button className="primary" onClick={() => setView('updates')}>Update data</button>}
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

        <section className="content">
          {view === 'overview' && (
            <>
              <PageHeader title="Overview" subtitle="Live control view across SRD inventory and procurement sources." />
              <div className="metric-grid">
                <MetricCard label="PRFs tracked" value={metrics.prf} helper="Request register" />
                <MetricCard label="MRNs tracked" value={metrics.mrn} helper="Material requests" />
                <MetricCard label="Pending PR / PO" value={metrics.pending} tone="warn" />
                <MetricCard label="Urgent items" value={metrics.urgent} tone="bad" />
                <MetricCard label="Delivery delays" value={metrics.overdue} tone="bad" />
                <MetricCard label="Receipts — 7 days" value={fmt(metrics.receipts, 2)} />
                <MetricCard label="Issues — 7 days" value={fmt(metrics.issues, 2)} />
                <MetricCard label="Stock value" value={money(metrics.stockValue)} />
              </div>

              <div className="dashboard-grid">
                <section className="panel">
                  <div className="panel-head"><div><span className="eyebrow">SOURCE HEALTH</span><h3>Latest updates</h3></div></div>
                  <div className="source-list">
                    {['PRF','PR','PO','MTR','MRN','TRANSACTIONS','STOCK','AGEING','LLD'].map((s) => {
                      const x = lastSource.get(s)
                      return <div key={s}><b>{humanSource(s)}</b><span>{x ? new Date(x.imported_at).toLocaleString() : 'Not loaded'}</span><small>{x ? fmt(x.row_count) + ' rows' : '—'}</small></div>
                    })}
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-head"><div><span className="eyebrow">FOLLOW-UP</span><h3>Open actions</h3></div><button className="link-button" onClick={() => setView('meeting')}>Meeting view →</button></div>
                  <div className="action-list">
                    {data.notes.slice(0, 7).map((n) => (
                      <div key={n.id}>
                        <StatusPill value={n.priority || 'Action'} />
                        <section><b>{n.entity_key}</b><span>{n.action || n.remark || 'No action text'}</span></section>
                        <small>{n.owner || 'Unassigned'}</small>
                      </div>
                    ))}
                    {!data.notes.length && <EmptyState title="No open actions" text="Add follow-up notes from any tracker." />}
                  </div>
                </section>
              </div>
            </>
          )}

          {view === 'prf' && (
            <>
              <PageHeader title="PRF Tracker" subtitle="PRF / IPF requests and their movement into PR, MTR and PO." />

              <section className="prf-weekly-summary">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">WEEKLY SUBMISSIONS</span>
                    <h3>Submitted PRFs by week</h3>
                  </div>
                  <span>Wednesday–Wednesday</span>
                </div>

                <div className="prf-week-grid">
                  <button
                    className={prfWeekFilter === 'ALL' ? 'prf-week-card active' : 'prf-week-card'}
                    onClick={() => selectPrfWeek('ALL')}
                  >
                    <span>ALL WEEKS</span>
                    <strong>{fmt(allPrfRows.filter((r) => r.pr_date).length)}</strong>
                  </button>

                  {prfWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={prfWeekFilter === week.weekStart ? 'prf-week-card active' : 'prf-week-card'}
                      onClick={() => selectPrfWeek(week.weekStart)}
                    >
                      <span>{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong>{fmt(week.count)} {week.count === 1 ? 'PR' : 'PRs'}</strong>
                    </button>
                  ))}
                </div>

                {prfWeekFilter !== 'ALL' && (
                  <div className="prf-filter-note">
                    Showing PRFs submitted {formatShortDate(prfWeekFilter)} – {formatShortDate(addDaysIso(prfWeekFilter, 7))}
                    <button onClick={() => selectPrfWeek('ALL')}>Clear week</button>
                  </div>
                )}
              </section>

              <section className="prf-status-summary">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">STATUS SUMMARY</span>
                    <h3>
                      PRF quantity by status
                      {prfWeekFilter !== 'ALL'
                        ? ' — ' + formatShortDate(prfWeekFilter) + '–' + formatShortDate(addDaysIso(prfWeekFilter, 7))
                        : ''}
                    </h3>
                  </div>
                  <span>
                    {fmt(weekFilteredPrfRows.length)}
                    {prfWeekFilter === 'ALL' ? ' total PRFs' : ' PRFs in selected week'}
                  </span>
                </div>

                <div className="prf-status-grid">
                  <button
                    className={prfStatusFilter === 'ALL' ? 'prf-status-card active' : 'prf-status-card'}
                    onClick={() => setPrfStatusFilter('ALL')}
                  >
                    <span>{prfWeekFilter === 'ALL' ? 'ALL PRFs' : 'ALL IN WEEK'}</span>
                    <strong>{fmt(weekFilteredPrfRows.length)}</strong>
                  </button>

                  {prfStatusCounts.map(([status, count]) => (
                    <button
                      key={status}
                      className={prfStatusFilter === status ? 'prf-status-card active' : 'prf-status-card'}
                      onClick={() => setPrfStatusFilter(status)}
                    >
                      <span>{status}</span>
                      <strong>{fmt(count)}</strong>
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
                rows={prfRows}
                noteType="procurement"
                noteMap={noteMap}
                onUpdate={canEdit ? openNote : undefined}
                columns={[
                  { key: 'prf_no', label: 'PRF / IPF' },
                  { key: 'linked_pr_mtr', label: 'PR / MTR' },
                  { key: 'workshop', label: 'Workshop' },
                  { key: 'asset', label: 'Asset / Service', render: (v, r) => v || r.vessel || '—' },
                  { key: 'sr_wo', label: 'SR / WO' },
                  { key: 'work_order_type', label: 'Work Order Type' },
                  { key: 'purchase_from', label: 'Purchase From' },
                  { key: 'purchase_type', label: 'Purchase Type' },
                  { key: 'required_date', label: 'Required Date' },
                  { key: 'processed_date', label: 'Processed Date' },
                  { key: 'requested_by', label: 'Requested By' },
                  { key: 'status', label: 'Status', render: (v) => <StatusPill value={prfStatusLabel(v)} /> },
                  { key: 'latest_updates', label: 'Latest Updates' },
                  { key: 'cancel_reject_reason', label: 'Cancel / Reject Reason' },
                ]}
              />
            </>
          )}

          {view === 'prpo' && (
            <>
              <PageHeader title="PR & PO Tracker" subtitle="Procurement line status from PR through payment, delivery and receipt." />

              <section className="prf-weekly-summary">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">WEEKLY PR SUBMISSIONS</span>
                    <h3>Submitted PRs by week</h3>
                  </div>
                  <span>Wednesday–Wednesday</span>
                </div>

                <div className="prf-week-grid">
                  <button
                    className={prPoWeekFilter === 'ALL' ? 'prf-week-card active' : 'prf-week-card'}
                    onClick={() => selectPrPoWeek('ALL')}
                  >
                    <span>ALL WEEKS</span>
                    <strong>{fmt(new Set(allPrLines.map((r) => r.pr_no).filter(Boolean)).size)} PRs</strong>
                  </button>

                  {prPoWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={prPoWeekFilter === week.weekStart ? 'prf-week-card active' : 'prf-week-card'}
                      onClick={() => selectPrPoWeek(week.weekStart)}
                    >
                      <span>{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong>{fmt(week.count)}</strong>
                    </button>
                  ))}
                </div>

                {prPoWeekFilter !== 'ALL' && (
                  <div className="prf-filter-note">
                    Showing PRs submitted {formatShortDate(prPoWeekFilter)} – {formatShortDate(addDaysIso(prPoWeekFilter, 7))}
                    <button onClick={() => selectPrPoWeek('ALL')}>Clear week</button>
                  </div>
                )}
              </section>

              <div className="metric-grid prpo-metrics">
                <MetricCard
                  label="Fully Received PRs"
                  value={fmt(prPoSummary.fullyReceivedPrs)}
                  helper="Distinct PRs completely received"
                />
                <MetricCard
                  label="Partially Received PRs"
                  value={fmt(prPoSummary.partReceivedPrs)}
                  helper="Some quantity received; balance remains"
                  tone="warn"
                />
                <MetricCard
                  label="3–6 Month Aged PRs"
                  value={fmt(prPoAgeing.agedThreeToSix)}
                  helper="Click to show these aged PRs"
                  tone="warn"
                  active={prPoAgeFilter === '3TO6'}
                  onClick={() => selectPrPoAge('3TO6')}
                />
                <MetricCard
                  label="6+ Month Aged PRs"
                  value={fmt(prPoAgeing.agedSixPlus)}
                  helper={
                    prPoAgeing.agedSixPlus > 0
                      ? 'Click to show • oldest open ' + fmt(prPoAgeing.oldestOpenDays) + ' days'
                      : 'Click to show 6+ month aged PRs'
                  }
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
                  label="Receipt Not Done"
                  value={fmt(prPoSummary.receiptNotDoneItems)}
                  helper="PO exists but Received Qty is still 0"
                  tone="warn"
                  active={prPoReceiptPendingFilter}
                  onClick={togglePrPoReceiptPending}
                />
                <MetricCard
                  label="Received Item Quantity"
                  value={fmt(prPoSummary.receivedItemQty, 2)}
                  helper="Total quantity received"
                />
                <MetricCard
                  label="Received Items Value"
                  value={money(prPoSummary.receivedItemValue)}
                  helper="Received share of mapped PO value"
                />
              </div>

              {prPoAgeFilter !== 'ALL' && (
                <div className="prf-filter-note prpo-age-note">
                  Showing <b>{prPoAgeFilter === '3TO6' ? '3–6 month aged open PRs' : '6+ month aged open PRs'}</b>
                  <button onClick={() => selectPrPoAge('ALL')}>Clear ageing filter</button>
                </div>
              )}

              {prPoUrgentFilter && (
                <div className="prf-filter-note prpo-age-note">
                  Showing <b>urgent pending item lines</b>
                  <button onClick={() => setPrPoUrgentFilter(false)}>Clear urgent filter</button>
                </div>
              )}

              {prPoReceiptPendingFilter && (
                <div className="prf-filter-note prpo-age-note">
                  Showing <b>items where receipt is not done</b>
                  <button onClick={() => setPrPoReceiptPendingFilter(false)}>Clear receipt filter</button>
                </div>
              )}

              <div className="prpo-visible-count">
                <strong>{fmt(prPoVisibleCounts.prs)} PR{prPoVisibleCounts.prs === 1 ? '' : 's'}</strong>
                <span>{fmt(prPoVisibleCounts.lines)} item line{prPoVisibleCounts.lines === 1 ? '' : 's'} shown</span>
              </div>

              <DataTable rows={prpoRows} columns={prPoColumns} noteType="procurement" noteMap={noteMap} onUpdate={canEdit ? openNote : undefined} />
            </>
          )}

          {view === 'mtr' && (
            <>
              <PageHeader title="MTR Tracker" subtitle="Requested, transferred and remaining quantities by vessel / SR." />

              <section className="prf-weekly-summary">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">WEEKLY MTR REQUESTS</span>
                    <h3>MTRs requested by week</h3>
                  </div>
                  <span>Wednesday–Wednesday</span>
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
                    Showing MTRs requested {formatShortDate(mtrWeekFilter)} – {formatShortDate(addDaysIso(mtrWeekFilter, 7))}
                    <button onClick={() => selectMtrWeek('ALL')}>Clear week</button>
                  </div>
                )}
              </section>

              <div className="metric-grid mtr-metrics">
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
                  label="Stock Available but MTR Pending"
                  value={fmt(mtrSummary.stockAvailablePending)}
                  helper="Pending item lines with SRD stock available"
                  tone="bad"
                  active={mtrControlFilter === 'STOCK_PENDING'}
                  onClick={() => selectMtrControl('STOCK_PENDING')}
                />
                <MetricCard
                  label="Pending Due to No Stock"
                  value={fmt(mtrSummary.pendingNoStock)}
                  helper="Pending item lines without SRD stock"
                  tone="warn"
                  active={mtrControlFilter === 'NO_STOCK'}
                  onClick={() => selectMtrControl('NO_STOCK')}
                />
                <MetricCard
                  label="Pending 7+ Days"
                  value={fmt(mtrSummary.aged7)}
                  helper="Pending item lines"
                  active={mtrControlFilter === 'AGE7'}
                  onClick={() => selectMtrControl('AGE7')}
                />
                <MetricCard
                  label="Pending 14+ Days"
                  value={fmt(mtrSummary.aged14)}
                  helper="Pending item lines"
                  tone="warn"
                  active={mtrControlFilter === 'AGE14'}
                  onClick={() => selectMtrControl('AGE14')}
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

              <div className="mtr-breakdown-grid">
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
                        <span>{status}</span>
                        <strong>{fmt(count)}</strong>
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

              <section className="prf-weekly-summary">
                <div className="prf-status-head">
                  <div>
                    <span className="eyebrow">WEEKLY MRNs CREATED</span>
                    <h3>MRNs created by week</h3>
                  </div>
                  <span>Wednesday–Wednesday</span>
                </div>
                <div className="prf-week-grid">
                  <button
                    className={mrnWeekFilter === 'ALL' ? 'prf-week-card active' : 'prf-week-card'}
                    onClick={() => selectMrnWeek('ALL')}
                  >
                    <span>ALL WEEKS</span>
                    <strong>{fmt(new Set(allMrnRows.map((r) => r.document_no).filter(Boolean)).size)} MRNs</strong>
                  </button>
                  {mrnWeekCounts.map((week) => (
                    <button
                      key={week.weekStart}
                      className={mrnWeekFilter === week.weekStart ? 'prf-week-card active' : 'prf-week-card'}
                      onClick={() => selectMrnWeek(week.weekStart)}
                    >
                      <span>{formatShortDate(week.weekStart)} – {formatShortDate(week.weekEnd)}</span>
                      <strong>{fmt(week.count)} {week.count === 1 ? 'MRN' : 'MRNs'}</strong>
                    </button>
                  ))}
                </div>
                {mrnWeekFilter !== 'ALL' && (
                  <div className="prf-filter-note">
                    Showing MRNs created {formatShortDate(mrnWeekFilter)} – {formatShortDate(addDaysIso(mrnWeekFilter, 7))}
                    <button onClick={() => selectMrnWeek('ALL')}>Clear week</button>
                  </div>
                )}
              </section>

              <div className="metric-grid mtr-metrics">
                <MetricCard label="Total MRNs" value={fmt(mrnSummary.total)} helper="Distinct MRN numbers" />
                <MetricCard
                  label="Issued MRNs"
                  value={fmt(mrnSummary.issued)}
                  helper="Issued / completed in ERP"
                  active={mrnControlFilter === 'ISSUED'}
                  onClick={() => selectMrnControl('ISSUED')}
                />
                <MetricCard
                  label="Pending / Not Issued"
                  value={fmt(mrnSummary.pending)}
                  helper="Still waiting for ERP issue"
                  tone="bad"
                  active={mrnControlFilter === 'PENDING'}
                  onClick={() => selectMrnControl('PENDING')}
                />
                <MetricCard
                  label="Pending 7+ Days"
                  value={fmt(mrnSummary.pending7)}
                  helper="Pending MRNs"
                  active={mrnControlFilter === 'AGE7'}
                  onClick={() => selectMrnControl('AGE7')}
                />
                <MetricCard
                  label="Pending 14+ Days"
                  value={fmt(mrnSummary.pending14)}
                  helper="Pending MRNs"
                  tone="warn"
                  active={mrnControlFilter === 'AGE14'}
                  onClick={() => selectMrnControl('AGE14')}
                />
                <MetricCard
                  label="Pending 30+ Days"
                  value={fmt(mrnSummary.pending30)}
                  helper="Pending MRNs"
                  tone="bad"
                  active={mrnControlFilter === 'AGE30'}
                  onClick={() => selectMrnControl('AGE30')}
                />
                <MetricCard
                  label="Pending Without SVO / Journal"
                  value={fmt(mrnSummary.noJournal)}
                  helper="Pending MRNs without ERP issue reference"
                  tone="bad"
                  active={mrnControlFilter === 'NO_JOURNAL'}
                  onClick={() => selectMrnControl('NO_JOURNAL')}
                />
                <MetricCard
                  label="MRNs With SVO / Journal"
                  value={fmt(mrnSummary.withJournal)}
                  helper="MRNs linked to an ERP issue reference"
                  active={mrnControlFilter === 'WITH_JOURNAL'}
                  onClick={() => selectMrnControl('WITH_JOURNAL')}
                />
              </div>

              <div className="mtr-breakdown-grid">
                <section className="prf-status-summary">
                  <div className="prf-status-head">
                    <div><span className="eyebrow">ISSUED STATUS</span><h3>MRNs by issued status</h3></div>
                    <span>{fmt(mrnSummary.total)} MRNs</span>
                  </div>
                  <div className="prf-status-grid">
                    {mrnStatusCounts.slice(0, 12).map(([status, count]) => (
                      <button
                        key={status}
                        className={mrnStatusFilter === status ? 'prf-status-card active' : 'prf-status-card'}
                        onClick={() => selectMrnStatus(status)}
                      >
                        <span>{status}</span>
                        <strong>{fmt(count)}</strong>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="prf-status-summary">
                  <div className="prf-status-head">
                    <div><span className="eyebrow">WORKSHOP</span><h3>MRNs by workshop</h3></div>
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
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              <section className="prf-status-summary">
                <div className="prf-status-head">
                  <div><span className="eyebrow">WP TYPE</span><h3>MRNs by WP type</h3></div>
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

              {(mrnControlFilter !== 'ALL' || mrnStatusFilter !== 'ALL' || mrnWorkshopFilter !== 'ALL' || mrnWpTypeFilter !== 'ALL') && (
                <div className="prf-filter-note prpo-age-note">
                  Showing filtered MRNs
                  <button onClick={() => {
                    setMrnControlFilter('ALL')
                    setMrnStatusFilter('ALL')
                    setMrnWorkshopFilter('ALL')
                    setMrnWpTypeFilter('ALL')
                  }}>Clear MRN filter</button>
                </div>
              )}

              <div className="prpo-visible-count">
                <strong>{fmt(mrnVisibleCounts.mrns)} MRN{mrnVisibleCounts.mrns === 1 ? '' : 's'}</strong>
                <span>{fmt(mrnVisibleCounts.rows)} register row{mrnVisibleCounts.rows === 1 ? '' : 's'} shown</span>
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
              <PageHeader title="Stock & Ageing" subtitle="On-hand, reserved, available, on-order and ageing value." />
              <div className="metric-grid compact">
                <MetricCard label="Items" value={fmt(data.stock.length)} />
                <MetricCard label="Stock value" value={money(metrics.stockValue)} />
                <MetricCard label="Aged value" value={money(metrics.agedValue)} tone="warn" />
              </div>
              <DataTable rows={stockRows} noteType="stock" noteMap={noteMap} onUpdate={canEdit ? openNote : undefined} columns={[
                { key: 'item_code', label: 'Item' },
                { key: 'item_description', label: 'Description' },
                { key: 'unit', label: 'Unit' },
                { key: 'on_hand', label: 'On hand' },
                { key: 'reserved', label: 'Reserved' },
                { key: 'available', label: 'Available' },
                { key: 'on_order', label: 'On order' },
                { key: 'unit_cost', label: 'Unit cost', render: (v) => money(v) },
                { key: 'stock_value', label: 'Value', render: (v) => money(v) },
                { key: 'age_band', label: 'Age band', render: (v) => <StatusPill value={v} /> },
                { key: 'last_transaction_date', label: 'Last movement' },
              ]} />
            </>
          )}

          {view === 'transactions' && (
            <>
              <PageHeader title="Receipts & Issues" subtitle="ERP inventory movement with PO, sales order, journal and delivery references." />
              <DataTable rows={transactionRows} columns={[
                { key: 'physical_date', label: 'Physical date' },
                { key: 'transaction_type', label: 'Type', render: (v) => <StatusPill value={v} /> },
                { key: 'item_code', label: 'Item' },
                { key: 'item_description', label: 'Description' },
                { key: 'quantity', label: 'Qty' },
                { key: 'unit', label: 'Unit' },
                { key: 'cost', label: 'Cost', render: (v) => money(v) },
                { key: 'po_no', label: 'PO' },
                { key: 'sales_order', label: 'Sales order' },
                { key: 'journal_no', label: 'Journal' },
                { key: 'delivery_name', label: 'Delivery name' },
                { key: 'sr_wo', label: 'SR / WO' },
                { key: 'status', label: 'Status', render: (v) => <StatusPill value={v} /> },
              ]} />
            </>
          )}

          {view === 'updates' && canEdit && (
            <>
              <PageHeader title="Update Centre" subtitle="Load fresh ERP/Form exports and keep meeting remarks, actions and history intact." />
              <ImportPanel onApplied={loadAll} email={session.user.email} />
            </>
          )}

          {view === 'meeting' && (
            <>
              <PageHeader
                title="Wednesday Meeting"
                subtitle="Presentation view for weekly review, decisions and actions."
                actions={
                  <>
                    <button className="secondary" onClick={saveSnapshot}>Save weekly snapshot</button>
                    <button className="secondary" onClick={() => window.print()}>Print / PDF</button>
                  </>
                }
              />
              <section className="meeting-shell">
                <div className="meeting-slide">
                  <span className="meeting-kicker">{meetingSlides[slide].kicker}</span>
                  <h2>{meetingSlides[slide].title}</h2>
                  <div className="meeting-body">{meetingSlides[slide].body}</div>
                  <footer>
                    <span>SRD Inventory Control Centre</span>
                    <span>{slide + 1} / {meetingSlides.length}</span>
                  </footer>
                </div>
                <div className="meeting-controls">
                  <button className="secondary" onClick={() => setSlide(Math.max(0, slide - 1))} disabled={slide === 0}>← Previous</button>
                  <div>{meetingSlides.map((_, i) => <button key={i} className={i === slide ? 'dot active' : 'dot'} onClick={() => setSlide(i)} />)}</div>
                  <button className="primary" onClick={() => setSlide(Math.min(meetingSlides.length - 1, slide + 1))} disabled={slide === meetingSlides.length - 1}>Next →</button>
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
