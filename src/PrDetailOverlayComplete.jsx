import { receiptTone } from './lib/receipts.js'
import { excelItemReceiptPosition, summarizeExcelReceiptPositions } from './lib/excelReceiptPosition.js'
import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const arr = (v) => Array.isArray(v) ? v : []
const lower = (v) => clean(v).toLowerCase()

function fmtDate(v) {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.valueOf()) ? clean(v) || '—' : d.toLocaleString()
}

function tone(status) {
  const result = receiptTone(status)
  return ['waiting', 'violet'].includes(result) ? 'pending' : result
}

function statusColor(status) {
  const t = tone(status)
  if (t === 'good') return '#57b833'
  if (t === 'bad') return '#dc2626'
  if (t === 'pending') return '#2f80ed'
  return '#94a3b8'
}

function elapsed(step) {
  const d = Number(step?.daysBetween ?? 0)
  const h = Number(step?.hoursBetween ?? 0)
  if (d > 0 && h > 0) return `${d} d ${h} h`
  if (d > 0) return `${d} d`
  if (h > 0) return `${h} h`
  return '0 h'
}

function WorkflowStep({ step }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '42px 12px 1fr', alignItems: 'start', gap: 10 }}>
      <div style={{ fontSize: 12, color: '#6b7280', paddingTop: 2, textAlign: 'right' }}>{elapsed(step)}</div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}><span style={{ width: 9, height: 9, borderRadius: 999, background: statusColor(step?.Status), display: 'block' }} /></div>
      <div style={{ paddingBottom: 16, fontSize: 12, lineHeight: 1.55, color: '#111827' }}>
        <div><span style={{ color: '#7c8595' }}>Approver:</span> <strong>{clean(step?.UserName) || '—'}</strong></div>
        <div><span style={{ color: '#7c8595' }}>Status:</span> {clean(step?.Status) || '—'}</div>
        <div><span style={{ color: '#7c8595' }}>Position:</span> {clean(step?.Position) || '—'}</div>
        {(step?.ApprovedDateTime || step?.ApprovedDate) && <div><span style={{ color: '#7c8595' }}>Approved At:</span> {fmtDate(step.ApprovedDateTime || step.ApprovedDate)}</div>}
        {clean(step?.Comment) && <div style={{ marginTop: 4, color: '#64748b' }}>{step.Comment}</div>}
      </div>
    </div>
  )
}

function EmptyText({ children }) {
  return <div style={{ fontSize: 13, color: '#8b95a5', padding: '18px 2px' }}>{children}</div>
}

function ReceiptSummary({ receipts }) {
  if (!receipts.length) return <div style={{ color: '#f59e0b', fontSize: 13, paddingTop: 4 }}>The goods have not yet been received.</div>
  return <div style={{ display: 'grid', gap: 8 }}>{receipts.map((r, i) => (
    <div key={r?.recId ?? r?.id ?? i} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '9px 11px', fontSize: 12, lineHeight: 1.55, background: '#fff' }}>
      <div><b>Receipt Number:</b> {clean(r?.productReciept) || '—'}</div>
      <div><b>PO Number:</b> {clean(r?.po) || '—'}</div>
      <div><b>Received Date:</b> {fmtDate(r?.createdAt)}</div>
      <div style={{ color: '#16a34a' }}><b>Status:</b> Received</div>
    </div>
  ))}</div>
}

