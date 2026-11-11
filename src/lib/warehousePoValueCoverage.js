// A PO's purchase value is NOT the actual monetary value of goods received.
// This calculates the subset of receipt-dated POs for which an MVR PO amount
// is present in the pending-payment tracker. Never label this as receipt value.
const norm = x => String(x ?? '').trim().toUpperCase()

export function warehousePoValueCoverage(receiptLinks = [], poValues = [], periodStart, periodEnd) {
  const datedPOs = new Set()
  for (const link of receiptLinks || []) {
    const po = norm(link.po_no)
    if (!po) continue
    const dates = Array.isArray(link.receipt_dates) ? link.receipt_dates : []
    if (dates.some(d => typeof d === 'string' && d >= periodStart && d <= periodEnd)) datedPOs.add(po)
  }
  const values = new Map()
  const ambiguous = new Set()
  for (const row of poValues || []) {
    const po = norm(row.po_no)
    if (!po || !datedPOs.has(po)) continue
    const currency = norm(row.raw_source?.Currency)
    const amount = row.po_value === null || row.po_value === undefined || row.po_value === '' ? NaN : Number(row.po_value)
    if (currency !== 'MVR' || !Number.isFinite(amount) || amount <= 0) continue
    if (values.has(po) && values.get(po) !== amount) ambiguous.add(po)
    else values.set(po, amount)
  }
  for (const po of ambiguous) values.delete(po)
  const matchedPOs = values.size
  const sum = [...values.values()].reduce((total,n)=>total+n,0)
  return {
    totalPOs:datedPOs.size, matchedPOs,
    unmatchedPOs:datedPOs.size - matchedPOs,
    amountMVR:Number(sum.toFixed(2)),
    coveragePct:datedPOs.size ? Math.round(100*matchedPOs/datedPOs.size) : 0,
    currency:'MVR',
    metricType:'partial_po_purchase_value_not_received_goods_value',
  }
}
