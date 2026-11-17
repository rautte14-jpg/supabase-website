import test from 'node:test'
import assert from 'node:assert/strict'
import { statusGroup, currentHolder, summarizeTrackerLines, lifecycleMatches } from '../src/lib/prTrackerState.js'

test('Closed, Draft and unknown statuses never match In Review', () => {
  for (const status of ['Closed','Draft','Something new','Approved','Completed','Rejected','Cancelled']) assert.notEqual(statusGroup(status),'IN_REVIEW')
  assert.equal(statusGroup('In review'),'IN_REVIEW')
  assert.equal(statusGroup('Pending approval'),'IN_REVIEW')
})

test('completed workflow cannot leak its last approver into PO stage or pending-approver filter', () => {
  const detail={current_approver:'Previous approver',current_workflow_status:'Completed',po_count:1}
  assert.equal(currentHolder(detail,'PO Stage','Closed'),'—')
  assert.equal(lifecycleMatches(detail,'Closed','PENDING_APPROVER'),false)
  assert.equal(currentHolder({...detail,current_workflow_status:'Pending'},'PR Approval','In review'),'Previous approver')
  assert.equal(currentHolder({...detail,purchase_orders:[{PendingApprovers:['PO approver']}]},'PO Stage','Closed'),'PO approver')
})

test('tracker uses each item position; mixed quantities and cancelled rows cannot mask a shortage', () => {
  const summary=summarizeTrackerLines([
    {po_no:'PO1',source_qty:10,received_qty:10,balance_qty:0,excel_delivery_status:'Received All'},
    {po_no:'PO1',source_qty:2,received_qty:1,balance_qty:1},
    {po_no:'PO2',source_qty:99,received_qty:0,excel_po_status:'Cancelled'},
  ])
  assert.equal(summary.stage,'Part Received')
  assert.equal(summary.full,false)
  assert.deepEqual([...summary.poNos],['PO1'])
  assert.equal(lifecycleMatches({po_count:1,receipt_count:0},'Closed','RECEIVED',summary),true)
  assert.equal(lifecycleMatches({po_count:1,receipt_count:0},'Closed','NO_RECEIPT',summary),false)
})

test('Received All confirms receipt without inventing a missing quantity; absence stays unknown', () => {
  assert.equal(summarizeTrackerLines([{source_qty:5,excel_delivery_status:'Received All'}]).receipt,'Fully Received')
  assert.equal(summarizeTrackerLines().receipt,'No tracker items')
  assert.equal(lifecycleMatches({po_count:1,receipt_count:0},'Closed','NO_RECEIPT'),false)
  assert.equal(summarizeTrackerLines([{source_qty:5,received_qty:1,balance_qty:4,excel_delivery_status:'Received All'}]).review,true)
})