function TimelineCard({ details, receipts }) {
  const prFlow = arr(details?.pr_workflow)
  const poSteps = arr(details?.po_workflow).flatMap((g) => arr(g?.Workflow))
  return (
    <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, boxShadow: '0 2px 12px rgba(15,23,42,.05)', overflow: 'hidden' }}>
      <div style={{ minHeight: 50, borderBottom: '1px solid #e5e7eb', padding: '0 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14 }}>Request Timeline</strong><span style={{ fontSize: 13 }}>{clean(details?.total_pr_workflow_time) || ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr 1.15fr', gap: 44, padding: '22px 52px 26px' }}>
        <div><h3 style={{ margin: '0 0 12px', fontSize: 14 }}>PR Workflow</h3>{prFlow.length ? prFlow.map((s, i) => <WorkflowStep key={s?.RecId ?? i} step={s} />) : <EmptyText>No PR Workflow data available.</EmptyText>}</div>
        <div><h3 style={{ margin: '0 0 12px', fontSize: 14 }}>PO Workflow</h3>{poSteps.length ? poSteps.map((s, i) => <WorkflowStep key={s?.RecId ?? i} step={s} />) : <div style={{ color: '#f59e0b', fontSize: 13, paddingTop: 4 }}>No PO Workflow data available.</div>}</div>
        <div><h3 style={{ margin: '0 0 12px', fontSize: 14 }}>Goods Receiving</h3><ReceiptSummary receipts={receipts} /></div>
      </div>
    </section>
  )
}

function SectionCard({ title, children, dot = '#f59e0b', note = '' }) {
  return (
    <div style={{ position: 'relative', marginTop: 18 }}>
      <span style={{ position: 'absolute', left: -27, top: 10, width: 9, height: 9, borderRadius: 999, background: '#fff', border: `3px solid ${dot}`, zIndex: 2 }} />
      <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, boxShadow: '0 2px 12px rgba(15,23,42,.045)', overflow: 'hidden' }}>
        <div style={{ minHeight: 50, borderBottom: '1px solid #e5e7eb', padding: '0 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <strong style={{ fontSize: 14 }}>{title}</strong>{note && <span style={{ fontSize: 11, color: '#64748b' }}>{note}</span>}
        </div>
        <div style={{ padding: '0 18px' }}>{children}</div>
      </section>
    </div>
  )
}

