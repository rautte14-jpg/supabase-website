const MALDIVES_OFFSET_MS = 5 * 60 * 60 * 1000

function calendarDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const iso = date.toISOString().slice(0, 10)
  return iso === `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` ? iso : ''
}

export function maldivesDateIso(value = new Date()) {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? '' : new Date(date.valueOf() + MALDIVES_OFFSET_MS).toISOString().slice(0, 10)
}

export function submissionDateIso(row) {
  // created_at is the canonical timestamptz; ERP display dates are Maldives time.
  const stored = String(row.created_at || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(stored)) return calendarDate(...stored.split('-'))
  if (stored) {
    const iso = maldivesDateIso(stored)
    if (iso) return iso
  }
  const raw = String(row.created_at_raw || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/)
  return raw ? calendarDate(raw[3], raw[1], raw[2]) : ''
}

export function submissionWeekStart(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return ''
  const date = new Date(`${iso}T00:00:00.000Z`)
  if (Number.isNaN(date.valueOf())) return ''
  date.setUTCDate(date.getUTCDate() - (date.getUTCDay() - 3 + 7) % 7)
  return date.toISOString().slice(0, 10)
}

export function buildPrSubmissionWeeks(headers, year, today = maldivesDateIso()) {
  const weeks = new Map()
  for (const row of headers) {
    const iso = submissionDateIso(row)
    const pr = String(row.purch_req_id || '').trim().toUpperCase()
    if (!pr || !iso.startsWith(`${year}-`)) continue
    const week = submissionWeekStart(iso)
    if (!weeks.has(week)) weeks.set(week, new Set())
    weeks.get(week).add(pr)
  }
  const anchor = submissionWeekStart(today.startsWith(`${year}-`) ? today : `${year}-12-31`)
  return Array.from({ length: 8 }, (_, index) => {
    const start = new Date(`${anchor}T00:00:00.000Z`)
    start.setUTCDate(start.getUTCDate() - index * 7)
    const weekStart = start.toISOString().slice(0, 10)
    start.setUTCDate(start.getUTCDate() + 6)
    return { weekStart, weekEnd: start.toISOString().slice(0, 10), count: weeks.get(weekStart)?.size || 0 }
  })
}
