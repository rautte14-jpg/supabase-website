import test from 'node:test'
import assert from 'node:assert/strict'
import { RTL_STANDARD_REQUIREMENTS, rtlStandardRequirementRows } from '../src/rtlMechanicStandard.js'
import { evaluateRequirementRows } from '../src/lib/rtlCoverage.js'

test('mechanic list preserves all 182 supplied lines and one-engine quantities', () => {
  assert.equal(RTL_STANDARD_REQUIREMENTS.length, 182)
  assert.equal(new Set(RTL_STANDARD_REQUIREMENTS.map(row => row.item)).size, 182)
  assert.equal(RTL_STANDARD_REQUIREMENTS.reduce((sum, row) => sum + row.perEngine, 0), 521)
  assert.ok(RTL_STANDARD_REQUIREMENTS.some(row => row.item === '1-0018347'))
  assert.deepEqual(RTL_STANDARD_REQUIREMENTS.filter(row => row.sourceNo >= 92 && row.sourceNo <= 95), [])
  const pistons = RTL_STANDARD_REQUIREMENTS.find(row => row.item === '1-0044724')
  assert.equal(pistons.perEngine, 6)
  assert.match(pistons.description, /727698-22100/)
})

test('one-engine stock cannot be counted as complete two-engine vessel coverage', () => {
  const stock = Object.fromEntries(RTL_STANDARD_REQUIREMENTS.map(row => [row.item, row.perEngine]))
  const result = evaluateRequirementRows(rtlStandardRequirementRows(), stock)
  assert.equal(result.coverage, 0)
  assert.equal(result.blocked, 182)
  assert.equal(result.confirmedShortage, 521)
  assert.equal(evaluateRequirementRows(rtlStandardRequirementRows(), stock, 28, 2).confirmedShortage, 1563)
})

test('vessel coverage uses the limiting part and keeps absent items unavailable', () => {
  const stock = Object.fromEntries(RTL_STANDARD_REQUIREMENTS.map(row => [row.item, row.perEngine * 4]))
  assert.equal(evaluateRequirementRows(rtlStandardRequirementRows(), stock).coverage, 2)
  stock['1-0044724'] = 12
  assert.equal(evaluateRequirementRows(rtlStandardRequirementRows(), stock).coverage, 1)
  delete stock['1-0044724']
  const result = evaluateRequirementRows(rtlStandardRequirementRows(), stock)
  assert.equal(result.coverage, 0)
  assert.equal(result.missing, 1)
  assert.equal(result.rows.find(row => row.item === '1-0044724').available, null)
})
