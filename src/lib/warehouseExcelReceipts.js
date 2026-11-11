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
// Excel confirms cumulative received item quantities. Simplix confirms PO-level
// receipt dates. A single PO receipt event can anchor a PO-linked snapshot in
// time, but does not prove each individual item was received on that date.
export function makeWarehouseExcelReceiptModel(rows = [], batch = null, receiptLinks = []) {
  const input = Array.isArray(rows) ? rows : []
  const links = new Map()
  for (const link of Array.isArray(receiptLinks) ? receiptLinks : []) {
    const key = [norm(link.pr_no), norm(link.po_no)].join('|')
    if (link.pr_no && link.po_no) links.set(key, link)
  }
  function dateInfo(row) {
    const excelDate = excelReceivedIso(row.excel_received_date)
    if (excelDate) return { date: excelDate, source: 'excel' }
    const key = [norm(row.pr_no), norm(row.po_no)].join('|')
    const link = links.get(key)
    const dates = Array.isArray(link?.receipt_dates) ? link.receipt_dates.map(excelReceivedIso).filter(Boolean) : []
    if (Number(link?.receipt_events) === 1 && dates.length === 1) return { date: dates[0], source: 'simplix-po' }
    return { date:'', source: Number(link?.receipt_events) > 1 ? 'multiple-receipts' : 'no-receipt-date' }
  }
  const datedExcel = input.filter(row => excelReceivedIso(row.excel_received_date)).length
  const datedSimplix = input.filter(row => dateInfo(row).source === 'simplix-po').length
  const undatedReceived = input.filter(row => {
    const position = excelItemReceiptPosition(row)
    return position.kind !== 'cancelled' && position.received > 0 && !dateInfo(row).date
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
  const duplicateKeys = new Set([...duplicates].filter(([, n]) => n > 1).map(([k]) => k))
  function period(start,end) {
    const unitQuantities = new Map()
    const touched = new Set()
    let lines = 0, duplicateExcluded = 0, simplixLinkedLines = 0, excelDatedLines = 0
    for (const row of input) {
      const link = dateInfo(row)
      if (!link.date || link.date < start || link.date > end) continue
      const p = excelItemReceiptPosition(row)
      if (p.kind === 'cancelled' || p.kind === 'review' || p.received === null || p.received <= 0) continue
      const pr = norm(row.pr_no)
      if (!pr) continue
      const key = [pr, norm(row.po_no), norm(row.item_code)].join('|')
      if (duplicateKeys.has(key)) { duplicateExcluded++; continue }
      touched.add(pr)
      lines++
      if (link.source === 'simplix-po') simplixLinkedLines++
      else excelDatedLines++
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
    return {
      available: Boolean(batch) && (datedExcel + datedSimplix) > 0,
      prs:touched.size, lines, fullPrs:full, partialPrs:partial,
      quantityByUnit:[...unitQuantities].sort(([a],[b])=>a.localeCompare(b)),
      duplicateExcluded, undatedInBatch:undatedReceived, simplixLinkedLines, excelDatedLines,
    }
  }
  return {
    available:Boolean(batch) && (datedExcel + datedSimplix)>0,
    batch,rows:input.length,datedRows:datedExcel+datedSimplix,
    datedExcel,datedSimplix,undatedReceived,
    duplicateCount:duplicateKeys.size,period,
  }
}

export function formatWarehouseUnitQuantities(summary) {
  if (!summary?.available) return 'No dated PO-linked Excel quantities'
  if (!summary.quantityByUnit.length) return 'No dated Excel items'
  return summary.quantityByUnit.map(([unit, qty]) => `${Number(qty).toLocaleString(undefined,{ maximumFractionDigits:2 })} ${unit}`).join(' · ')
}
