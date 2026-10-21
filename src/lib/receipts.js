import { parseNumber } from './numbers.js'
const clean = value => String(value ?? '').trim()
export function rawReceiptField(row, names) {
  const entries = Object.entries(row?.raw_source || {})
  const key = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  for (const name of names) {
    const hit = entries.find(([k]) => key(k) === key(name))
    if (hit && clean(hit[1])) return hit[1]
  }
  return ''
}
export function requestedQty(row) {
  return Math.max(0, parseNumber(row?.qty_requested) ?? parseNumber(rawReceiptField(row, ['Requested Qty','Request Qty','Quantity','PR Qty'])) ?? 0)
}
export function receivedQty(row) {
  const explicit = parseNumber(row?.qty_received) ?? parseNumber(rawReceiptField(row, ['Received','Received Qty','Received Quantity','Receipt Qty','PO Received Qty','Total Received Qty','Delivered Qty']))
  if (explicit !== null) return Math.max(0, explicit)
  const status = [row?.status, row?.delivery_status, rawReceiptField(row, ['PO ERP Status','Receipt Status'])].filter(Boolean).join(' ').toLowerCase()
  return /receiv|delivered/.test(status) && !/not\s*receiv|pending|awaiting|partial|part\s*receiv|cancel|reject/.test(status) ? requestedQty(row) : 0
}
export function receiptStage(detail, summary) {
  if (summary.requested > 0 && summary.received >= summary.requested) return 'Fully Received'
  if (summary.received > 0) return 'Part Received'
  if (Number(detail?.receipt_count || 0) > 0) return 'Receipt Needs Review'
  return null
}
export function receiptTone(text) {
  if (/needs review|reject|cancel|fail/i.test(text)) return 'bad'
  if (/not received|no po|approval|awaiting|pending|waiting|in progress/i.test(text)) return 'waiting'
  if (/part|rfq/i.test(text)) return 'violet'
  if (/received|matched|approved|complete|closed|delivered/i.test(text)) return 'good'
  if (/po stage|created/i.test(text)) return 'blue'
  return 'neutral'
}

export function summarizeReceiptLines(lines) {
  const requested = lines.reduce((sum,row) => sum + requestedQty(row),0)
  const received = lines.reduce((sum,row) => {
    const qty = requestedQty(row)
    return sum + Math.min(qty || Number.MAX_SAFE_INTEGER,receivedQty(row))
  },0)
  return {requested,received,balance:Math.max(0,requested-received),hasLines:lines.length>0}
}
