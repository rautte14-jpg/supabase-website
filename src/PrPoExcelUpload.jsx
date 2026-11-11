import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'

const trim = value => String(value ?? '').trim()
const number = value => {
  if (value === null || value === undefined || trim(value) === '') return null
  const n = Number(String(value).replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}
const excelReceivedDate = value => {
  if (value === null || value === undefined || trim(value) === '') return null
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value)
    if (!d || !d.y || !d.m || !d.d) return null
    return [d.y, String(d.m).padStart(2, '0'), String(d.d).padStart(2, '0')].join('-')
  }
  // Preserve manually entered text exactly; do not guess whether 05/06 is May or June.
  return trim(value)
}
const norm = value => trim(value).replace(/\s+/g, ' ').toLowerCase()
const code = value => trim(value).toUpperCase().replace(/\s/g, '')
const headerFind = (head, wanted) => head.findIndex(value => wanted.includes(norm(value)))

function extractRows(workbook) {
  const sheet = workbook.Sheets['Purchase Requisitions'] || workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw Error('Excel workbook has no worksheets.')
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true })
  const headers = grid[1] || []
  const index = {
    pr: headerFind(headers, ['pr no.', 'pr no', 'pr number']),
    po: headerFind(headers, ['po number','po no.', 'po no']),
    item: headerFind(headers, ['item id', 'item code']),
    description: headerFind(headers, ['product name','item description']),
    qty: headerFind(headers, ['quantity','qty']),
    poValue: headerFind(headers, ['po value','purchase order value']),
    currency: headerFind(headers, ['currency']),
    submitted: headerFind(headers, ['submitted date']),
    priority: headerFind(headers, ['priority']),
    receivedDate: headerFind(headers, ['received date','receipt date']),
    received: headerFind(headers, ['received qty','received quantity']),
    balance: headerFind(headers, ['balance qty','balance quantity']),
    unit: headerFind(headers, ['unit','uom']),
    supplier: headerFind(headers, ['supplier']),
    status: headerFind(headers, ['delivery status']),
    poStatus: headerFind(headers, ['po erp status']),
  }
  if (index.pr < 0 || index.po < 0 || index.item < 0 || index.qty < 0) {
    throw Error('Required columns missing: PR No., PO Number, Item ID, Quantity. Check row 2 of Purchase Requisitions.')
  }
  const rows = []
  for (let index0 = 2; index0 < grid.length; index0++) {
    const raw = grid[index0] || []
    const item = code(raw[index.item])
    if (!item) continue
    const get = name => index[name] < 0 ? null : raw[index[name]]
    const pr = code(get('pr'))
    const po = code(get('po'))
    // Blank and '-' PO numbers are not proof of a purchase order.
    rows.push({
      source_row: index0 + 1,
      pr_no: /^PR\d+(?:-\d+)?$/.test(pr) ? pr : null,
      po_no: /^PO\d+(?:-\d+)?$/.test(po) ? po : null,
      item_code: item,
      item_description: trim(get('description')) || null,
      source_qty: number(get('qty')),
      received_qty: number(get('received')),
      excel_received_date: excelReceivedDate(get('receivedDate')),
      balance_qty: number(get('balance')),
      unit: trim(get('unit')) || null,
      supplier: trim(get('supplier')) || null,
      excel_delivery_status: trim(get('status')) || null,
      excel_po_status: trim(get('poStatus')) || null,
      source_raw: { worksheet: 'Purchase Requisitions', excel_row: index0 + 1, po_value: number(get('poValue')), currency: trim(get('currency')).toUpperCase() || 'MVR', submitted_date: excelReceivedDate(get('submitted')), priority: trim(get('priority')) },
    })
  }
  if (!rows.length) throw Error('No item records found in this workbook.')
  return rows
}

