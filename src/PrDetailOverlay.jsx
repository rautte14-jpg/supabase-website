import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import './pr-detail-overlay.css'

const clean = (value) => String(value ?? '').trim()
const lower = (value) => clean(value).toLowerCase()

function statusClass(value) {
  const text = lower(value)
  if (!text) return 'neutral'
  if (['approved', 'complete', 'completed', 'received', 'closed', 'delivered'].some((x) => text.includes(x))) return 'good'
  if (['pending', 'review', 'waiting', 'in progress', 'processing'].some((x) => text.includes(x))) return 'warn'
  if (['rejected', 'cancelled', 'canceled', 'failed'].some((x) => text.includes(x))) return 'bad'
  return 'neutral'
}

function Pill({ value }) {
  return <span className={'prd-pill ' + statusClass(value)}>{clean(value) || '—'}</span>
}

function Empty({ children = 'No data synced yet.' }) {
  return <div className="prd-empty">{children}</div>
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return clean(value) || '—'
  return date.toLocaleString()
}

function SummaryCard({ label, value, pill = false }) {
  return (
    <div className="prd-summary-card">
      <span>{label}</span>
      {pill ? <Pill value={value} /> : <strong>{clean(value) || '—'}</strong>}
    </div>
  )
}

function Workflow({ title, steps = [] }) {
  return (
    <section className="prd-section">
      <div className="prd-section-head">
        <div>
          <span className="prd-eyebrow">WORKFLOW</span>
          <h3>{title}</h3>
        </div>
        <strong>{steps.length} step{steps.length === 1 ? '' : 's'}</strong>
      </div>
      {!steps.length ? <Empty /> : (
        <div className="prd-timeline">
          {steps.map((step, index) => (
            <div className="prd-step" key={step.RecId ?? index}>
              <div className="prd-step-dot" />
              <div className="prd-step-body">
                <div className="prd-step-top">
                  <div>
                    <strong>{clean(step.UserName) || 'Unknown user'}</strong>
                    <span>{clean(step.Position) || '—'}</span>
                  </div>
                  <Pill value={step.Status} />
                </div>
                <div className="prd-step-meta">
                  <span>{step.ApprovedDateTime || step.ApprovedDate || 'No approval date yet'}</span>
                  {(step.daysBetween != null || step.hoursBetween != null) && (
                    <span>{step.daysBetween ?? 0}d {step.hoursBetween ?? 0}h</span>
                  )}
                </div>
                {clean(step.Comment) && <p>{step.Comment}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function PrDetailOverlay() {
  const [prNo, setPrNo] = useState('')
  const [header, setHeader] = useState(null)
  const [details, setDetails] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    function handleClick(event) {
      const cell = event.target.closest('td')
      if (!cell) return
      const value = clean(cell.textContent)
      if (!/^PR\d+$/i.test(value)) return

      const table = cell.closest('table')
      if (!table) return
      const headerText = lower(table.querySelector('thead')?.textContent)
      if (!headerText.includes('pr number') && !headerText.includes('pr no')) return

      event.preventDefault()
      setPrNo(value.toUpperCase())
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  useEffect(() => {
    if (!prNo) return
    let active = true

    async function load() {
      setLoading(true)
      setError('')
      setHeader(null)
      setDetails(null)

      const [headerResult, detailResult] = await Promise.all([
        supabase.from('erp_pr_headers').select('*').eq('purch_req_id', prNo).maybeSingle(),
        supabase.from('erp_pr_details').select('*').eq('purch_req_id', prNo).maybeSingle(),
      ])

      if (!active) return
      setLoading(false)

      if (headerResult.error) {
        setError(headerResult.error.message || 'Could not load PR details.')
        return
      }

      setHeader(headerResult.data || null)
      setDetails(detailResult.data || null)
    }

    load()
    return () => { active = false }
  }, [prNo])

  useEffect(() => {
    if (!prNo) return
    const onKey = (event) => {
      if (event.key === 'Escape') setPrNo('')
    }
    document.addEventListener('keydown', onKey)
    document.body.classList.add('prd-modal-open')
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.classList.remove('prd-modal-open')
    }
  }, [prNo])

  const poRows = useMemo(() => Array.isArray(details?.purchase_orders) ? details.purchase_orders : [], [details])
  const rfqs = useMemo(() => Array.isArray(details?.rfqs) ? details.rfqs : [], [details])
  const receipts = useMemo(() => Array.isArray(details?.product_receipts) ? details.product_receipts : [], [details])
  const prWorkflow = useMemo(() => Array.isArray(details?.pr_workflow) ? details.pr_workflow : [], [details])
  const poWorkflow = useMemo(() => Array.isArray(details?.po_workflow) ? details.po_workflow : [], [details])
  const fixedAssets = useMemo(() => Array.isArray(details?.fixed_assets) ? details.fixed_assets : [], [details])

  if (!prNo) return null

  return (
    <div className="prd-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setPrNo('')}>
      <section className="prd-panel" role="dialog" aria-modal="true" aria-label={'Purchase request ' + prNo}>
        <header className="prd-header">
          <div>
            <span className="prd-eyebrow">PURCHASE REQUEST</span>
            <h2>{prNo}</h2>
            <p>{header?.description || 'Loading purchase request details…'}</p>
          </div>
          <button className="prd-close" onClick={() => setPrNo('')} aria-label="Close">×</button>
        </header>

        {loading ? (
          <div className="prd-loading">Loading synced Simplix data…</div>
        ) : error ? (
          <div className="prd-error">{error}</div>
        ) : !header ? (
          <Empty>This PR is not available in the Simplix sync yet.</Empty>
        ) : (
          <div className="prd-content">
            <div className="prd-summary-grid">
              <SummaryCard label="ERP Status" value={header.status} pill />
              <SummaryCard label="Current Approver" value={details?.current_approver} />
              <SummaryCard label="Position" value={details?.current_position} />
              <SummaryCard label="Workflow Status" value={details?.current_workflow_status} pill />
              <SummaryCard label="Created By" value={header.created_by} />
              <SummaryCard label="Submitted" value={header.created_at_raw || formatDate(header.created_at)} />
              <SummaryCard label="RFQs" value={details?.rfq_count ?? rfqs.length} />
              <SummaryCard label="Purchase Orders" value={details?.po_count ?? poRows.length} />
              <SummaryCard label="Receipts" value={details?.receipt_count ?? receipts.length} />
              <SummaryCard label="Last Detail Sync" value={details?.detail_synced_at ? formatDate(details.detail_synced_at) : 'Not synced yet'} />
            </div>

            {!details && (
              <div className="prd-sync-note">
                Header data is available, but detailed workflow data has not reached this PR yet. Keep the semi-automatic sync running and it will be populated progressively.
              </div>
            )}

            <Workflow title="PR Workflow" steps={prWorkflow} />

            <section className="prd-section">
              <div className="prd-section-head"><div><span className="prd-eyebrow">PROCUREMENT</span><h3>Requests for Quotation</h3></div><strong>{rfqs.length}</strong></div>
              {!rfqs.length ? <Empty>No RFQ linked to this PR.</Empty> : (
                <div className="prd-table-wrap"><table><thead><tr><th>RFQ</th><th>Title</th><th>Status</th><th>Expiration</th><th>Delivery Date</th></tr></thead><tbody>
                  {rfqs.map((row, index) => <tr key={row.recId ?? row.id ?? index}><td>{row.rfqId || '—'}</td><td>{row.title || '—'}</td><td><Pill value={row.status} /></td><td>{row.expiration || '—'}</td><td>{row.deliveryDate || '—'}</td></tr>)}
                </tbody></table></div>
              )}
            </section>

            <section className="prd-section">
              <div className="prd-section-head"><div><span className="prd-eyebrow">PROCUREMENT</span><h3>Purchase Orders</h3></div><strong>{poRows.length}</strong></div>
              {!poRows.length ? <Empty>No purchase order linked to this PR.</Empty> : (
                <div className="prd-table-wrap"><table><thead><tr><th>PO</th><th>Name</th><th>Status</th><th>Vendor</th><th>RFQ</th><th>Pending Approvers</th><th>Warehouse</th></tr></thead><tbody>
                  {poRows.map((row, index) => <tr key={row.PurchId ?? index}><td>{row.PurchId || '—'}</td><td>{row.PurchName || '—'}</td><td><Pill value={row.PurchStatus} /></td><td>{row.VendorAccount || '—'}</td><td>{row.RFQNumber || '—'}</td><td>{Array.isArray(row.PendingApprovers) ? row.PendingApprovers.join(', ') : row.PendingApprovers || '—'}</td><td>{row.InventLocationId || row.InventSiteId || '—'}</td></tr>)}
                </tbody></table></div>
              )}
            </section>

            {poWorkflow.map((group, index) => (
              <Workflow key={group.PurchId ?? index} title={'PO Workflow · ' + (group.PurchId || 'PO')} steps={group.Workflow || []} />
            ))}

            <section className="prd-section">
              <div className="prd-section-head"><div><span className="prd-eyebrow">GOODS RECEIVING</span><h3>Product Receipts</h3></div><strong>{receipts.length}</strong></div>
              {!receipts.length ? <Empty>No product receipt synced for this PR.</Empty> : (
                <div className="prd-table-wrap"><table><thead><tr><th>PO</th><th>Product Receipt</th><th>Created</th><th>Record ID</th></tr></thead><tbody>
                  {receipts.map((row, index) => <tr key={row.recId ?? row.id ?? index}><td>{row.po || '—'}</td><td>{row.productReciept || '—'}</td><td>{row.createdAt || '—'}</td><td>{row.recId || '—'}</td></tr>)}
                </tbody></table></div>
              )}
            </section>

            {fixedAssets.length > 0 && (
              <section className="prd-section">
                <div className="prd-section-head"><div><span className="prd-eyebrow">FIXED ASSET</span><h3>Asset Information</h3></div><strong>{fixedAssets.length}</strong></div>
                <div className="prd-table-wrap"><table><thead><tr><th>Item</th><th>Name</th><th>Fixed Asset</th><th>Acquired</th><th>Reason / Justification</th></tr></thead><tbody>
                  {fixedAssets.map((row, index) => <tr key={row.ItemId ?? index}><td>{row.ItemId || '—'}</td><td>{row.Name || '—'}</td><td>{String(row.IsFixedAsset ?? '—')}</td><td>{String(row.IsAssetAcquired ?? '—')}</td><td>{row.BusinessJustification || row.Reason || '—'}</td></tr>)}
                </tbody></table></div>
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

export default PrDetailOverlay
