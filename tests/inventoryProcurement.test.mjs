import test from 'node:test'
import assert from 'node:assert/strict'
import { inventoryProcurementPosition } from '../src/lib/inventoryProcurement.js'

test('open tracker position counts distinct documents, excludes cancelled lines and keeps detail counts aligned', () => {
  const row = (pr,po,qty,received,status,date,priority='Normal') => ({pr_no:pr,po_no:po,source_qty:qty,received_qty:received,balance_qty:qty-received,excel_delivery_status:status,source_raw:{submitted_date:date,priority}})
  const result = inventoryProcurementPosition([
    row('PR1','PO1',10,2,'Part Received','2026-01-01','Urgent'),
    row('PR1','PO1',5,0,'Pending','2026-01-01','Urgent'),
    row('PR2','PO2',2,2,'Received All','2026-01-01'),
    row('PR3','PO3',5,0,'Cancelled','2026-01-01','Urgent'),
    row('PR4','PO4',5,0,'Pending',null),
  ],'2026-11-11')
  assert.equal(result.receiptPendingPos,2)
  assert.equal(new Set(result.pendingRows.map(r=>r.po_no)).size,2)
  assert.equal(result.urgentPendingPrs,1)
  assert.equal(result.urgentRows.length,1)
  assert.equal(result.agedSixPlus,1)
  assert.equal(result.agedRows.length,1)
  assert.equal(result.undatedOpenPrs,1)
  assert.equal(result.oldestOpenDays,314)
})
