import test from 'node:test'
import assert from 'node:assert/strict'
import { mapRows } from '../src/importers.js'
import { rtlStockFromRecords } from '../src/lib/rtlStockSource.js'

test('physical stock retains Available physical independently of total on-hand quantity',()=>{
  const source={'Item number':'1-0000001','Physical inventory':20,'Available physical':12,'Physical reserved':8}
  const [r]=mapRows('STOCK',[source])
  assert.equal(r.on_hand,20)
  assert.equal(r.available,12)
  assert.equal(r.reserved,8)
  assert.deepEqual(rtlStockFromRecords([r],['1-0000001','1-0000002']),{'1-0000001':12,'1-0000002':null})
})

test('readiness preserves confirmed zero and never substitutes ageing on-hand for usable stock',()=>{
  assert.deepEqual(rtlStockFromRecords([{item_code:'1-0000001',raw_source:{'Available physical':0,'Physical inventory':20}}],['1-0000001']),{'1-0000001':0})
  assert.throws(()=>rtlStockFromRecords([{item_code:'1-0000001',raw_source:{'On-hand quantity':20}}],['1-0000001']),/does not supply Available physical/)
})
