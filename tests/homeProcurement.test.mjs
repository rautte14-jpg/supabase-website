import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOpenProcurement, loadHomeProcurement } from '../src/lib/homeProcurement.js'

test('combines workflow and receipt follow-up without counting PRs or their POs twice', () => {
  const headers=[{purch_req_id:'PR1',status:'In review'},{purch_req_id:'PR2',status:'Approved'},{purch_req_id:'PR3',status:'Cancelled'},{purch_req_id:'PR4',status:'Closed'},{purch_req_id:'PR5',status:'Draft'}]
  const row=(pr,po,received,status='')=>({pr_no:pr,po_no:po,source_qty:10,received_qty:received,balance_qty:10-received,excel_delivery_status:status})
  const result=summarizeOpenProcurement(headers,[row('PR1','PO1',0),row('PR1','PO2',5),row('PR2','PO3',10,'Received All'),row('PR3','PO4',0),row('PR4','PO5',2),row('PR6','PO6',0,'Cancelled')])
  assert.deepEqual(result,{count:3,prs:['PR1','PR4','PR5']})
})

test('missing tracker import is an error rather than a fabricated zero', async () => {
  const query={select(){return this},eq(){return this},neq(){return this},order(){return this},limit(){return this},maybeSingle:async()=>({data:null}),range:async()=>({data:[]})}
  await assert.rejects(loadHomeProcurement({from:()=>query}),/No completed Excel tracker/)
})
