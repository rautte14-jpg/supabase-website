import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'
import { excelItemReceiptPosition } from './lib/excelReceiptPosition.js'

const clean = value => String(value ?? '').trim()
const upper = value => clean(value).toUpperCase()
const PAGE_SIZE = 25

async function fetchAll(table, columns, customize = query => query) {
  const out = []
  let offset = 0
  while (true) {
    const { data, error } = await customize(supabase.from(table).select(columns)).range(offset, offset + 999)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < 1000) return out
    offset += 1000
  }
}

async function loadOrders(year) {
  const start = `${year}-01-01T00:00:00+05:00`
  const end = `${year + 1}-01-01T00:00:00+05:00`
  const headers = await fetchAll('erp_pr_headers', 'purch_req_id,description,created_at', q =>
    q.gte('created_at', start).lt('created_at', end).order('purch_req_id'))
  const headerMap = new Map(headers.map(h => [upper(h.purch_req_id), h]))
  const ids = [...headerMap.keys()]
  const detailJobs = []
  for (let index = 0; index < ids.length; index += 100) {
    detailJobs.push(supabase.from('erp_pr_details')
      .select('purch_req_id,purchase_orders,product_receipts')
      .in('purch_req_id', ids.slice(index, index + 100)))
  }
  const { data: batch, error: batchError } = await supabase.from('erp_po_excel_batches')
    .select('id,source_file,completed_at').eq('status', 'complete')
    .order('completed_at', { ascending: false }).limit(1).maybeSingle()
  if (batchError) throw batchError
  const results = await Promise.all(detailJobs)
  for (const result of results) if (result.error) throw result.error
  const details = results.flatMap(r => r.data || [])
  const excel = batch ? await fetchAll('erp_po_excel_rows',
    'pr_no,po_no,item_code,source_qty,received_qty,balance_qty,excel_delivery_status,excel_po_status,supplier',
    q => q.eq('batch_id', batch.id).order('source_row')) : []
  const excelByPo = new Map()
  for (const row of excel) {
    const key = `${upper(row.pr_no)}|${upper(row.po_no)}`
    if (!row.pr_no || !row.po_no || !headerMap.has(upper(row.pr_no))) continue
    if (!excelByPo.has(key)) excelByPo.set(key, [])
    excelByPo.get(key).push(row)
  }
  const output = []
  const seen = new Set()
  for (const d of details) {
    const pr = upper(d.purch_req_id)
    const h = headerMap.get(pr)
    if (!h) continue
    const receipts = Array.isArray(d.product_receipts) ? d.product_receipts : []
    for (const po of Array.isArray(d.purchase_orders) ? d.purchase_orders : []) {
      const id = upper(po.PurchId)
      const key = `${pr}|${id}`
      if (!id || seen.has(key)) continue
      seen.add(key)
      const lines = excelByPo.get(key) || []
      const receiptEvents = receipts.filter(r => upper(r.po) === id)
      const positions = lines.map(excelItemReceiptPosition)
      const full = positions.filter(p => p.kind === 'full').length
      const cancelled = positions.filter(p => p.kind === 'cancelled').length
      const outstanding = positions.filter(p => !['full', 'cancelled'].includes(p.kind)).length
      const excelStatus = !lines.length ? 'No Excel item mapping'
        : outstanding ? `${full} full · ${outstanding} outstanding`
        : cancelled === lines.length ? 'All items cancelled'
        : cancelled ? `${full} full · ${cancelled} cancelled`
        : 'All items fully received'
      output.push({
        po: id, pr, description: h.description || '—',
        supplier: clean(po.PurchName) || lines[0]?.supplier || '—',
        poStatus: clean(po.PurchStatus) || 'Unknown',
        excelStatus, lineCount: lines.length, full, cancelled, outstanding,
        receiptCount: receiptEvents.length,
        latestReceipt: receiptEvents.length ? clean(receiptEvents[receiptEvents.length - 1].createdAt) : '',
        searchItems: lines.map(l => `${l.item_code} ${l.supplier || ''}`).join(' '),
      })
    }
  }
  // Display Excel-only POs as discrepancies rather than silently omitting them.
  for (const [key, lines] of excelByPo) {
    if (seen.has(key)) continue
    const [pr, po] = key.split('|')
    if (!po) continue
    const positions = lines.map(excelItemReceiptPosition)
    const full = positions.filter(p => p.kind === 'full').length
    const cancelled = positions.filter(p => p.kind === 'cancelled').length
    const outstanding = positions.filter(p => !['full', 'cancelled'].includes(p.kind)).length
    output.push({ po, pr, description: headerMap.get(pr)?.description || '—',
      supplier: clean(lines[0]?.supplier) || '—', poStatus: 'Not in Simplix PR detail',
      excelStatus: outstanding ? `${full} full · ${outstanding} outstanding` :
        cancelled === lines.length ? 'All items cancelled' :
        cancelled ? `${full} full · ${cancelled} cancelled` : 'All items fully received',
      lineCount: lines.length, full, cancelled, outstanding, receiptCount: 0,
      latestReceipt: '', searchItems: lines.map(l => l.item_code).join(' ') })
  }
  return { rows: output.sort((a,b) => b.po.localeCompare(a.po)), batch, year, prCount: headers.length }
}

