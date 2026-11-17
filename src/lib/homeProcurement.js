import { statusGroup, summarizeTrackerLines } from './prTrackerState.js'

const key = value => String(value || '').trim().toUpperCase()

// Count PRs once, including receipt follow-up on their POs. Never add a
// parent PR and its child POs together as if they were independent requests.
export function summarizeOpenProcurement(headers = [], trackerRows = []) {
  const groups = new Map(), states = new Map()
  for (const row of trackerRows) {
    const pr = key(row.pr_no)
    if (!pr) continue
    if (!groups.has(pr)) groups.set(pr, [])
    groups.get(pr).push(row)
  }
  for (const [pr, rows] of groups) states.set(pr, summarizeTrackerLines(rows))
  const terminal = new Set(headers.filter(h => ['CANCELLED','REJECTED'].includes(statusGroup(h.status))).map(h => key(h.purch_req_id)))
  const open = new Set()
  for (const h of headers) {
    const pr = key(h.purch_req_id), state = states.get(pr)
    if (!pr || terminal.has(pr) || state?.full || (state?.hasLines && !state.activeLines)) continue
    if (['IN_REVIEW','DRAFT','APPROVED'].includes(statusGroup(h.status))) open.add(pr)
  }
  for (const [pr, state] of states) {
    if (!terminal.has(pr) && state.activeLines > 0 && !state.full) open.add(pr)
  }
  return { count:open.size, prs:[...open].sort() }
}

export async function loadHomeProcurement(client) {
  const [batchResult, headers] = await Promise.all([
    client.from('erp_po_excel_batches').select('id,source_file,completed_at').eq('status','complete').order('completed_at',{ascending:false}).limit(1).maybeSingle(),
    (async () => {
      const all = []
      for (let offset=0; ; offset+=1000) {
        const part = await client.from('pr_lifecycle_fast').select('purch_req_id,status').neq('status','Closed').order('purch_req_id').range(offset,offset+999)
        if (part.error) throw part.error
        all.push(...(part.data || []))
        if ((part.data || []).length < 1000) return all
      }
    })(),
  ])
  if (batchResult.error) throw batchResult.error
  if (!batchResult.data) throw new Error('No completed Excel tracker is available for the open procurement count.')
  const rows=[]
  for (let offset=0; ; offset+=1000) {
    const part = await client.from('erp_po_excel_rows').select('pr_no,po_no,source_qty,received_qty,balance_qty,excel_delivery_status,excel_po_status').eq('batch_id',batchResult.data.id).order('source_row').range(offset,offset+999)
    if (part.error) throw part.error
    rows.push(...(part.data || []))
    if ((part.data || []).length < 1000) break
  }
  return { ...summarizeOpenProcurement(headers, rows), trackerSource:batchResult.data.source_file, trackerUpdatedAt:batchResult.data.completed_at }
}
