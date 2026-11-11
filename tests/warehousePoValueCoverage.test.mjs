import test from 'node:test'
import assert from 'node:assert/strict'
import { warehousePoValueCoverage } from '../src/lib/warehousePoValueCoverage.js'

test('only receipt-dated POs with validated MVR values contribute', () => {
 const links=[
  { po_no:'PO1',receipt_dates:['2026-11-05']},
  { po_no:'PO2',receipt_dates:['2026-11-08']},
  { po_no:'PO3',receipt_dates:['2026-10-18']},
 ]
 const payments=[
  {po_no:'PO1',po_value:1200.5,raw_source:{Currency:'MVR'}},
  {po_no:'PO2',po_value:400,raw_source:{Currency:'USD'}},
  {po_no:'PO3',po_value:500,raw_source:{Currency:'MVR'}},
 ]
 const result=warehousePoValueCoverage(links,payments,'2026-11-01','2026-11-11')
 assert.equal(result.totalPOs,2)
 assert.equal(result.matchedPOs,1)
 assert.equal(result.amountMVR,1200.5)
 assert.equal(result.unmatchedPOs,1)
 assert.equal(result.metricType,'partial_po_purchase_value_not_received_goods_value')
})

test('deduplicates POs; conflicting duplicate amounts are excluded',()=>{
 const links=[{po_no:'PO1',receipt_dates:['2026-11-05']},{po_no:'po1',receipt_dates:['2026-11-05']},{po_no:'PO2',receipt_dates:['2026-11-09']}]
 const payments=[
  {po_no:'PO1',po_value:200,raw_source:{Currency:'MVR'}},
  {po_no:'po1',po_value:200,raw_source:{Currency:'MVR'}},
  {po_no:'PO2',po_value:500,raw_source:{Currency:'MVR'}},
  {po_no:'PO2',po_value:600,raw_source:{Currency:'MVR'}},
 ]
 const result=warehousePoValueCoverage(links,payments,'2026-11-01','2026-11-11')
 assert.deepEqual({count:result.matchedPOs,total:result.amountMVR}, {count:1,total:200})
})