export default function PrPoOrdersTab({ active, selectedYear, refreshKey = 0 }) {
  const [host, setHost] = useState(null)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [poStatus, setPoStatus] = useState('ALL')
  const [receiptFilter, setReceiptFilter] = useState('ALL')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  useEffect(() => { setHost(document.getElementById('prpo-po-host')) }, [])
  useEffect(() => {
    if (!active || !host) return
    let live = true
    setLoading(true); setError('')
    loadOrders(selectedYear).then(result => { if (live) setData(result) })
      .catch(e => { if (live) setError(e?.message || String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [active, host, selectedYear, refreshKey, reload])
  useEffect(() => { setPage(1) }, [query, poStatus, receiptFilter, selectedYear])
  const rows = data?.year === selectedYear ? data.rows : []
  const filtered = useMemo(() => rows.filter(r => {
    const search = upper(query)
    if (search && ![r.po,r.pr,r.description,r.supplier,r.poStatus,r.excelStatus,r.searchItems].some(x => upper(x).includes(search))) return false
    if (poStatus !== 'ALL' && upper(r.poStatus) !== poStatus) return false
    if (receiptFilter === 'FULL' && !(r.lineCount > 0 && r.outstanding === 0 && r.full > 0)) return false
    if (receiptFilter === 'OPEN' && !(r.lineCount > 0 && r.outstanding > 0)) return false
    if (receiptFilter === 'NO_EXCEL' && r.lineCount > 0) return false
    return true
  }), [rows,query,poStatus,receiptFilter])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const visible = filtered.slice((Math.min(page,totalPages)-1)*PAGE_SIZE, Math.min(page,totalPages)*PAGE_SIZE)
  const statusChoices = [...new Set(rows.map(r=>upper(r.poStatus)).filter(Boolean))].sort()
  if (!host) return null
  return createPortal(<section className="potab-shell">
    <div className="potab-header">
      <div><div className="potab-kicker">PURCHASE ORDER TRACKING</div><h3>PO Tracker</h3>
        <p>Each PO is shown separately. Simplix supplies the PO and receipt events; the uploaded Excel tracker confirms item-level received quantities.</p></div>
      <div className="potab-actions"><span className="potab-source">{data?.batch ? `Excel: ${data.batch.source_file}` : 'No Excel mapping uploaded'}</span><button type="button" disabled={loading} onClick={()=>setReload(n=>n+1)}>{loading ? 'Refreshing…' : 'Refresh PO data'}</button></div>
    </div>
    <div className="potab-kpis">
      <div><small>Linked POs</small><strong>{rows.length.toLocaleString()}</strong></div>
      <div><small>POs with Excel item mapping</small><strong>{rows.filter(x=>x.lineCount>0).length.toLocaleString()}</strong></div>
      <div><small>POs with fully received Excel items</small><strong>{rows.filter(x=>x.lineCount>0&&x.full>0&&x.outstanding===0).length.toLocaleString()}</strong></div>
      <div><small>POs requiring item follow-up</small><strong>{rows.filter(x=>x.outstanding>0).length.toLocaleString()}</strong></div>
    </div>
    <div className="potab-filters">
      <label>Search PO, PR, supplier or item<input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="e.g. PO0136287 or 1-0035932" /></label>
      <label>PO status<select value={poStatus} onChange={e=>setPoStatus(e.target.value)}>
        <option value="ALL">All statuses</option>{statusChoices.map(s=><option key={s} value={s}>{s}</option>)}
      </select></label>
      <label>Excel receipt position<select value={receiptFilter} onChange={e=>setReceiptFilter(e.target.value)}>
        <option value="ALL">All positions</option><option value="FULL">Fully received active items</option>
        <option value="OPEN">Outstanding / review</option><option value="NO_EXCEL">No Excel mapping</option>
      </select></label>
      <button type="button" onClick={()=>{setQuery('');setPoStatus('ALL');setReceiptFilter('ALL')}}>Clear filters</button>
    </div>
    {loading && <div className="potab-notice">Loading Simplix POs and Excel receipt mappings…</div>}
    {error && <div className="potab-error" role="alert">PO data could not load: {error}</div>}
    {!loading && !error && <><div className="potab-count">{filtered.length.toLocaleString()} POs match · {selectedYear} · Click a PR number to open its full approval and item details</div>
      <div className="potab-scroll"><table><thead><tr><th>PO Number</th><th>PR Number</th><th>PR Description</th><th>Supplier</th><th>PO Status</th><th>Excel Item Receipt</th><th>Excel Lines</th><th>Simplix Receipt Events</th><th>Latest Receipt Event</th></tr></thead>
      <tbody>{visible.map((r,i)=><tr key={r.pr+'|'+r.po+'|'+i}>
        <td><strong>{r.po}</strong></td><td><button type="button" className="potab-pr-link">{r.pr}</button></td>
        <td>{r.description}</td><td>{r.supplier}</td><td><span className="potab-pill">{r.poStatus}</span></td>
        <td><span className={r.outstanding ? 'potab-balance' : r.full ? 'potab-ok' : 'potab-muted'}>{r.excelStatus}</span></td>
        <td>{r.lineCount || '—'}</td><td>{r.receiptCount}</td><td>{r.latestReceipt || '—'}</td>
      </tr>)}</tbody></table></div>
      {!visible.length && <div className="potab-notice">No purchase orders match these filters.</div>}
      <div className="potab-pager"><span>Showing {visible.length ? (Math.min(page,totalPages)-1)*PAGE_SIZE+1 : 0}–{Math.min(Math.min(page,totalPages)*PAGE_SIZE,filtered.length)} of {filtered.length.toLocaleString()}</span>
        <button type="button" disabled={page<=1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Previous</button>
        <span>Page {Math.min(page,totalPages)} / {totalPages}</span><button type="button" disabled={page>=totalPages} onClick={()=>setPage(p=>Math.min(totalPages,p+1))}>Next</button>
      </div>
    </>}
    <div className="potab-footnote">Excel status reflects recorded receipt quantities per item, not inferred PO-level receipts. Quantities with different units are not added together. POs that exist only in Excel are marked as missing from Simplix PR detail.</div>
    <style>{`
      .potab-shell{margin-top:12px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;color:#0f172a}
      .potab-header{display:flex;justify-content:space-between;gap:16px;align-items:start}.potab-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.potab-actions button{border:1px solid #93c5fd;background:#eff6ff;border-radius:8px;padding:8px 11px;color:#1d4ed8;cursor:pointer;font-size:11px;font-weight:800}.potab-actions button:disabled{opacity:.5}.potab-header h3{font-size:21px;margin:3px 0 5px}.potab-header p{font-size:12px;color:#64748b;margin:0;max-width:750px}.potab-kicker{font-size:10px;letter-spacing:.12em;color:#1d4ed8;font-weight:800}.potab-source{font-size:11px;color:#475569;border-radius:8px;border:1px solid #e2e8f0;padding:7px 10px}
      .potab-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:16px 0}.potab-kpis>div{background:#f8fafc;border:1px solid #dbe5f0;border-radius:10px;padding:12px}.potab-kpis small{display:block;color:#64748b;font-size:10px}.potab-kpis strong{font-size:22px;display:block;margin-top:6px}
      .potab-filters{display:flex;flex-wrap:wrap;gap:10px;align-items:end;margin:10px 0 15px}.potab-filters label{display:flex;flex-direction:column;gap:5px;font-size:10px;color:#64748b;font-weight:800;flex:1 1 160px}.potab-filters label:first-child{flex:2 1 270px}.potab-filters input,.potab-filters select{height:37px;width:100%;padding:7px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#0f172a;font-size:12px}.potab-filters>button,.potab-pager button{background:#fff;border:1px solid #cbd5e1;border-radius:8px;padding:9px 12px;font-size:11px;font-weight:700;cursor:pointer}.potab-pager button:disabled{opacity:.45;cursor:default}
      .potab-scroll{overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px}.potab-scroll table{border-collapse:collapse;width:100%;min-width:1160px;font-size:11px}.potab-scroll th{background:#f1f5f9;color:#64748b;text-transform:uppercase;text-align:left;font-size:10px;white-space:nowrap;padding:11px 10px}.potab-scroll td{border-top:1px solid #eef2f7;padding:11px 10px;vertical-align:middle}.potab-scroll tr:hover td{background:#f8fafc}.potab-pr-link{border:0;background:none;padding:0;color:#1d4ed8;font-weight:800;text-decoration:underline;cursor:pointer}.potab-pill{background:#eff6ff;color:#1e40af;border-radius:20px;padding:4px 7px;white-space:nowrap}.potab-ok{color:#166534;font-weight:700}.potab-balance{color:#b45309;font-weight:700}.potab-muted{color:#64748b}
      .potab-count{font-size:11px;color:#475569;margin:0 0 8px}.potab-pager{display:flex;gap:12px;justify-content:flex-end;align-items:center;margin:13px 0 4px;font-size:11px}.potab-footnote{font-size:10px;color:#64748b;margin-top:14px}.potab-notice{padding:25px;text-align:center;color:#64748b}.potab-error{padding:16px;background:#fee2e2;color:#b91c1c;border-radius:8px}
      @media(max-width:820px){.potab-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.potab-header{flex-direction:column}.potab-source{max-width:100%}}
    `}</style>
  </section>, host)
}
