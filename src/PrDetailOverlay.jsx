import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const arr = (v) => Array.isArray(v) ? v : []

const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.valueOf()) ? clean(v) || '—' : d.toLocaleString()
}

function tone(status) {
  const s = clean(status).toLowerCase()
  if (/approved|complete|completed|received|closed|delivered/.test(s)) return 'good'
  if (/reject|cancel|fail/.test(s)) return 'bad'
  if (/pending|review|progress|processing|waiting/.test(s)) return 'pending'
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
  return ''
}

function WorkflowStep({ step }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '36px 12px 1fr', alignItems: 'start', gap: 10, position: 'relative' }}>
      <div style={{ fontSize: 13, color: '#6b7280', paddingTop: 2, textAlign: 'right' }}>{elapsed(step)}</div>
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: statusColor(step?.Status), display: 'block' }} />
      </div>
      <div style={{ paddingBottom: 18 }}>
        <div style={{ fontSize: 13, lineHeight: 1.55, color: '#111827' }}>
          <div><span style={{ color: '#7c8595' }}>Approver:</span> <strong style={{ fontWeight: 500 }}>{clean(step?.UserName) || '—'}</strong></div>
          <div><span style={{ color: '#7c8595' }}>Status:</span> <span>{clean(step?.Status) || '—'}</span></div>
          <div><span style={{ color: '#7c8595' }}>Position:</span> <span>{clean(step?.Position) || '—'}</span></div>
          {(step?.ApprovedDateTime || step?.ApprovedDate) && <div><span style={{ color: '#7c8595' }}>Approved At:</span> <span>{step.ApprovedDateTime || step.ApprovedDate}</span></div>}
          {clean(step?.Comment) && <div style={{ marginTop: 4, color: '#64748b' }}>{step.Comment}</div>}
        </div>
      </div>
    </div>
  )
}

function EmptyText({ children }) {
  return <div style={{ fontSize: 13, color: '#8b95a5', padding: '18px 2px' }}>{children}</div>
}

function TimelineCard({ details, receipts }) {
  const prFlow = arr(details?.pr_workflow)
  const poGroups = arr(details?.po_workflow)
  const poSteps = poGroups.flatMap((g) => arr(g?.Workflow))
  const hasReceipts = receipts.length > 0

  return (
    <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, boxShadow: '0 2px 12px rgba(15,23,42,.05)', overflow: 'hidden' }}>
      <div style={{ minHeight: 50, borderBottom: '1px solid #e5e7eb', padding: '0 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <strong style={{ fontSize: 14, color: '#111827' }}>Request Timeline</strong>
        <span style={{ fontSize: 13, color: '#111827' }}>{clean(details?.total_pr_workflow_time) || ''}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr 1fr', gap: 52, padding: '22px 52px 26px' }}>
        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#111827' }}>PR Workflow</h3>
          {prFlow.length ? prFlow.map((s, i) => <WorkflowStep key={s?.RecId ?? i} step={s} />) : <EmptyText>No PR Workflow data available.</EmptyText>}
        </div>
        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#111827' }}>PO Workflow</h3>
          {poSteps.length ? poSteps.map((s, i) => <WorkflowStep key={s?.RecId ?? i} step={s} />) : <div style={{ color: '#f59e0b', fontSize: 13, paddingTop: 4 }}>No PO Workflow data available.</div>}
        </div>
        <div>
          <h3 style={{ margin: '0 0 12px', fontSize: 14, color: '#111827' }}>Goods Receiving</h3>
          {hasReceipts ? (
            <div style={{ fontSize: 13, lineHeight: 1.7, color: '#166534' }}>
              {receipts.length} product receipt{receipts.length === 1 ? '' : 's'} available.
            </div>
          ) : (
            <div style={{ color: '#f59e0b', fontSize: 13, paddingTop: 4 }}>The goods have not yet been received.</div>
          )}
        </div>
      </div>
    </section>
  )
}

