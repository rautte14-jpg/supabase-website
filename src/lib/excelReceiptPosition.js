// Item-level receipt positions are confirmed by the uploaded PR/PO Excel
// tracker. Simplix receipt events are a separate ERP PO-level source.
const txt = value => String(value ?? '').trim().toLowerCase()
const num = value => value === null || value === undefined || value === '' ? null : Number(value)
const closeEnough = (a,b) => Math.abs(a-b) < 0.000001

export function excelItemReceiptPosition(row) {
  const delivery = txt(row.excel_delivery_status)
  const po = txt(row.excel_po_status)
  const cancelled = delivery.includes('cancel') || po.includes('cancel')
  const tracked = num(row.source_qty)
  const received = num(row.received_qty)
  const balance = num(row.balance_qty)
  const labeledFull = /received\s*all|fully\s*received|all\s*received/.test(delivery)
  const numericFull = tracked !== null && tracked > 0 && received !== null &&
    closeEnough(received, tracked) && (balance === null || closeEnough(balance, 0))
  const conflict = labeledFull && (
    (tracked !== null && received !== null && !closeEnough(received, tracked)) ||
    (balance !== null && !closeEnough(balance, 0))
  )
  if (cancelled) return { status: 'Cancelled', kind:'cancelled', received, balance, conflict:false }
  if (conflict) return { status:'Review Excel discrepancy',kind:'review',received,balance,conflict:true }
  if (labeledFull || numericFull) return {
    status:'Fully Received',kind:'full',
    received:received === null ? tracked : received,
    balance:0,conflict:false,
  }
  if (received !== null && received > 0) return {
    status:'Part Received',kind:'partial',received,
    balance:balance === null && tracked !== null ? Math.max(0,tracked-received) : balance,
    conflict:false,
  }
  if (balance !== null && balance > 0) return { status:'Pending Receipt',kind:'pending',received,balance,conflict:false }
  if (received === 0) return { status:'Not Received',kind:'pending',received,balance,conflict:false }
  return { status:'Receipt status unknown',kind:'unknown',received,balance,conflict:false }
}

export function summarizeExcelReceiptPositions(rows) {
  const positions = rows.map(excelItemReceiptPosition)
  const count = kind => positions.filter(p => p.kind === kind).length
  return {
    total:positions.length,
    full:count('full'),
    partial:count('partial'),
    pending:count('pending'),
    cancelled:count('cancelled'),
    review:count('review'),
    unknown:count('unknown'),
    activeOutstanding:positions.filter(p => ['partial','pending','review','unknown'].includes(p.kind)).length,
  }
}
