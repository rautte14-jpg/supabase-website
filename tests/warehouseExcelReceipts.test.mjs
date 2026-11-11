import test from 'node:test'
import assert from 'node:assert/strict'
import { excelReceivedIso, makeWarehouseExcelReceiptModel, formatWarehouseUnitQuantities } from '../src/lib/warehouseExcelReceipts.js'

const row = (pr,po,item,unit,date,qty,status='Received All',requested=qty,balance=0) => ({
  pr_no:pr,po_no:po,item_code:item,unit,excel_received_date:date,
  source_qty:requested,received_qty:qty,balance_qty:balance,excel_delivery_status:status
})

test('Excel dates parse ISO and DD/MM/YYYY, reject invalid dates',()=>{
  assert.equal(excelReceivedIso('2026-11-10'),'2026-11-10')
  assert.equal(excelReceivedIso('10/11/2026'),'2026-11-10')
  assert.equal(excelReceivedIso('31/02/2026'),'')
  assert.equal(excelReceivedIso(null),'')
})

test('old Excel batch cannot fabricate period quantities',()=>{
  const m=makeWarehouseExcelReceiptModel([row('PR1','PO1','A','NOS',null,3)],{id:'batch'})
  assert.equal(m.available,false)
  assert.equal(m.undatedReceived,1)
  assert.equal(formatWarehouseUnitQuantities(m.period('2026-11-01','2026-11-30')),'Excel re-upload required')
})

test('groups dated Excel cumulative quantities by unit and never combines NOS and KG',()=>{
  const m=makeWarehouseExcelReceiptModel([
    row('PR1','PO1','A','NOS','10/11/2026',5),
    row('PR1','PO1','B','KG','2026-11-10',15),
    row('PR2','PO2','C','NOS','2026-11-02',2),
  ],{id:'batch'})
  const week=m.period('2026-11-04','2026-11-10')
  assert.deepEqual(week.quantityByUnit,[['KG',15],['NOS',5]])
  assert.equal(week.prs,1)
  assert.equal(week.lines,2)
  assert.equal(week.fullPrs,1)
  assert.equal(week.partialPrs,0)
  assert.equal(formatWarehouseUnitQuantities(week),'15 KG · 5 NOS')
})

test('does not double count duplicate PR PO item rows; distinguishes partially received PR',()=>{
  const m=makeWarehouseExcelReceiptModel([
    row('PR3','PO3','A','NOS','2026-11-10',4),
    row('PR3','PO3','A','NOS','2026-11-10',4),
    row('PR3','PO3','B','NOS','2026-11-10',2,'Part Received',5,3),
  ],{id:'batch'})
  const week=m.period('2026-11-04','2026-11-10')
  assert.equal(week.duplicateExcluded,2)
  assert.equal(week.lines,1)
  assert.equal(week.prs,1)
  assert.equal(week.partialPrs,1)
})

test('uses Simplix single PO receipt date when Excel item date is absent',()=>{
  const rows=[row('PR10','PO20','A','NOS',null,7),row('PR10','PO20','B','KG',null,3)]
  const links=[{pr_no:'PR10',po_no:'PO20',receipt_events:1,receipt_dates:['2026-11-10']}]
  const m=makeWarehouseExcelReceiptModel(rows,{id:'batch'},links)
  assert.equal(m.available,true)
  assert.equal(m.datedSimplix,2)
  const week=m.period('2026-11-04','2026-11-10')
  assert.equal(week.simplixLinkedLines,2)
  assert.equal(week.fullPrs,1)
  assert.deepEqual(week.quantityByUnit,[['KG',3],['NOS',7]])
})

test('does not assign cumulative Excel item quantities to ambiguous multi-receipt PO dates',()=>{
  const rows=[row('PR10','PO20','A','NOS',null,7)]
  const links=[{pr_no:'PR10',po_no:'PO20',receipt_events:2,receipt_dates:['2026-11-04','2026-11-10']}]
  const m=makeWarehouseExcelReceiptModel(rows,{id:'batch'},links)
  assert.equal(m.available,false)
  assert.equal(m.undatedReceived,1)
})

test('Excel item received date is used when present, even if PO has multiple ERP receipt events',()=>{
  const rows=[row('PR10','PO20','A','NOS','2026-11-06',7)]
  const links=[{pr_no:'PR10',po_no:'PO20',receipt_events:2,receipt_dates:['2026-11-04','2026-11-10']}]
  const m=makeWarehouseExcelReceiptModel(rows,{id:'batch'},links)
  const week=m.period('2026-11-04','2026-11-10')
  assert.equal(week.excelDatedLines,1)
  assert.equal(week.simplixLinkedLines,0)
})
