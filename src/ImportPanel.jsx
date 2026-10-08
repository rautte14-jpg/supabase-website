import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { SOURCE_OPTIONS, detectSource, humanSource, mapRows, normalizeSheetRows } from './importers'

const lower = (value) => String(value ?? '').toLowerCase()

export default function ImportPanel({ onApplied, email, rawNumber }) {
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
