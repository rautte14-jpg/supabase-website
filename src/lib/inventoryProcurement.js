import { excelItemReceiptPosition } from './excelReceiptPosition.js'
import { excelReceivedIso } from './warehouseExcelReceipts.js'

// Open position and drilldown lists share the same dated Excel source.
export function inventoryProcurementPosition(rows = [], today) {
  const prs = new Map(), pos = new Map()
  for (const row of rows) {
    const p = excelItemReceiptPosition(row)
    if (p.kind === 'cancelled') continue
    const pr = String(row.pr_no || '').trim().toUpperCase()
    const po = String(row.po_no || '').trim().toUpperCase()
    if (pr) { if (!prs.has(pr)) prs.set(pr, []); prs.get(pr).push(row) }
    if (po) { if (!pos.has(po)) pos.set(po, []); pos.get(po).push(row) }
  }
  const open = [...prs.values()].filter(group => group.some(r => excelItemReceiptPosition(r).kind !== 'full'))
  const age = group => {
    const dates = group.map(r => excelReceivedIso(r.source_raw?.submitted_date)).filter(Boolean).sort()
    return dates.length ? Math.max(0, Math.floor((Date.parse(today) - Date.parse(dates[0])) / 86400000)) : null
  }
  const urgent = open.filter(group => group.some(r => /urgent|critical|high/i.test(r.source_raw?.priority || '')))
  const aged6 = open.filter(group => age(group) !== null && age(group) >= 184)
  const pendingPos = [...pos.values()].filter(group => group.some(r => excelItemReceiptPosition(r).kind !== 'full'))
  const decorate = r => ({ ...r, requested_calc:r.source_qty, received_calc:excelItemReceiptPosition(r).received, submitted_date_calc:excelReceivedIso(r.source_raw?.submitted_date), status:excelItemReceiptPosition(r).status })
  return {
    receiptPendingPos:pendingPos.length,
    urgentPendingPrs:urgent.length,
    agedThreeToSix:open.filter(group => age(group) !== null && age(group) >= 91 && age(group) <= 183).length,
    agedSixPlus:aged6.length,
    oldestOpenDays:open.reduce((max, group) => Math.max(max, age(group) || 0), 0),
    pendingRows:pendingPos.flat().filter(r => excelItemReceiptPosition(r).kind !== 'full').map(decorate),
    urgentRows:urgent.map(group => decorate(group[0])),
    agedRows:aged6.map(group => decorate(group[0])),
    undatedOpenPrs:open.filter(group => age(group) === null).length,
  }
}