function SectionCard({ title, children, dot = '#f59e0b' }) {
  return (
    <div style={{ position: 'relative', marginTop: 18 }}>
      <span style={{ position: 'absolute', left: -27, top: 10, width: 9, height: 9, borderRadius: 999, background: '#fff', border: `3px solid ${dot}`, zIndex: 2 }} />
      <section style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, boxShadow: '0 2px 12px rgba(15,23,42,.045)', overflow: 'hidden' }}>
        <div style={{ minHeight: 50, borderBottom: '1px solid #e5e7eb', padding: '0 22px', display: 'flex', alignItems: 'center' }}>
          <strong style={{ fontSize: 14, color: '#111827' }}>{title}</strong>
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
        <thead>
          <tr>{columns.map((c) => <th key={c.key} style={{ textAlign: 'left', color: '#7c8595', padding: '9px 10px', borderBottom: '1px solid #e5e7eb', fontSize: 11, fontWeight: 600 }}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key} style={{ padding: '10px', borderBottom: '1px solid #f1f5f9', color: '#334155', verticalAlign: 'top' }}>{c.render ? c.render(row[c.key], row) : (clean(row[c.key]) || '—')}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PrDetailOverlay() {
  const [prNo, setPrNo] = useState('')
  const [header, setHeader] = useState(null)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handler = (event) => {
      const target = event.target instanceof Element ? event.target : null
      if (!target) return
      const row = target.closest('tbody tr')
      if (!row) return
      const table = row.closest('table')
      if (!table) return
      const heads = [...table.querySelectorAll('thead th')].map((x) => clean(x.textContent).toLowerCase())
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
    setLoading(true)
    setError('')
    setHeader(null)
    setDetails(null)
    Promise.all([
      supabase.from('erp_pr_headers').select('*').eq('purch_req_id', prNo).maybeSingle(),
      supabase.from('erp_pr_details').select('*').eq('purch_req_id', prNo).maybeSingle(),
    ]).then(([h, d]) => {
      if (!active) return
      setLoading(false)
      if (h.error) {
        setError(h.error.message || 'Could not load PR.')
        return
      }
      setHeader(h.data || null)
      setDetails(d.data || null)
    }).catch((e) => {
      if (active) {
        setLoading(false)
        setError(e?.message || 'Could not load PR.')
      }
    })
    return () => { active = false }
  }, [prNo])

  useEffect(() => {
    if (!prNo) return
    const fn = (e) => { if (e.key === 'Escape') setPrNo('') }
    document.addEventListener('keydown', fn)
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', fn)
      document.body.style.overflow = old
    }
  }, [prNo])

  const rfqs = useMemo(() => arr(details?.rfqs), [details])
  const pos = useMemo(() => arr(details?.purchase_orders), [details])
  const receipts = useMemo(() => arr(details?.product_receipts), [details])

  if (!prNo) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#f8fafc', overflowY: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 10, height: 60, background: '#fff', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px 0 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <button onClick={() => setPrNo('')} aria-label="Close" style={{ border: 0, background: 'transparent', fontSize: 25, lineHeight: 1, color: '#7c8595', cursor: 'pointer', padding: 0 }}>×</button>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{prNo} : {header?.description || 'Loading...'}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 3 }}>{header?.created_by || '—'}</div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#6b7280' }}>{header?.created_at_raw || (header?.created_at ? fmtDate(header.created_at) : '')}</div>
      </div>

      <div style={{ position: 'relative', maxWidth: 1720, margin: '0 auto', padding: '24px 22px 42px 36px' }}>
        <div style={{ position: 'absolute', left: 16, top: 31, bottom: 50, width: 1, background: '#e5e7eb' }} />
        <span style={{ position: 'absolute', left: 12, top: 31, width: 9, height: 9, borderRadius: 999, background: '#fff', border: '3px solid #57b833', zIndex: 2 }} />

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Loading synced Simplix data…</div>
        ) : error ? (
          <div style={{ padding: 18, borderRadius: 12, background: '#fee2e2', color: '#b91c1c' }}>{error}</div>
        ) : !header ? (
          <div style={{ padding: 18, border: '1px dashed #cbd5e1', borderRadius: 12, color: '#64748b' }}>This PR is not available in the Simplix header sync.</div>
        ) : (
          <>
            <TimelineCard details={details} receipts={receipts} />

            <SectionCard title="Requests for Quotation">
              {!rfqs.length ? <EmptyText>No RFQs have been generated for this request at this time.</EmptyText> : (
                <DataTable rows={rfqs} columns={[
                  { key: 'rfqId', label: 'RFQ' },
                  { key: 'title', label: 'Title' },
                  { key: 'status', label: 'Status' },
                  { key: 'expiration', label: 'Expiration' },
                  { key: 'deliveryDate', label: 'Delivery Date' },
                ]} />
              )}
            </SectionCard>

            <SectionCard title="Purchase Orders">
              {!pos.length ? <EmptyText>No purchase orders have been created for this request at this time.</EmptyText> : (
                <DataTable rows={pos} columns={[
                  { key: 'PurchId', label: 'PO' },
                  { key: 'PurchName', label: 'Name' },
                  { key: 'PurchStatus', label: 'Status' },
                  { key: 'VendorAccount', label: 'Vendor' },
                  { key: 'RFQNumber', label: 'RFQ' },
                  { key: 'PendingApprovers', label: 'Pending Approvers', render: (v) => Array.isArray(v) ? v.join(', ') : (clean(v) || '—') },
                ]} />
              )}
            </SectionCard>

            <SectionCard title="Goods Receiving">
              {!receipts.length ? <EmptyText>No product receipts are currently available.</EmptyText> : (
                <DataTable rows={receipts} columns={[
                  { key: 'po', label: 'PO' },
                  { key: 'productReciept', label: 'Product Receipt' },
                  { key: 'createdAt', label: 'Created' },
                  { key: 'recId', label: 'Record ID' },
                ]} />
              )}
            </SectionCard>
          </>
        )}
      </div>
    </div>
  )
}
