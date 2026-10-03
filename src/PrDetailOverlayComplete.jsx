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

function rawField(row, names) {
  const raw = row?.raw_source
  if (!raw || typeof raw !== 'object') return ''
  const entries = Object.entries(raw)
  for (const name of names) {
    const wanted = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '')
    const hit = entries.find(([key]) => String(key).toLowerCase().replace(/[^a-z0-9]+/g, '') === wanted)
    if (hit && clean(hit[1])) return hit[1]
  }
  return ''
}

function numeric(value) {
  if (value === null || value === undefined || clean(value) === '') return null
  const n = Number(String(value).replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function requestedQty(row) {
  const direct = numeric(row?.qty_requested)
  if (direct !== null) return Math.max(0, direct)
  return Math.max(0, numeric(rawField(row, ['Requested Qty', 'Request Qty', 'Quantity', 'PR Qty'])) || 0)
}

function receivedQty(row) {
  const direct = numeric(row?.qty_received)
  if (direct !== null) return Math.max(0, direct)
  const raw = numeric(rawField(row, ['Received Qty', 'Received Quantity', 'Receipt Qty', 'PO Received Qty', 'Delivered Qty']))
  if (raw !== null) return Math.max(0, raw)
  const text = lower([row?.status, row?.delivery_status, rawField(row, ['PO ERP Status', 'Receipt Status'])].filter(Boolean).join(' '))
  if (/fully\s*receiv|completely\s*receiv|received|delivered/.test(text) && !/not\s*received|pending|partial|part\s*receiv/.test(text)) return requestedQty(row)
  return 0
}

function poNumber(row) {
  return clean(row?.po_no || rawField(row, ['PO Number', 'PO No', 'Purchase Order']))
}

function lineStatus(row) {
  const req = requestedQty(row)
  const rec = receivedQty(row)
  if (req > 0 && rec >= req) return 'Fully Received'
  if (rec > 0) return 'Part Received'
  return 'Not Received'
}

function tone(status) {
  const s = lower(status)
  if (/approved|complete|completed|received|closed|delivered|matched/.test(s)) return 'good'
  if (/reject|cancel|fail|needs review/.test(s)) return 'bad'
  if (/pending|review|progress|processing|waiting|part/.test(s)) return 'pending'
  return 'neutral'
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
      if (!/^PR\d+$/.test(value)) return
      event.preventDefault()
      setPrNo(value)
    }
    document.addEventListener('click', handler, true)
    return () => document.removeEventListener('click', handler, true)
  }, [])

  useEffect(() => {
    if (!prNo) return
    let active = true
    setLoading(true); setError(''); setHeader(null); setDetails(null); setPrItems([])
    Promise.all([
      supabase.from('erp_pr_headers').select('*').eq('purch_req_id', prNo).maybeSingle(),
      supabase.from('erp_pr_details').select('*').eq('purch_req_id', prNo).maybeSingle(),
      supabase.from('procurement_records').select('*').eq('source_type', 'PR').eq('pr_no', prNo),
    ]).then(([h, d, items]) => {
      if (!active) return
      setLoading(false)
      if (h.error) { setError(h.error.message || 'Could not load PR.'); return }
      setHeader(h.data || null); setDetails(d.data || null); setPrItems(items.error ? [] : (items.data || []))
    }).catch((e) => { if (active) { setLoading(false); setError(e?.message || 'Could not load PR.') } })
    return () => { active = false }
  }, [prNo])

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
  const itemRows = useMemo(() => prItems.map((row) => {
    const requested = requestedQty(row)
    const received = Math.min(requested || Number.MAX_SAFE_INTEGER, receivedQty(row))
    return { ...row, _requested: requested, _received: received, _balance: Math.max(0, requested - received), _lineStatus: lineStatus(row), _po: poNumber(row) }
  }), [prItems])
  const itemSummary = useMemo(() => {
    const requested = itemRows.reduce((s, r) => s + r._requested, 0)
    const received = itemRows.reduce((s, r) => s + r._received, 0)
    const balance = Math.max(0, requested - received)
    const poNos = new Set(itemRows.map((r) => r._po).filter(Boolean))
    const simplixPo = Number(details?.po_count || 0) > 0
    const simplixReceipt = Number(details?.receipt_count || 0) > 0
    const erpPo = poNos.size > 0
    const erpReceipt = received > 0
    let check = 'Matched'
    if (!itemRows.length) check = 'No ERP item lines'
    else if (simplixPo !== erpPo || simplixReceipt !== erpReceipt) check = 'Needs Review'
    const receiptStatus = requested > 0 && received >= requested ? 'Fully Received' : received > 0 ? 'Part Received' : 'Not Received'
    return { requested, received, balance, poNos, check, receiptStatus }
  }, [itemRows, details])

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
        {loading ? <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading PR details…</div> : error ? <div style={{ padding: 18, borderRadius: 12, background: '#fee2e2', color: '#b91c1c' }}>{error}</div> : !header ? <div style={{ padding: 18, border: '1px dashed #cbd5e1', borderRadius: 12, color: '#64748b' }}>This PR is not available in the Simplix header sync.</div> : <>
          <TimelineCard details={details} receipts={receipts} />

          <SectionCard title="Procurement Snapshot" dot="#0f172a" note="Simplix + uploaded ERP PR Lines">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, minmax(0,1fr))', gap: 10, padding: '14px 0 16px' }}>
              <Stat label="ITEM LINES" value={itemRows.length.toLocaleString()} />
              <Stat label="REQUESTED QTY" value={itemSummary.requested.toLocaleString(undefined, { maximumFractionDigits: 3 })} />
              <Stat label="RECEIVED QTY" value={itemSummary.received.toLocaleString(undefined, { maximumFractionDigits: 3 })} color="#166534" />
              <Stat label="BALANCE QTY" value={itemSummary.balance.toLocaleString(undefined, { maximumFractionDigits: 3 })} color={itemSummary.balance > 0 ? '#b45309' : '#166534'} />
              <Stat label="RECEIPT POSITION" value={itemSummary.receiptStatus} />
              <Stat label="DATA CHECK" value={itemSummary.check} color={itemSummary.check === 'Needs Review' ? '#b91c1c' : itemSummary.check === 'Matched' ? '#166534' : '#64748b'} />
            </div>
          </SectionCard>

          <SectionCard title="PR Items" dot="#3b82f6" note="From uploaded ERP PR Lines">
            {!itemRows.length ? <EmptyText>No item lines were found in the uploaded ERP PR Lines file for this PR.</EmptyText> : <DataTable rows={itemRows} columns={[
              { key: 'priority', label: 'Priority', render: (v) => <span style={{ fontWeight: 700 }}>{clean(v) || '—'}</span> },
              { key: 'item_code', label: 'Item ID', render: (v) => <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{clean(v) || '—'}</span> },
              { key: 'item_description', label: 'Item Description' },
              { key: '_requested', label: 'Requested', align: 'right', render: (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }) },
              { key: '_received', label: 'Received', align: 'right', render: (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }) },
              { key: '_balance', label: 'Balance', align: 'right', render: (v) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: 3 }) },
              { key: 'unit', label: 'UOM' },
              { key: '_po', label: 'PO' },
              { key: '_lineStatus', label: 'Receipt Status', render: (v) => <span style={{ fontWeight: 700, color: tone(v) === 'good' ? '#166534' : tone(v) === 'pending' ? '#92400e' : '#64748b' }}>{v}</span> },
            ]} />}
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
