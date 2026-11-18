import test from 'node:test'
import assert from 'node:assert/strict'
import { makeWarehouseRtlModel } from '../src/lib/warehouseRtl.js'
import { RTL_STANDARD_REQUIREMENTS } from '../src/rtlMechanicStandard.js'

const source={snapshot_date:'2026-11-18',source_file:'On-hand.xlsx'}
const stock=RTL_STANDARD_REQUIREMENTS.map(row=>({item_code:row.item,raw_source:{'Available physical':row.perEngine}}))

test('warehouse slide distinguishes one-engine stock from two-engine vessel coverage',()=>{
  const model=makeWarehouseRtlModel(stock,source)
  assert.equal(model.standard.items,181)
  assert.equal(model.standard.engines,1)
  assert.equal(model.standard.vessels,0)
  assert.equal(model.standard.shortItems,0)
  assert.equal(model.standard.shortUnits,0)
  assert.equal(model.standard.missing,0)
  assert.deepEqual(model.shortages,[])
  assert.equal(model.source,source)
  assert.equal(model.pm.length,4)
})

test('slide identifies priority shortages from Available physical and excludes the removed item',()=>{
  const records=stock.map(row=>({...row,raw_source:{...row.raw_source}}))
  records.find(row=>row.item_code==='1-0020824').raw_source['Available physical']=9
  records.find(row=>row.item_code==='1-0028394').raw_source['Available physical']=3
  const model=makeWarehouseRtlModel(records,source)
  assert.equal(model.standard.engines,0)
  assert.equal(model.standard.shortItems,2)
  assert.equal(model.standard.shortUnits,19)
  assert.deepEqual(model.shortages.map(row=>[row.item,row.required,row.available,row.shortage]),[['1-0020824',19,9,10],['1-0028394',12,3,9]])
  assert.match(model.shortages[0].description,/24321-000250/)
  assert.ok(!model.shortages.some(row=>row.item==='1-0018347'))
})

test('missing source is an error and missing stock remains unavailable',()=>{
  assert.throws(()=>makeWarehouseRtlModel(stock,null),/Upload On-hand Stock/)
  const model=makeWarehouseRtlModel([],source)
  assert.equal(model.standard.engines,0)
  assert.equal(model.standard.missing,181)
  assert.equal(model.standard.shortUnits,519)
  assert.equal(model.shortages.length,5)
  assert.ok(model.shortages.every(row=>row.missing))
})
