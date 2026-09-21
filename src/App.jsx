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
  return text ? text.toUpperCase() : 'PRF NOT RAISED'
}

function weekStartSunday(dateLike) {
  if (!dateLike) return ''
  const date = new Date(String(dateLike).slice(0, 10) + 'T12:00:00')
  if (Number.isNaN(date.valueOf())) return ''
  date.setDate(date.getDate() - date.getDay())
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

function AuthScreen() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function signIn(event) {
    event.preventDefault()
    setLoading(true)
    setMessage('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) setMessage(error.message)
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
        <h2>Sign in</h2>
        <p className="muted">Use the account approved for the SRD Inventory Portal.</p>
        <form onSubmit={signIn}>
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Password
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <button className="primary" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        {message && <p className="notice error">{message}</p>}
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

function MetricCard({ label, value, helper, tone = 'default' }) {
  return (
    <article className={'metric-card ' + tone}>
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

  const query = lower(search).trim()
  const matches = (row) => !query || Object.values(row).some((v) =>
    typeof v !== 'object' && lower(v).includes(query),
  )

  const allPrfRows = useMemo(
    () => procurementData.filter((r) => r.source_type === 'PRF'),
    [procurementData],
  )

  const weekFilteredPrfRows = useMemo(
    () => allPrfRows.filter((row) =>
      prfWeekFilter === 'ALL' || weekStartSunday(row.pr_date) === prfWeekFilter
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
      const weekStart = weekStartSunday(row.pr_date)
      if (weekStart) counts.set(weekStart, (counts.get(weekStart) || 0) + 1)
    })

    const currentWeek = weekStartSunday(new Date().toISOString().slice(0, 10))
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
  const prpoRows = useMemo(
    () => procurementData.filter((r) => ['PR', 'PO'].includes(r.source_type) && matches(r)),
    [procurementData, query],
  )
  const mtrRows = useMemo(
    () => data.material.filter((r) => r.document_type === 'MTR' && matches(r)),
    [data.material, query],
  )
  const mrnRows = useMemo(
    () => data.material.filter((r) => r.document_type === 'MRN' && matches(r)),
    [data.material, query],
  )
  const stockRows = useMemo(() => data.stock.filter(matches), [data.stock, query])
  const transactionRows = useMemo(() => data.transactions.filter(matches), [data.transactions, query])

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
    const statusMap = new Map(overallPrfStatusCounts)
    const preferred = ['PRF NOT RAISED', 'ITEM CREATION PENDING']
      .filter((status) => statusMap.has(status))
      .map((status) => [status, statusMap.get(status)])

    const preferredSet = new Set(preferred.map(([status]) => status))
    const remaining = overallPrfStatusCounts.filter(([status]) => !preferredSet.has(status))

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
      title: 'PRF Status Breakdown',
      body: (
        <>
          <div className="meeting-prf-total">
            <span>Total PRFs in current register</span>
            <strong>{fmt(allPrfRows.length)}</strong>
          </div>
          <div className="meeting-status-grid">
            {meetingPrfStatuses.map(([status, count]) => (
              <div
                className={
                  status === 'PRF NOT RAISED' || status === 'ITEM CREATION PENDING'
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
            <EmptyState title="No PRF status data loaded" text="Upload and apply the PRF / IPF register." />
          )}
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
          {NAV.map(([key, label, icon]) => (
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
            <button className="primary" onClick={() => setView('updates')}>Update data</button>
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
                  <span>Sunday–Saturday</span>
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
                      <strong>{fmt(week.count)}</strong>
                    </button>
                  ))}
                </div>

                {prfWeekFilter !== 'ALL' && (
                  <div className="prf-filter-note">
                    Showing PRFs submitted {formatShortDate(prfWeekFilter)} – {formatShortDate(addDaysIso(prfWeekFilter, 6))}
                    <button onClick={() => setPrfWeekFilter('ALL')}>Clear week</button>
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
                        ? ' — ' + formatShortDate(prfWeekFilter) + '–' + formatShortDate(addDaysIso(prfWeekFilter, 6))
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
                onUpdate={openNote}
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
              <DataTable rows={prpoRows} columns={procurementColumns} noteType="procurement" noteMap={noteMap} onUpdate={openNote} />
            </>
          )}

          {view === 'mtr' && (
            <>
              <PageHeader title="MTR Tracker" subtitle="Requested, transferred and remaining quantities by vessel / SR." />
              <DataTable rows={mtrRows} columns={materialColumns} noteType="material" noteMap={noteMap} onUpdate={openNote} />
            </>
          )}

          {view === 'mrn' && (
            <>
              <PageHeader title="MRN & Issues" subtitle="Material requests and ERP issue progress against SR / work order." />
              <DataTable rows={mrnRows} columns={materialColumns} noteType="material" noteMap={noteMap} onUpdate={openNote} />
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
                    <DataTable rows={vesselProc} columns={procurementColumns.slice(0, 10)} noteType="procurement" noteMap={noteMap} onUpdate={openNote} limit={100} />
                  </section>
                  <section className="panel wide">
                    <div className="panel-head"><h3>MTR / MRN</h3><span>{vesselMat.length} records</span></div>
                    <DataTable rows={vesselMat} columns={materialColumns} noteType="material" noteMap={noteMap} onUpdate={openNote} limit={100} />
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
              <DataTable rows={stockRows} noteType="stock" noteMap={noteMap} onUpdate={openNote} columns={[
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

          {view === 'updates' && (
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
