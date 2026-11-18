import test from 'node:test'
import assert from 'node:assert/strict'
import { RTL_STANDARD_REQUIREMENTS, rtlStandardRequirementRows } from '../src/rtlMechanicStandard.js'
import { calculateRtlShortages, evaluateRequirementRows } from '../src/lib/rtlCoverage.js'

test('mechanic list keeps 181 active lines after the explicit item exclusion', () => {
  assert.equal(RTL_STANDARD_REQUIREMENTS.length, 181)
  assert.equal(new Set(RTL_STANDARD_REQUIREMENTS.map(row => row.item)).size, 181)
  assert.equal(RTL_STANDARD_REQUIREMENTS.reduce((sum, row) => sum + row.perEngine, 0), 519)
  assert.ok(!RTL_STANDARD_REQUIREMENTS.some(row => row.item === '1-0018347'))
  assert.ok(!rtlStandardRequirementRows().some(row => row[1] === '1-0018347'))
  assert.deepEqual(RTL_STANDARD_REQUIREMENTS.filter(row => row.sourceNo >= 92 && row.sourceNo <= 95), [])
  const pistons = RTL_STANDARD_REQUIREMENTS.find(row => row.item === '1-0044724')
  assert.equal(pistons.perEngine, 6)
  assert.match(pistons.description, /727698-22100/)
})

test('calculator switches between engines and vessels using the same physical stock', () => {
  const stock = Object.fromEntries(RTL_STANDARD_REQUIREMENTS.map(row => [row.item, row.perEngine]))
  const rows = evaluateRequirementRows(rtlStandardRequirementRows(), stock).rows
  assert.equal(calculateRtlShortages(rows, 1, 'engines').confirmedShortage, 0)
  assert.equal(calculateRtlShortages(rows, 1, 'vessels').confirmedShortage, 519)
  assert.deepEqual(calculateRtlShortages(rows, 2, 'engines'), calculateRtlShortages(rows, 1, 'vessels'))
  const threeEngines = calculateRtlShortages(rows, 3, 'engines')
  assert.equal(threeEngines.confirmedShortage, 1038)
  assert.equal(threeEngines.rows.find(row => row.item === '1-0044724').required, 18)
  assert.ok(!threeEngines.rows.some(row => row.item === '1-0018347'))
})

test('calculator keeps missing stock unavailable and rejects unconfirmed fractional engine requirements', () => {
  const rows = evaluateRequirementRows([['S', 'part', 12, null]], {}).rows
  const engine = calculateRtlShortages(rows, 1, 'engines')
  assert.equal(engine.rows[0].required, 6)
  assert.equal(engine.rows[0].shortage, 6)
  assert.equal(engine.rows[0].missing, true)
  assert.throws(() => calculateRtlShortages([{perVessel:1, available:0}], 1, 'engines'), /per vessel/)
})

test('one-engine stock cannot be counted as complete two-engine vessel coverage', () => {
  const stock = Object.fromEntries(RTL_STANDARD_REQUIREMENTS.map(row => [row.item, row.perEngine]))
  const result = evaluateRequirementRows(rtlStandardRequirementRows(), stock)
  assert.equal(result.coverage, 0)
  assert.equal(result.blocked, 181)
  assert.equal(result.confirmedShortage, 519)
  assert.equal(evaluateRequirementRows(rtlStandardRequirementRows(), stock, 28, 2).confirmedShortage, 1557)
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