function DataTable({ columns, rows }) {
  const data = arr(rows)
  if (!data.length) return null
  return (
    <div style={{ overflowX: 'auto', padding: '12px 0 18px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{columns.map((c) => <th key={c.key} style={{ textAlign: c.align || 'left', color: '#7c8595', padding: '9px 10px', borderBottom: '1px solid #e5e7eb', background: '#f1f5f9', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.03em', whiteSpace: 'nowrap' }}>{c.label}</th>)}</tr></thead>
        <tbody>{data.map((row, i) => <tr key={i}>{columns.map((c) => <td key={c.key} style={{ padding: '10px', borderBottom: '1px solid #f1f5f9', color: '#334155', verticalAlign: 'top', textAlign: c.align || 'left' }}>{c.render ? c.render(row[c.key], row) : (clean(row[c.key]) || '—')}</td>)}</tr>)}</tbody>
      </table>
    </div>
  )
}

function Stat({ label, value, note, color = '#0f172a' }) {
  return <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', background: '#fff' }}><div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', color: '#64748b' }}>{label}</div><div style={{ marginTop: 5, fontSize: 18, fontWeight: 800, color }}>{value}</div>{note && <div style={{ marginTop: 3, fontSize: 10, color: '#94a3b8' }}>{note}</div>}</div>
}

export default function PrDetailOverlayComplete() {
  const [prNo, setPrNo] = useState('')
  const [header, setHeader] = useState(null)
  const [details, setDetails] = useState(null)
  const [prItems, setPrItems] = useState([])
  const [excelItems, setExcelItems] = useState([])
  const [excelBatch, setExcelBatch] = useState(null)
  const [excelError, setExcelError] = useState('')
  const [prItemSyncError, setPrItemSyncError] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const handler = (event) => {
      const target = event.target instanceof Element ? event.target : null
      const row = target?.closest('tbody tr')
      const table = row?.closest('table')
      if (!row || !table) return
      const heads = [...table.querySelectorAll('thead th')].map((x) => lower(x.textContent))
      const prIndex = heads.findIndex((x) => x === 'pr number' || x === 'pr no.' || x === 'pr no')
      if (prIndex < 0) return
      const cells = [...row.querySelectorAll(':scope > td')]
      const value = clean(cells[prIndex]?.textContent).replace(/\s+/g, '').toUpperCase()
      if (!/^PR\d+(?:-\d+)?$/.test(value)) return
      event.preventDefault()
      setPrNo(value)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [])

  useEffect(() => {
    if (!prNo) return
    let active = true
    setLoading(true); setError(''); setHeader(null); setDetails(null); setPrItems([]); setPrItemSyncError(''); setExcelItems([]); setExcelBatch(null); setExcelError('')
    Promise.all([
      supabase.from('erp_pr_headers').select('*').eq('purch_req_id', prNo).maybeSingle(),
      supabase.from('erp_pr_details').select('*').eq('purch_req_id', prNo).maybeSingle(),
      supabase.from('erp_pr_line_items').select('purch_req_id,line_key,item_code,item_name,line_description,requested_qty,unit_price,line_amount,currency_code,line_status,synced_at').eq('purch_req_id', prNo).order('line_key'),
      supabase.from('erp_po_excel_batches').select('id,source_file,completed_at').eq('status','complete').order('completed_at', { ascending: false }).limit(1).maybeSingle(),
    ]).then(async ([h, d, items, excel]) => {
      if (!active) return
      const failure = h.error || d.error
      if (failure) { setError(failure.message || 'Could not load PR details.'); setLoading(false); return }
      setHeader(h.data || null)
      setDetails(d.data || null)
      if (items.error) {
        setPrItemSyncError(items.error.message || 'Could not retrieve synchronized PR items.')
        setPrItems([])
      } else {
        setPrItemSyncError('')
        setPrItems(items.data || [])
      }
      if (excel.error) setExcelError(excel.error.message || 'Excel mapping unavailable.')
      else if (excel.data) {
        setExcelBatch(excel.data)
        const mapped = await supabase.from('erp_po_excel_rows')
          .select('source_row,pr_no,po_no,item_code,item_description,source_qty,received_qty,balance_qty,excel_received_date,unit,supplier,excel_delivery_status,excel_po_status')
          .eq('batch_id', excel.data.id).eq('pr_no', prNo).order('source_row').limit(1000)
        if (!active) return
        if (mapped.error) setExcelError(mapped.error.message || 'Could not load Excel PO-to-item mapping.')
        else setExcelItems(mapped.data || [])
      }
      setLoading(false)
    }).catch((e) => { if (active) { setLoading(false); setError(e?.message || 'Could not load PR.') } })
    return () => { active = false }
  }, [prNo, retry])

  useEffect(() => {
    if (!prNo) return
    const fn = (e) => { if (e.key === 'Escape') setPrNo('') }
    document.addEventListener('keydown', fn)
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', fn); document.body.style.overflow = old }
  }, [prNo])

  const rfqs = useMemo(() => arr(details?.rfqs), [details])
  const pos = useMemo(() => arr(details?.purchase_orders), [details])
  const receipts = useMemo(() => arr(details?.product_receipts), [details])
  const itemRows = useMemo(() => prItems.map(row => ({
    ...row,
    _requested: row.requested_qty == null ? null : Number(row.requested_qty),
    _description: clean(row.line_description || row.item_name) || '—',
    _unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    _lineAmount: row.line_amount == null ? null : Number(row.line_amount),
  })), [prItems])

  const itemSummary = useMemo(() => {
    const requested = itemRows.reduce((total, row) =>
      total + (Number.isFinite(row._requested) ? row._requested : 0), 0)
    const currencyCodes = [...new Set(itemRows.map(row => clean(row.currency_code)).filter(Boolean))]
    const receiptEvents = arr(details?.product_receipts).length
    const check = prItemSyncError
      ? 'Sync read failed'
      : itemRows.length
        ? 'Simplix PR lines available'
        : 'No synced PR lines'
    const receiptStatus = receiptEvents > 0
      ? receiptEvents + (receiptEvents === 1 ? ' Simplix PO receipt' : ' Simplix PO receipts')
      : 'No Simplix receipt event'
    return { requested, check, receiptStatus, currencyCodes }
  }, [itemRows, details, prItemSyncError])

  const mappedRows = useMemo(() => {
    const lineCodes = new Set(prItems.map(item => clean(item.item_code).toUpperCase()).filter(Boolean))
    const keyCounts = new Map()
    excelItems.forEach(row => {
      if (!row.po_no || !row.pr_no) return
      const key = [row.pr_no, row.po_no, row.item_code].map(v => clean(v).toUpperCase()).join('|')
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1)
    })
    const poRefs = new Set(pos.map(po => clean(po.PurchId).toUpperCase()).filter(Boolean))
    const receiptPos = new Set(receipts.map(receipt => clean(receipt.po).toUpperCase()).filter(Boolean))
    return excelItems.map(row => {
      const key = [row.pr_no, row.po_no, row.item_code].map(v => clean(v).toUpperCase()).join('|')
      const flags = []
      if (!row.po_no) flags.push('PO not mapped')
      if (row.po_no && !poRefs.has(clean(row.po_no).toUpperCase())) flags.push('PO not in Simplix PR detail')
      if (!lineCodes.has(clean(row.item_code).toUpperCase())) flags.push('Item not in Simplix PR lines')
      if ((keyCounts.get(key) || 0) > 1) flags.push('Repeated PR/PO/item: review rows')
      const simplixReceipt = Boolean(row.po_no && receiptPos.has(clean(row.po_no).toUpperCase()))
      if (row.received_qty != null && row.source_qty != null && Number(row.received_qty) > Number(row.source_qty)) flags.push('Received exceeds Excel tracked qty')
      const position = excelItemReceiptPosition(row)
      if (position.conflict) flags.push('Excel Received All conflicts with quantities')
      return { ...row, _flags: flags, _description: clean(row.item_description) || '—', _receiptStatus: position.status, _receiptKind: position.kind, _received: position.received, _balance: position.balance, _simplixReceipt: simplixReceipt ? 'Receipt recorded' : 'No receipt event' }
    })
  }, [excelItems, prItems, pos, receipts])

  const excelSummary = useMemo(() => summarizeExcelReceiptPositions(excelItems), [excelItems])
  const excelReceiptLabel = excelBatch && excelSummary.total
    ? `${excelSummary.full} fully received · ${excelSummary.partial} partial · ${excelSummary.pending} pending · ${excelSummary.cancelled} cancelled${excelSummary.review || excelSummary.unknown ? ' · ' + (excelSummary.review + excelSummary.unknown) + ' to review' : ''}`
    : itemSummary.receiptStatus

  if (!prNo) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#f8fafc', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, height: 60, background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px 0 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <button onClick={() => setPrNo('')} aria-label="Close" style={{ border: 0, background: 'transparent', fontSize: 25, lineHeight: 1, color: '#7c8595', cursor: 'pointer', padding: 0 }}>×</button>
          <div style={{ minWidth: 0 }}><div style={{ fontSize: 14, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prNo} : {header?.description || 'Loading...'}</div><div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{header?.created_by || '—'}</div></div>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>{header?.created_at_raw || (header?.created_at ? fmtDate(header.created_at) : '')}</div>
      </div>

      <div style={{ position: 'relative', maxWidth: 1720, margin: '0 auto', padding: '24px 22px 42px 36px' }}>
        <div style={{ position: 'absolute', left: 16, top: 31, bottom: 50, width: 1, background: '#e5e7eb' }} />
        <span style={{ position: 'absolute', left: 12, top: 31, width: 9, height: 9, borderRadius: 999, background: '#fff', border: '3px solid #57b833', zIndex: 2 }} />
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading PR details…</div> : error ? <div style={{ padding: 18, borderRadius: 12, background: '#fee2e2', color: '#b91c1c' }}>{error} <button onClick={() => setRetry(value => value + 1)}>Retry</button></div> : !header ? <div style={{ padding: 18, border: '1px dashed #cbd5e1', borderRadius: 12, color: '#64748b' }}>This PR is not available in the Simplix header sync.</div> : <>
          <TimelineCard details={details} receipts={receipts} />

          <SectionCard title="Procurement Snapshot" dot="#0f172a" note="PR lines: Simplix · item receipts: Excel tracker · receipt events: Simplix">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 10, padding: '14px 0 16px' }}>
              <Stat label="ITEM LINES" value={itemRows.length.toLocaleString()} />
              <Stat label="REQUESTED QTY" value={itemRows.length ? itemSummary.requested.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'} note="Total across PR lines; units may differ" />
              <Stat label="FULLY RECEIVED" value={excelBatch && excelSummary.total ? excelSummary.full + ' / ' + excelSummary.total : '—'} note="Excel-confirmed item rows" color="#166534" />
              <Stat label="ACTIVE OUTSTANDING" value={excelBatch && excelSummary.total ? excelSummary.activeOutstanding.toLocaleString() + ' lines' : '—'} note="Cancelled lines excluded; not quantity sum" />
              <Stat label="RECEIPT POSITION" value={excelReceiptLabel} note={excelBatch && excelSummary.total ? itemSummary.receiptStatus : 'Awaiting Excel item mapping'} />
              <Stat label="DATA CHECK" value={itemSummary.check} color={prItemSyncError ? '#b91c1c' : itemRows.length ? '#166534' : '#64748b'} />
            </div>
          </SectionCard>

          <SectionCard title="PR Items" dot="#3b82f6" note="From synchronized production Simplix PR lines">
            {prItemSyncError
              ? <div style={{ padding: '16px 2px', fontSize: 13, color: '#b91c1c' }}>
                  Could not load synchronized PR items: {prItemSyncError}
                  {' '}<button onClick={() => setRetry(value => value + 1)}>Retry</button>
                </div>
              : !itemRows.length
                ? <EmptyText>No synchronized Simplix PR item lines are currently available for this PR.</EmptyText>
                : <DataTable rows={itemRows} columns={[
                    { key: 'item_code', label: 'Item ID', render: v => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{clean(v) || '—'}</span> },
                    { key: '_description', label: 'Item Description' },
                    { key: '_requested', label: 'Requested Qty', align: 'right', render: v => v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 3 }) },
                    { key: '_unitPrice', label: 'PR Unit Price', align: 'right', render: v => v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
                    { key: '_lineAmount', label: 'PR Line Amount', align: 'right', render: v => v == null ? '—' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
                    { key: 'currency_code', label: 'Currency' },
                    { key: 'line_status', label: 'PR Line Status' },
                    { key: 'synced_at', label: 'Last Synced', render: fmtDate },
                  ]} />}
            {!!itemRows.length && <div style={{ padding: '0 0 15px', fontSize: 11, color: '#64748b' }}>
              Values above describe requisition lines only. They do not establish the actual PO receipt quantities or goods received value.
            </div>}
          </SectionCard>

          <SectionCard title="Excel PO-to-Item Mapping" dot="#0ea5e9" note={excelBatch ? 'Excel: ' + excelBatch.source_file + ' · ' + fmtDate(excelBatch.completed_at) : 'Excel mapping is separate from Simplix'}>
            {excelError ? <div style={{ padding: '14px 0', color: '#b91c1c', fontSize: 12 }}>Could not read Excel mappings: {excelError}</div>
              : !excelBatch ? <EmptyText>No completed PR/PO Excel mapping upload yet. Upload the workbook from the PR & PO Tracker page.</EmptyText>
              : !mappedRows.length ? <EmptyText>This PR has no item rows in the currently imported Excel workbook.</EmptyText>
              : <DataTable rows={mappedRows} columns={[
                  { key: 'source_row', label: 'Excel Row' },
                  { key: 'item_code', label: 'Item ID', render: v => <strong style={{ fontFamily: 'monospace' }}>{v}</strong> },
                  { key: '_description', label: 'Item Description' },
                  { key: 'po_no', label: 'Mapped PO', render: v => v || <span style={{ color: '#b45309' }}>Not mapped</span> },
                  { key: 'source_qty', label: 'Excel Tracked Qty', align: 'right', render: v => v == null ? '—' : Number(v).toLocaleString() },
                  { key: '_receiptStatus', label: 'Item Receipt Status', render: (v,row) => <strong style={{ color: row._receiptKind === 'full' ? '#166534' : row._receiptKind === 'cancelled' ? '#64748b' : row._receiptKind === 'review' ? '#b91c1c' : '#92400e' }}>{v}</strong> },
                  { key: '_received', label: 'Excel Received Qty', align: 'right', render: v => v == null ? '—' : Number(v).toLocaleString() },
                  { key: '_balance', label: 'Excel Balance Qty', align: 'right', render: v => v == null ? '—' : Number(v).toLocaleString() },
                  { key: 'excel_received_date', label: 'Excel Received Date', render: v => clean(v) || '—' },
                  { key: '_simplixReceipt', label: 'Simplix PO Receipt' },
                  { key: 'unit', label: 'Unit' },
                  { key: 'excel_po_status', label: 'Excel PO Status' },
                  { key: '_flags', label: 'Reconciliation', render: flags => flags.length ? <span style={{ color: '#92400e', lineHeight: 1.5 }}>{flags.join(' · ')}</span> : <span style={{ color: '#166534' }}>Item and PO match Simplix</span> },
                ]} />}
            {mappedRows.length > 0 && <div style={{ padding: '0 0 15px', fontSize: 11, color: '#64748b' }}>
              Received All, Received Qty and Balance Qty in the Excel tracker confirm item-level receipt positions. Excel Received Date is displayed as a separate tracker field; Simplix receipt events and their official dates/references remain in the Goods Receiving section. Repeated PR/PO/item rows are not automatically summed.
            </div>}
          </SectionCard>

          <SectionCard title="Requests for Quotation">
            {!rfqs.length ? <EmptyText>No RFQs have been generated for this request at this time.</EmptyText> : <DataTable rows={rfqs} columns={[
              { key: 'rfqId', label: 'RFQ' }, { key: 'title', label: 'Quotation' }, { key: 'status', label: 'Status' }, { key: 'expiration', label: 'Expiration', render: fmtDate }, { key: 'deliveryDate', label: 'Delivery Date', render: fmtDate },
            ]} />}
          </SectionCard>

          <SectionCard title="Purchase Orders">
            {!pos.length ? <EmptyText>No purchase orders have been created for this request at this time.</EmptyText> : <DataTable rows={pos} columns={[
              { key: 'PurchId', label: 'PO' }, { key: 'PurchStatus', label: 'Status', render: (v) => <span style={{ fontWeight: 700 }}>{clean(v) || '—'}</span> }, { key: 'RFQNumber', label: 'RFQ Number' }, { key: 'PurchName', label: 'Vendor' }, { key: 'VendorAccount', label: 'Vendor Account' }, { key: 'InventSiteId', label: 'Site' }, { key: 'InventLocationId', label: 'Location' }, { key: 'PendingApprovers', label: 'Pending Approver', render: (v) => Array.isArray(v) ? (v.length ? v.join(', ') : 'No pending approvers') : (clean(v) || 'No pending approvers') },
            ]} />}
          </SectionCard>

          <SectionCard title="Goods Receiving">
            {!receipts.length ? <EmptyText>No product receipts are currently available.</EmptyText> : <DataTable rows={receipts} columns={[
              { key: 'po', label: 'Purchase Order' }, { key: 'productReciept', label: 'Product Receipt' }, { key: 'createdAt', label: 'Created At', render: fmtDate }, { key: 'recId', label: 'Record ID' }, { key: '_status', label: 'Status', render: () => <span style={{ color: '#16a34a', fontWeight: 700 }}>Received</span> },
            ]} />}
          </SectionCard>
        </>}
      </div>
    </div>
  )
}
