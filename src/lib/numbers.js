// ERP exports use both numeric cells and currency-formatted text cells.
export function parseNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  let text = value.trim()
  if (!text || /^[-–—]+$/.test(text)) return null
  const accounting = /^\(.*\)$/.test(text)
  if (accounting) text = text.slice(1, -1).trim()
  text = text.replace(/^(?:MVR|USD|EUR|GBP|Rf\.?)\s*/i, '').replace(/^[$€£]\s*/, '')
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(text)) return null
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) ? (accounting ? -Math.abs(n) : n) : null
}
