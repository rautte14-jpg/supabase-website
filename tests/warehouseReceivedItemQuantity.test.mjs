import test from 'node:test'
import assert from 'node:assert/strict'
import { warehouseMonthlyReceivedItemQuantity } from '../src/lib/warehouseReceivedItemQuantity.js'

test('preserves verified November 11 Excel snapshot while live batch lacks dates',()=>{
 const result=warehouseMonthlyReceivedItemQuantity([{received_qty:999,excel_received_date:null}],{completed_at:'2026-11-09T08:00:00Z'},'2026-11-11')
 assert.equal(result.receivedQuantity,20725)
 assert.equal(result.lineCount,98)
 assert.equal(result.asOf,'2026-11-11')
 assert.equal(result.source,'verified-snapshot')
})

test('fresh Excel with received dates replaces snapshot and ignores other months',()=>{
 const result=warehouseMonthlyReceivedItemQuantity([
  {received_qty:4,excel_received_date:'2026-11-07'},
  {received_qty:5.5,excel_received_date:'2026-11-10'},
  {received_qty:300,excel_received_date:'2026-10-29'},
  {received_qty:0,excel_received_date:'2026-11-11'},
 ],{completed_at:'2026-11-11T18:00:00Z',source_file:'new.xlsx'},'2026-11-11')
 assert.equal(result.receivedQuantity,9.5)
 assert.equal(result.lineCount,2)
 assert.equal(result.source,'latest-excel')
})

test('does not carry November 2026 snapshot into later months',()=>{
 const result=warehouseMonthlyReceivedItemQuantity([],null,'2026-12-11')
 assert.equal(result,null)
})
