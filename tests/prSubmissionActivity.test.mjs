import assert from 'node:assert/strict'
import test from 'node:test'
import { buildPrSubmissionWeeks, maldivesDateIso, submissionDateIso, submissionWeekStart } from '../src/lib/prSubmissionActivity.js'

test('Wednesday–Tuesday counts and table membership share Maldives calendar dates', () => {
  const headers = [
    { purch_req_id: 'BEFORE', created_at: '2026-10-13T18:59:59Z' },
    { purch_req_id: 'FIRST', created_at: '2026-10-13T19:00:00Z' },
    { purch_req_id: 'LAST', created_at: '2026-10-20T18:59:59.999Z' },
    { purch_req_id: 'NEXT', created_at: '2026-10-20T19:00:00Z' },
    { purch_req_id: 'RAW', created_at_raw: '10/17/2026 10:48:02 am' },
    { purch_req_id: 'RAW', created_at_raw: '10/17/2026 10:48:02 am' },
  ]
  const weeks = buildPrSubmissionWeeks(headers, 2026, '2026-10-21')
  assert.deepEqual(weeks.slice(0, 3), [
    { weekStart: '2026-10-21', weekEnd: '2026-10-27', count: 1 },
    { weekStart: '2026-10-14', weekEnd: '2026-10-20', count: 3 },
    { weekStart: '2026-10-07', weekEnd: '2026-10-13', count: 1 },
  ])
  const tableIds = new Set(headers.filter(row => submissionWeekStart(submissionDateIso(row)) === '2026-10-14').map(row => row.purch_req_id))
  assert.deepEqual([...tableIds], ['FIRST', 'LAST', 'RAW'])
  assert.equal(tableIds.size, weeks[1].count)
})

test('a selected historical year uses its own weeks and excludes other years', () => {
  const rows = [
    { purch_req_id: 'OLD', created_at: '2025-12-31T10:00:00Z' },
    { purch_req_id: 'NEW', created_at: '2026-01-01T10:00:00Z' },
  ]
  assert.deepEqual(buildPrSubmissionWeeks(rows, 2025, '2026-10-21')[0], {
    weekStart: '2025-12-31', weekEnd: '2026-01-06', count: 1,
  })
})

test('canonical dates take precedence, raw ERP dates work, and invalid dates are excluded', () => {
  assert.equal(submissionDateIso({ created_at: '2026-10-20T10:21:27+00:00', created_at_raw: '1/1/2020' }), '2026-10-20')
  assert.equal(submissionDateIso({ created_at_raw: '10/14/2026 03:21:27 pm' }), '2026-10-14')
  assert.equal(submissionDateIso({ created_at_raw: '2/31/2026' }), '')
  assert.equal(submissionDateIso({ created_at: '2026-02-31' }), '')
  assert.equal(submissionDateIso({}), '')
  assert.equal(submissionWeekStart(''), '')
  assert.equal(maldivesDateIso('2026-10-20T19:00:00Z'), '2026-10-21')
  assert.equal(buildPrSubmissionWeeks([{ purch_req_id: 'BAD' }], 2026, '2026-10-21').every(week => week.count === 0), true)
})
