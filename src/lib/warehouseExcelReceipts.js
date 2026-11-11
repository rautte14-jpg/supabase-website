import { excelItemReceiptPosition } from './excelReceiptPosition.js'

const clean = x => String(x ?? '').trim()
const norm = x => clean(x).toUpperCase()

export function excelReceivedIso(raw) {
  const value = clean(raw)
  if (!value) return ''
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  // Text from the tracker is interpreted as DD/MM/YYYY, consistent with the SRD Excel export.
  const dmy = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s.*)?$/)
  const year = Number(iso?.[1] || dmy?.[3])
  const month = Number(iso?.[2] || dmy?.[2])
  const day = Number(iso?.[3] || dmy?.[1])
  if (!year || !month || !day) return ''
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return ''
  return [year, String(month).padStart(2, '0'), String(day).padStart(2, '0')].join('-')
}

// The Excel received quantity is cumulative for an item row; the Excel date
// identifies that item's recorded receipt date, NOT an ERP item-level movement.
export function makeWarehouseExcelReceiptModel(rows = [], batch = null) {
  const input = Array.isArray(rows) ? rows : []
  const validDate = row => excelReceivedIso(row.excel_received_date)
  const datedRows = input.filter(row => validDate(row)).length
  const undatedReceived = input.filter(row => {
    const position = excelItemReceiptPosition(row)
    return position.kind !== 'cancelled' && position.received > 0 && !validDate(row)
  }).length
  const prPositions = new Map()
  const duplicates = new Map()
  for (const row of input) {
    const pr = norm(row.pr_no)
    if (!pr) continue
    if (!prPositions.has(pr)) prPositions.set(pr, [])
    prPositions.get(pr).push(excelItemReceiptPosition(row))
    const key = [pr, norm(row.po_no), norm(row.item_code)].join('|')
    if (norm(row.po_no) && norm(row.item_code)) duplicates.set(key, (duplicates.get(key) || 0) + 1)
  }
  const duplicateKeys = new Set([...duplicates].filter(([,n]) => n > 1).map(([k]) => k))
  function period(start, end) {
    const unitQuantities = new Map()
    const touched = new Set()
    let lines = 0
    let duplicateExcluded = 0
    let undatedInBatch = undatedReceived
    for (const row of input) {
      const date = validDate(row)
      if (!date || date < start || date > end) continue
      const p = excelItemReceiptPosition(row)
      if (p.kind === 'cancelled' || p.kind === 'review' || p.received === null || p.received <= 0) continue
      const pr = norm(row.pr_no)
      if (!pr) continue
      const key = [pr, norm(row.po_no), norm(row.item_code)].join('|')
      // Never silently sum repeated PR/PO/item records: their separate source
      // lines may represent duplicates rather than independent receipts.
      if (duplicateKeys.has(key)) { duplicateExcluded++; continue }
      touched.add(pr)
      lines++
      const unit = norm(row.unit) || 'UOM UNKNOWN'
      unitQuantities.set(unit, (unitQuantities.get(unit) || 0) + p.received)
    }
    let full = 0, partial = 0
    for (const pr of touched) {
      const positions = prPositions.get(pr) || []
      const active = positions.filter(p => p.kind !== 'cancelled')
      if (active.length && active.every(p => p.kind === 'full')) full++
      else partial++
    }
    const qtyByUnit = [...unitQuantities].sort(([a],[b]) => a.localeCompare(b))
    return {
      available: Boolean(batch) && datedRows > 0,
      prs:touched.size, lines, fullPrs:full, partialPrs:partial,
      quantityByUnit:qtyByUnit, duplicateExcluded, undatedInBatch
    }
  }
  return {
    available: Boolean(batch) && datedRows > 0,
    batch, rows:input.length, datedRows, undatedReceived,
    duplicateCount:duplicateKeys.size, period
  }
}

export function formatWarehouseUnitQuantities(summary) {
  if (!summary?.available) return 'Excel re-upload required'
  if (!summary.quantityByUnit.length) return 'No dated Excel items'
  return summary.quantityByUnit.map(([unit, qty]) => `${Number(qty).toLocaleString(undefined,{ maximumFractionDigits:2 })} ${unit}`).join(' · ')
}
