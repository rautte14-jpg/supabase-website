import test from 'node:test'
import assert from 'node:assert/strict'
import { requestSimplix } from '../scripts/simplix-http.mjs'
import { syncPrDetails } from '../scripts/simplix-pr-details.mjs'

const options = fetchImpl => ({ fetchImpl, sleep: async () => {}, log: () => {} })
test('504 retries succeed without requesting authentication', async () => {
  let calls = 0
  const result = await requestSimplix('https://example.invalid', {}, options(async () => new Response(++calls < 3 ? 'gateway' : '{}', { status: calls < 3 ? 504 : 200 })))
  assert.equal(calls, 3)
  assert.equal(result.response.status, 200)
})
test('persistent timeout is bounded and excludes the server error body', async () => {
  let calls = 0
  await assert.rejects(requestSimplix('https://example.invalid', {}, options(async () => { calls++; return new Response('sensitive error body', { status: 504 }) })), error => error.retryable && !error.message.includes('sensitive'))
  assert.equal(calls, 4)
})
test('authentication and permission responses are not retried', async () => {
  for (const status of [401, 403]) {
    let calls = 0
    const result = await requestSimplix('https://example.invalid', {}, options(async () => { calls++; return new Response('', { status }) }))
    assert.equal(result.response.status, status)
    assert.equal(calls, 1)
  }
})
test('network failures retry', async () => {
  let calls = 0
  await requestSimplix('https://example.invalid', {}, options(async () => { if (++calls < 2) throw new TypeError('fetch failed'); return new Response('{}') }))
  assert.equal(calls, 2)
})
test('an exhausted PR is deferred, later PRs save, and the next batch excludes attempted PRs', async t => {
  const original = globalThis.fetch
  t.after(() => { globalThis.fetch = original })
  globalThis.fetch = async (_url, init) => {
    const { variables, operationName } = JSON.parse(init.body)
    if (variables.purchReqId === 'PR-FAIL') throw Object.assign(new Error('ERP timeout after retries'), { retryable: true })
    return new Response(JSON.stringify({ data: operationName === 'GetRequestTimeline' ? { getRequestTimeline: {} } : { getAllDatafromPR: {} } }))
  }
  const saved = []
  const supabase = { from: () => ({ select: () => ({ range: async () => ({ data: [] }) }), upsert: async row => { saved.push(row.purch_req_id); return {} } }) }
  const attempted = new Set()
  const args = { supabase, url: 'https://example.invalid', bearerToken: 'fake', headers: [{ purch_req_id: 'PR-FAIL', rec_id: 1 }, { purch_req_id: 'PR-OK', rec_id: 2 }], attempted, promptHidden: () => { throw new Error('Must not prompt on timeout') } }
  const result = await syncPrDetails(args)
  assert.deepEqual(result.failed, ['PR-FAIL'])
  assert.equal(result.processed, 2)
  assert.equal(result.synced, 1)
  assert.deepEqual(saved, ['PR-OK'])
  assert.equal((await syncPrDetails(args)).processed, 0)
})
