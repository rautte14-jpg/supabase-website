import { excelReceivedIso } from './warehouseExcelReceipts.js'

// Verified from the user-provided PR & PO Tracker(2).xlsx, Purchase Requisitions
// worksheet: Received Date (Y), Received Qty (Z), 1–11 November 2026.
// This is a sum of mixed units, as explicitly requested for the dashboard KPI.
// It is NOT a homogeneous physical quantity or verified receipt movement total.
export const NOVEMBER_11_RECEIVED_ITEM_SNAPSHOT = Object.freeze({
  asOf: '2026-11-11',
  month: '2026-11',
  receivedQuantity: 20725,
  lineCount: 98,
  sourceFile: 'PR & PO Tracker(2).xlsx',
})

export function warehouseMonthlyReceivedItemQuantity(rows = [], batch = null, todayIso = '') {
  const month = String(todayIso).slice(0, 7)
  const datedRows = (Array.isArray(rows) ? rows : []).filter(row => {
    const date = excelReceivedIso(row.excel_received_date)
    return date && date.startsWith(month + '-') && date <= todayIso &&
      Number.isFinite(Number(row.received_qty)) && Number(row.received_qty) > 0
  })
  // Prefer fresh uploads with usable Excel item-level received dates.
  if (batch && datedRows.length > 0 && String(batch.completed_at || '').slice(0, 10) > NOVEMBER_11_RECEIVED_ITEM_SNAPSHOT.asOf) {
    return {
      receivedQuantity: Number(datedRows.reduce((sum, row) => sum + Number(row.received_qty), 0).toFixed(2)),
      lineCount: datedRows.length,
      asOf: todayIso,
      sourceFile: batch.source_file || 'Uploaded PR / PO Excel',
      source: 'latest-excel',
      mixedUnits: true,
    }
  }
  // Preserve the verified 11-Nov workbook snapshot while the live imported
  // batch predates Excel Received Date support. Never silently present it as
  // updated data beyond its source date.
  if (month === NOVEMBER_11_RECEIVED_ITEM_SNAPSHOT.month && todayIso >= NOVEMBER_11_RECEIVED_ITEM_SNAPSHOT.asOf) {
    return { ...NOVEMBER_11_RECEIVED_ITEM_SNAPSHOT, source: 'verified-snapshot', mixedUnits: true }
  }
  return null
}
