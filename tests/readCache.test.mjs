import test from 'node:test'
import assert from 'node:assert/strict'
import { fastFetch, clearSupabaseReadCache } from '../src/lib/readCache.js'

const url = 'https://example.invalid/rest/v1/stock_items?select=*'
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

function mockFetch(t, implementation) {
  const original = globalThis.fetch
  globalThis.fetch = implementation
  clearSupabaseReadCache()
  t.after(() => { globalThis.fetch = original; clearSupabaseReadCache() })
}

test('a response invalidated while its body is being read cannot refill the cache', async t => {
  const body = deferred()
  const reading = deferred()
  let requests = 0
  mockFetch(t, async () => {
    requests++
    if (requests > 1) return new Response('new')
    const response = new Response('old')
    response.clone = () => ({
      arrayBuffer: () => { reading.resolve(); return body.promise },
      status: 200, statusText: 'OK', headers: new Headers(),
    })
    return response
  })
  const pending = fastFetch(url)
  await reading.promise
  clearSupabaseReadCache('stock_items')
  body.resolve(new TextEncoder().encode('old').buffer)
  await pending
  assert.equal(await (await fastFetch(url)).text(), 'new')
  assert.equal(requests, 2)
})

test('reads made during a write are invalidated after the write completes', async t => {
  const write = deferred()
  let value = 'old'
  mockFetch(t, async (_input, init) => {
    if (init.method === 'PATCH') { await write.promise; value = 'new'; return new Response(null, { status: 204 }) }
    return new Response(value)
  })
  const pending = fastFetch(url, { method: 'PATCH' })
  assert.equal(await (await fastFetch(url)).text(), 'old')
  write.resolve()
  await pending
  assert.equal(await (await fastFetch(url)).text(), 'new')
})

test('concurrent reads share the request and cached responses stay independently readable', async t => {
  let requests = 0
  mockFetch(t, async () => { requests++; return new Response('rows') })
  const responses = await Promise.all([fastFetch(url), fastFetch(url)])
  assert.deepEqual(await Promise.all(responses.map(response => response.text())), ['rows', 'rows'])
  assert.equal(await (await fastFetch(url)).text(), 'rows')
  assert.equal(requests, 1)
})

test('Home summary cache follows changes to each of its underlying sources', async t => {
  let requests = 0
  mockFetch(t, async () => { requests++; return new Response(String(requests)) })
  const summaryUrl = 'https://example.invalid/rest/v1/portal_home_summary?select=*'
  await fastFetch(summaryUrl)
  for (const table of ['procurement_records', 'material_records', 'stock_items']) {
    clearSupabaseReadCache(table)
    await fastFetch(summaryUrl)
  }
  assert.equal(requests, 4)
})

test('count-only HEAD queries do not evict table reads or reuse their bodies', async t => {
  let requests = 0
  mockFetch(t, async (_input, init) => {
    requests++
    return init.method === 'HEAD'
      ? new Response(null, { headers: { 'content-range': '*/42' } })
      : new Response('rows')
  })
  await fastFetch(url)
  const count = await fastFetch(url, { method: 'HEAD' })
  assert.equal(count.headers.get('content-range'), '*/42')
  assert.equal(await count.text(), '')
  assert.equal(await (await fastFetch(url)).text(), 'rows')
  assert.equal(requests, 2)
})