const boxStyle = { padding: '12px 16px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }
export default function PrPoExcelUpload() {
  const input = useRef(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [current, setCurrent] = useState(null)
  const [warning, setWarning] = useState('')
  const [preview, setPreview] = useState(null)

  async function loadCurrent() {
    const { data, error } = await supabase.from('erp_po_excel_batches')
      .select('id,source_file,source_row_count,completed_at')
      .eq('status', 'complete').order('completed_at', { ascending: false }).limit(1).maybeSingle()
    if (error) setWarning('Could not load Excel import status: ' + error.message)
    else { setWarning(''); setCurrent(data || null) }
  }
  useEffect(() => { loadCurrent() }, [])

  async function upload(file) {
    if (!file) return
    setBusy(true); setStatus('Reading workbook...'); setWarning(''); setPreview(null)
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false })
      const rows = extractRows(workbook)
      const mapped = rows.filter(r => r.pr_no && r.po_no).length
      const missingPo = rows.filter(r => r.pr_no && !r.po_no).length
      const duplicateCounts = new Map()
      rows.forEach(r => {
        if (r.pr_no && r.po_no) {
          const k = [r.pr_no,r.po_no,r.item_code].join('|')
          duplicateCounts.set(k,(duplicateCounts.get(k) || 0)+1)
        }
      })
      const duplicates = [...duplicateCounts.values()].filter(n => n > 1).length
      setPreview({ total: rows.length, mapped, missingPo, duplicates })
      setStatus('Saving ' + rows.length + ' source rows to a staged Excel batch...')
      const id = crypto.randomUUID()
      const { error: batchError } = await supabase.from('erp_po_excel_batches')
        .insert({ id, source_file: file.name, source_row_count: rows.length, status: 'staging' })
      if (batchError) throw batchError
      const batchSize = 150
      for (let offset = 0; offset < rows.length; offset += batchSize) {
        const data = rows.slice(offset, offset + batchSize).map(row => ({...row, batch_id: id}))
        const { error } = await supabase.from('erp_po_excel_rows').insert(data)
        if (error) throw new Error('Failed at Excel row ' + data[0].source_row + ': ' + error.message)
        setStatus('Staged ' + Math.min(offset + batchSize, rows.length) + ' / ' + rows.length + ' rows...')
      }
      const { error: finishError, data: count } = await supabase.rpc('complete_po_excel_batch', { p_batch: id })
      if (finishError) throw finishError
      setStatus('Import complete: ' + count + ' Excel item rows. Open a PR to see its PO item mapping.')
      await loadCurrent()
    } catch (err) {
      setWarning('Upload not activated: ' + (err?.message || String(err)) + '. Previous completed workbook is unchanged.')
      setStatus('')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return <section style={boxStyle}>
    <div style={{ flex: 1, minWidth: 240 }}>
      <strong style={{ fontSize: 13, color: '#0f172a' }}>Excel PO-to-item mapping</strong>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
        {current ? 'Active: ' + current.source_file + ' · ' + current.source_row_count.toLocaleString() + ' rows · ' + new Date(current.completed_at).toLocaleString()
          : 'No completed PO-to-item workbook imported yet.'}
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
        Received Qty, Balance Qty and Received All are confirmed by the uploaded Excel tracker. Excel Received Date is shown separately from Simplix ERP receipt events.
      </div>
      {preview && <div style={{ fontSize: 11, marginTop: 5, color: '#475569' }}>Workbook: {preview.total} items · {preview.mapped} PR/PO matches · {preview.missingPo} without PO · {preview.duplicates} repeated PR–PO–item groups (flagged)</div>}
      {status && <div role="status" style={{ fontSize: 11, marginTop: 5, color: '#166534' }}>{status}</div>}
      {warning && <div role="alert" style={{ fontSize: 11, marginTop: 5, color: '#b91c1c' }}>{warning}</div>}
    </div>
    <input ref={input} type="file" accept=".xlsx,.xls" disabled={busy} style={{ display: 'none' }} onChange={e => upload(e.target.files?.[0])} />
    <button type="button" disabled={busy} onClick={() => input.current?.click()} style={{ border: '1px solid #2563eb', background: busy ? '#e2e8f0' : '#eff6ff', color: '#1d4ed8', padding: '9px 14px', borderRadius: 9, fontWeight: 700, cursor: busy ? 'wait' : 'pointer' }}>
      {busy ? 'Importing...' : 'Upload PR / PO Excel'}
    </button>
  </section>
}
