import { excelItemReceiptPosition } from './excelReceiptPosition.js'

const clean = value => String(value ?? '').trim()
const lower = value => clean(value).toLowerCase()

export function statusGroup(status) {
  const text = lower(status).replace(/[\s_-]+/g, ' ')
  if (text.includes('reject')) return 'REJECTED'
  if (text.includes('cancel')) return 'CANCELLED'
  if (['closed', 'complete', 'completed'].includes(text)) return 'CLOSED'
  if (['approved', 'approval completed'].includes(text)) return 'APPROVED'
  if (['in review', 'inreview', 'pending', 'pending approval', 'in approval', 'submitted'].includes(text)) return 'IN_REVIEW'
  if (['draft', 'created', 'not submitted'].includes(text)) return 'DRAFT'
  return 'OTHER'
}

export function currentHolder(detail, stage, status) {
  if (!detail) return '—'
  if (stage === 'PO Stage') {
    const names = (Array.isArray(detail.purchase_orders) ? detail.purchase_orders : [])
      .flatMap(po => Array.isArray(po.PendingApprovers) ? po.PendingApprovers : clean(po.PendingApprovers) ? [po.PendingApprovers] : [])
      .map(clean).filter(Boolean)
    return [...new Set(names)].join(', ') || '—'
  }
  if (stage !== 'PR Approval' || statusGroup(status) !== 'IN_REVIEW') return '—'
  if (/complete|closed|approved|cancel|reject/i.test(clean(detail.current_workflow_status))) return '—'
  return clean(detail.current_approver) || '—'
}

export function summarizeTrackerLines(rows = []) {
  const active = rows.filter(row => excelItemReceiptPosition(row).kind !== 'cancelled')
  const positions = active.map(excelItemReceiptPosition)
  const poNos = new Set(active.map(row => clean(row.po_no).toUpperCase()).filter(Boolean))
  const review = positions.some(p => p.kind === 'review')
  const full = positions.length > 0 && positions.every(p => p.kind === 'full')
  const anyReceived = positions.some(p => p.received > 0 || p.kind === 'full')
  const known = positions.length > 0 && positions.every(p => p.kind !== 'unknown')
  const stage = review ? 'Receipt Needs Review' : full ? 'Fully Received' : anyReceived ? 'Part Received' : null
  const receipt = !rows.length ? 'No tracker items' : !active.length ? 'Cancelled items only' : review ? 'Review tracker discrepancy' : full ? 'Fully Received' : anyReceived ? 'Part Received' : known ? 'Not Received' : 'Receipt status unknown'
  return { poNos, stage, receipt, review, full, anyReceived, hasLines:rows.length > 0, activeLines:active.length }
}

export function lifecycleMatches(detail, status, filter, tracker = summarizeTrackerLines()) {
  if (filter === 'ALL') return true
  if (filter === 'SYNC_PENDING') return !detail
  const group = statusGroup(status)
  if (['CANCELLED','REJECTED'].includes(group)) return false
  const rfq = Number(detail?.rfq_count || 0)
  const po = Number(detail?.po_count || 0) > 0 || tracker.poNos.size > 0
  const receipt = Number(detail?.receipt_count || 0) > 0 || tracker.anyReceived
  if (filter === 'PR_APPROVAL') return group === 'IN_REVIEW' && !po && rfq === 0 && !receipt
  if (filter === 'NO_RFQ') return group === 'APPROVED' && rfq === 0 && !po
  if (filter === 'HAS_RFQ') return rfq > 0
  if (filter === 'NO_PO') return rfq > 0 && !po
  if (filter === 'HAS_PO') return po
  if (filter === 'NO_RECEIPT') return po && !receipt && tracker.activeLines > 0 && tracker.receipt === 'Not Received'
  if (filter === 'RECEIVED') return receipt
  if (filter === 'PENDING_APPROVER') return currentHolder(detail, po ? 'PO Stage' : rfq ? 'RFQ Stage' : 'PR Approval', status) !== '—'
  return false
}
