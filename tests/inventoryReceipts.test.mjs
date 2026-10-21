import test from 'node:test'
import assert from 'node:assert/strict'
import { parseNumber } from '../src/lib/numbers.js'
import { mapRows } from '../src/importers.js'
import { receivedQty, requestedQty, receiptStage, receiptTone, summarizeReceiptLines } from '../src/lib/receipts.js'

test('real currency-formatted ageing export preserves quantities and values', () => {
  const [item] = mapRows('AGEING', [{'Item number':'1-0064116','On-hand quantity':'$39.00','On-hand value':'$1,015,971.78','Average unit cost':'$26,050.56'}])
  assert.equal(item.on_hand,39)
  assert.equal(item.available,39)
  assert.equal(item.stock_value,1015971.78)
  assert.equal(item.unit_cost,26050.56)
  assert.equal(parseNumber('(1,234.50)'),-1234.5)
  assert.equal(parseNumber('-2961'),-2961)
  assert.equal(parseNumber('MVR 5.20'),5.2)
  for(const v of ['',null,'—','unknown','USD','12,34','123oops']) assert.equal(parseNumber(v),null)
  assert.throws(()=>mapRows('AGEING',[{'Item number':'bad','On-hand quantity':'bad input'}]),/Invalid numeric/)
})
test('explicit zero is authoritative; full status fallback requires absent quantity', () => {
  assert.equal(receivedQty({qty_requested:100,qty_received:0,delivery_status:'Received All'}),0)
  assert.equal(receivedQty({qty_requested:100,qty_received:null,delivery_status:'Received All'}),100)
  assert.equal(receivedQty({qty_requested:100,qty_received:null,delivery_status:'Not Received'}),0)
  assert.equal(receivedQty({qty_requested:100,raw_source:{'Received Qty':'$20.00'}}),20)
  assert.equal(requestedQty({qty_requested:null,raw_source:{Quantity:'$39.00'}}),39)
})
test('receipt document does not imply all PR lines completed', () => {
  assert.equal(receiptStage({receipt_count:1},{requested:30,received:20}),'Part Received')
  assert.equal(receiptStage({receipt_count:1},{requested:0,received:0}),'Receipt Needs Review')
  assert.equal(receiptStage({receipt_count:1},{requested:30,received:30}),'Fully Received')
  assert.equal(receiptTone('Not Received'),'waiting')
  assert.equal(receiptTone('Part Received (20/30)'),'violet')
  assert.equal(receiptTone('Fully Received'),'good')
})

test('over-receipt on one line cannot hide the balance on another', () => {
  const summary = summarizeReceiptLines([{qty_requested:10,qty_received:20},{qty_requested:10,qty_received:0}])
  assert.deepEqual(summary,{requested:20,received:10,balance:10,hasLines:true})
  assert.equal(receiptStage({receipt_count:1},summary),'Part Received')
  assert.equal(summarizeReceiptLines([]).hasLines,false)
})
