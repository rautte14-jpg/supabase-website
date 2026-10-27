import test from 'node:test'
import assert from 'node:assert/strict'
import { createLiveRefresh } from '../src/lib/liveRefresh.js'

function fixture() {
  const state = { hidden: false, refreshes: 0, invalidations: [] }
  const live = createLiveRefresh({
    dependencies: { home: ['stock'], orders: ['orders'] },
    invalidate: table => state.invalidations.push(table || '*'),
    refresh: () => { state.refreshes++; state.onRefresh?.() },
    isHidden: () => state.hidden,
  })
  return { state, live }
}

test('a change arriving during refresh is retained for the next refresh', () => {
  const { state, live } = fixture()
  live.mark('stock')
  state.onRefresh = () => live.mark('stock')
  live.flush('home')
  state.onRefresh = null
  assert.equal(live.flush('home'), true)
  assert.equal(live.flush('home'), false)
  assert.equal(state.refreshes, 2)
})

test('hidden tabs and inactive modules retain their changes', () => {
  const { state, live } = fixture()
  live.mark('orders')
  assert.equal(live.flush('home'), false)
  state.hidden = true
  assert.equal(live.flush('orders'), false)
  state.hidden = false
  assert.equal(live.flush('orders'), true)
  assert.equal(state.refreshes, 1)
})

test('reconnection and unknown-table events invalidate every module once', () => {
  const { state, live } = fixture()
  live.mark()
  assert.equal(live.flush('home'), true)
  assert.equal(live.flush('orders'), true)
  assert.equal(live.flush('home'), false)
  assert.deepEqual(state.invalidations, ['*', 'stock', 'orders'])
})
