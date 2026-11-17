import test from 'node:test'
import assert from 'node:assert/strict'
import { excelReceivedIso, makeWarehouseExcelReceiptModel, formatWarehouseUnitQuantities } from '../src/lib/warehouseExcelReceipts.js'

test('weekly tracker drilldown and PO coverage use exactly the counted item receipts', () => {
  const m=makeWarehouseExcelReceiptModel([
    {pr_no:'PR1',po_no:'PO1',item_code:'A',source_qty:2,received_qty:2,balance_qty:0,unit:'NOS',excel_received_date:'2026-11-11'},
    {pr_no:'PR1',po_no:'PO2',item_code:'B',source_qty:5,received_qty:3,balance_qty:2,unit:'KG',excel_received_date:'2026-11-12'},
    {pr_no:'PR2',po_no:'PO3',item_code:'C',source_qty:4,received_qty:4,excel_po_status:'Cancelled',excel_received_date:'2026-11-12'},
    {pr_no:'PR3',po_no:'PO4',item_code:'D',source_qty:4,received_qty:4,excel_received_date:'2026-11-04'},
  ],{id:'batch'})
  const p=m.period('2026-11-11','2026-11-17')
  assert.equal(p.prs,1)
  assert.equal(p.fullPrs+p.partialPrs,p.prs)
  assert.equal(p.receiptRows.length,p.lines)
  assert.equal(p.lines,2)
  assert.deepEqual(p.poNumbers,['PO1','PO2'])
  assert.deepEqual(p.receiptRows.map(r=>r.receipt_date),['2026-11-11','2026-11-12'])
})

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
