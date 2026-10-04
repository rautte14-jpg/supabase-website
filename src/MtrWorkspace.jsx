import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const norm = (v) => clean(v).toLowerCase().replace(/[^a-z0-9]+/g, '')
const num = (v) => {
  const n = Number(String(v ?? '').replace(/,/g, '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

function rawField(row, names = []) {
  const raw = row?.raw_source
  if (!raw || typeof raw !== 'object') return ''
  const entries = Object.entries(raw)
  for (const name of names) {
    const wanted = norm(name)
    const hit = entries.find(([key]) => norm(key) === wanted)
    if (hit && clean(hit[1]) !== '') return hit[1]
  }
  return ''
}

function pick(row, directKeys = [], rawNames = []) {
  for (const key of directKeys) {
    const value = row?.[key]
    if (value !== null && value !== undefined && clean(value) !== '') return value
  }
  return rawField(row, rawNames)
}

function parseDate(value) {
  if (!value) return null
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value
  const text = clean(value)
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) {
    const d = new Date(`${iso[1]}-${String(iso[2]).padStart(2,'0')}-${String(iso[3]).padStart(2,'0')}T12:00:00`)
    return Number.isNaN(d.valueOf()) ? null : d
  }
  const named = text.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2}|\d{4})/)
  if (named) {
    const months = {jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11}
    const m = months[named[2].toLowerCase()]
    let y = Number(named[3]); if (y < 100) y += 2000
    if (m !== undefined) return new Date(y, m, Number(named[1]), 12)
  }
  const d = new Date(text)
  return Number.isNaN(d.valueOf()) ? null : d
}

const fmtDate = (v) => {
  const d = parseDate(v)
  return d ? d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}) : '—'
}

function daysOld(v) {
  const d = parseDate(v)
  if (!d) return null
  return Math.max(0, Math.floor((Date.now() - d.valueOf()) / 86400000))
}

function derive(row) {
  const requestDate = pick(row,['document_date','request_date'],['Request Date','Request date'])
  const remaining = num(pick(row,['remaining_qty'],['Remaining Quantity','Remaining Qty']))
  const requested = num(pick(row,['requested_qty'],['Requested Quantity','Requested Qty']))
  const transferred = num(pick(row,['transferred_qty'],['Transferred Quantity','Transfered Quantity','Transferred Qty','Transfered Qty']))
  const onHand = num(rawField(row,['Available Physical','Available physical','Warehouse On-Hand','On Hand']))
  const age = daysOld(requestDate)
  let coverage = 'Completed'
  if (remaining > 0) {
    if (onHand >= remaining) coverage = 'Fully Available'
    else if (onHand > 0) coverage = 'Partially Available'
    else coverage = 'No Stock'
  }
  return {
    ...row,
    mtrNo: clean(pick(row,['document_no'],['MTR Number','MTR No','MTR'])),
    lineNo: clean(pick(row,['line_no'],['Line Number','Line No'])),
    prfNo: clean(rawField(row,['PRF Number','PRF No','PRF'])),
    srNo: clean(rawField(row,['SR Number','SR No','SR/WO','SR / WO'])),
    section: clean(rawField(row,['Section','Workshop','Department'])),
    fromWarehouse: clean(rawField(row,['From Warehouse','Warehouse','From'])) || '—',
    note: clean(rawField(row,['Note','Remarks','Remark'])) || '—',
    asset: clean(rawField(row,['Asset / Vessel','Asset/Vessel','Asset','Vessel'])) || '—',
    itemCode: clean(pick(row,['item_code'],['Item Number','Item Code','Item ID'])),
    itemName: clean(pick(row,['item_description'],['Item Name','Item Description','Description'])),
    unit: clean(pick(row,['unit'],['Unit','UOM'])) || '—',
    requested,
    transferred,
    remaining,
    requestDate,
    approvedDate: pick(row,['approved_date'],['Approved Date','Approval Date']),
    onHand,
    erpStatus: clean(rawField(row,['ERP Status','Status'])) || clean(row?.status) || '—',
    deliveryStatus: clean(rawField(row,['Delivery Status ERP','Delivery Status'])) || '—',
    receivedDate: rawField(row,['Received Date','Receipt Date']),
    toNo: clean(rawField(row,['TO Number','TO No','Transfer Order'])) || '—',
    avgCost: num(rawField(row,['Average Cost','Avg Cost'])),
    age,
    coverage,
    year: parseDate(requestDate)?.getFullYear() || null,
  }
}

function findMtrPage(){
  const heading=[...document.querySelectorAll('h1,h2,h3')].find((el)=>clean(el.textContent)==='MTR Tracker')
  if(!heading) return null
  const pageHeader=heading.closest('.page-header') || heading.parentElement
  const content=pageHeader?.parentElement
  if(!pageHeader || !content) return null
  return {heading,pageHeader,content}
}

function Stat({label,value,helper,tone='',active,onClick}){
  return <button className={`mtrw-stat ${tone} ${active?'active':''}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{helper}</small></button>
}

export default function MtrWorkspace(){
  const [host,setHost]=useState(null)
  const [hidden,setHidden]=useState([])
  const [rows,setRows]=useState([])
  const [loading,setLoading]=useState(false)
  const [year,setYear]=useState(String(new Date().getFullYear()))
  const [filter,setFilter]=useState('ALL')
  const [search,setSearch]=useState('')
  const [page,setPage]=useState(1)
  const pageSize=75

  useEffect(()=>{
    let disposed=false
    const setup=()=>{
      if(disposed) return
      if(host && host.isConnected) return
      const pageInfo=findMtrPage()
      if(!pageInfo) return
      const {pageHeader,content}=pageInfo
      const el=document.createElement('div')
      el.className='mtrw-host'
      pageHeader.insertAdjacentElement('afterend',el)
      const toHide=[...content.children].filter((child)=>child!==pageHeader && child!==el)
      toHide.forEach((x)=>{ x.dataset.mtrwOldDisplay=x.style.display||''; x.style.display='none' })
      setHidden(toHide)
      setHost(el)
    }
    setup()
    const id=setInterval(setup,500)
    return()=>{disposed=true;clearInterval(id)}
  },[host])

  useEffect(()=>()=>{
    hidden.forEach((x)=>{ try{x.style.display=x.dataset.mtrwOldDisplay||''}catch{} })
  },[hidden])

  useEffect(()=>{
    if(!host) return
    let alive=true
    async function load(){
      setLoading(true)
      const all=[]
      const size=1000
      for(let from=0;;from+=size){
        const {data,error}=await supabase.from('material_records').select('*').eq('document_type','MTR').range(from,from+size-1)
        if(error){ console.error('MTR load failed',error); break }
        all.push(...(data||[]))
        if(!data || data.length<size) break
      }
      if(alive){ setRows(all.map(derive)); setLoading(false) }
    }
    load()
    return()=>{alive=false}
  },[host])

  const years=useMemo(()=>{
    const set=new Set(rows.map((r)=>r.year).filter(Boolean))
    return [...set].sort((a,b)=>b-a)
  },[rows])

  useEffect(()=>{
    if(year!=='ALL' && years.length && !years.includes(Number(year))) setYear(String(years[0]))
  },[years,year])

  const base=useMemo(()=> year==='ALL' ? rows : rows.filter((r)=>r.year===Number(year)),[rows,year])
  const model=useMemo(()=>{
    const pendingLines=base.filter((r)=>r.remaining>0)
    const pendingMtrs=new Set(pendingLines.map((r)=>r.mtrNo).filter(Boolean))
    const totalMtrs=new Set(base.map((r)=>r.mtrNo).filter(Boolean))
    const aged30=pendingLines.filter((r)=>(r.age??0)>=30)
    const full=pendingLines.filter((r)=>r.coverage==='Fully Available')
    const partial=pendingLines.filter((r)=>r.coverage==='Partially Available')
    const none=pendingLines.filter((r)=>r.coverage==='No Stock')
    const completed=base.filter((r)=>r.remaining<=0)
    const sections=new Map()
    for(const r of pendingLines){
      const key=r.section||'Unassigned'
      if(!sections.has(key)) sections.set(key,{section:key,lines:0,mtrs:new Set(),remaining:0,full:0,partial:0,none:0})
      const s=sections.get(key); s.lines++; if(r.mtrNo) s.mtrs.add(r.mtrNo); s.remaining+=r.remaining
      if(r.coverage==='Fully Available') s.full++
      else if(r.coverage==='Partially Available') s.partial++
      else if(r.coverage==='No Stock') s.none++
    }
    return {pendingLines,pendingMtrs,totalMtrs,aged30,full,partial,none,completed,sections:[...sections.values()].sort((a,b)=>b.lines-a.lines)}
  },[base])

  const filtered=useMemo(()=>{
    let list=base
    if(filter==='PENDING') list=model.pendingLines
    else if(filter==='30') list=model.aged30
    else if(filter==='FULL') list=model.full
    else if(filter==='PARTIAL') list=model.partial
    else if(filter==='NONE') list=model.none
    else if(filter==='COMPLETED') list=model.completed
    const q=norm(search)
    if(q) list=list.filter((r)=>norm([r.mtrNo,r.prfNo,r.srNo,r.section,r.asset,r.fromWarehouse,r.itemCode,r.itemName,r.erpStatus,r.toNo].join(' ')).includes(q))
    return list
  },[base,model,filter,search])

  useEffect(()=>setPage(1),[year,filter,search])
  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize))
  const paged=filtered.slice((page-1)*pageSize,page*pageSize)

  if(!host) return null
  return createPortal(<div className="mtrw-shell">
    <div className="mtrw-toolbar">
      <div><span className="mtrw-eyebrow">MATERIAL TRANSFER REQUESTS</span><h2>MTR Operational Tracker</h2><p>Warehouse availability, outstanding quantities and ageing by request year.</p></div>
      <label>Year<select value={year} onChange={(e)=>setYear(e.target.value)}><option value="ALL">All Years</option>{years.map((y)=><option key={y} value={y}>{y}</option>)}</select></label>
    </div>

    <div className="mtrw-stats">
      <Stat label="Total MTRs" value={model.totalMtrs.size.toLocaleString()} helper="Unique MTRs in selected year" active={filter==='ALL'} onClick={()=>setFilter('ALL')}/>
      <Stat label="Pending MTRs" value={model.pendingMtrs.size.toLocaleString()} helper="MTRs with remaining quantity" tone="amber" active={filter==='PENDING'} onClick={()=>setFilter('PENDING')}/>
      <Stat label="Pending Lines" value={model.pendingLines.length.toLocaleString()} helper="Open material lines" tone="amber" active={filter==='PENDING'} onClick={()=>setFilter('PENDING')}/>
      <Stat label="30+ Days Pending" value={model.aged30.length.toLocaleString()} helper="Based on request date" tone="red" active={filter==='30'} onClick={()=>setFilter('30')}/>
      <Stat label="Fully Available" value={model.full.length.toLocaleString()} helper="Warehouse stock covers balance" tone="green" active={filter==='FULL'} onClick={()=>setFilter('FULL')}/>
      <Stat label="Partial Stock" value={model.partial.length.toLocaleString()} helper="Some warehouse stock available" tone="amber" active={filter==='PARTIAL'} onClick={()=>setFilter('PARTIAL')}/>
      <Stat label="No Stock" value={model.none.length.toLocaleString()} helper="No warehouse physical stock" tone="red" active={filter==='NONE'} onClick={()=>setFilter('NONE')}/>
      <Stat label="Completed Lines" value={model.completed.length.toLocaleString()} helper="Remaining quantity is zero" active={filter==='COMPLETED'} onClick={()=>setFilter('COMPLETED')}/>
    </div>

    <div className="mtrw-grid">
      <section className="mtrw-card">
        <div className="mtrw-head"><div><span>STOCK COVERAGE</span><h3>Can the warehouse fulfil pending lines?</h3></div><small>{model.pendingLines.length.toLocaleString()} pending lines</small></div>
        <div className="mtrw-coverage">
          {[['Fully Available',model.full.length,'FULL'],['Partially Available',model.partial.length,'PARTIAL'],['No Stock',model.none.length,'NONE']].map(([label,count,key])=>{
            const pct=model.pendingLines.length ? (count/model.pendingLines.length)*100 : 0
            return <button key={key} onClick={()=>setFilter(key)}><div><span>{label}</span><strong>{count.toLocaleString()}</strong></div><div className="mtrw-bar"><i style={{width:`${pct}%`}}/></div><small>{pct.toFixed(1)}%</small></button>
          })}
        </div>
      </section>
      <section className="mtrw-card">
        <div className="mtrw-head"><div><span>SECTION VIEW</span><h3>Pending workload by section</h3></div><small>Top sections</small></div>
        <div className="mtrw-section-list">{model.sections.slice(0,8).map((s)=><div key={s.section}><div><strong>{s.section}</strong><small>{s.mtrs.size} MTRs · {s.lines} lines</small></div><span>{s.remaining.toLocaleString()} qty pending</span></div>)}{!model.sections.length&&<p className="mtrw-empty">No pending section data.</p>}</div>
      </section>
    </div>

    <section className="mtrw-table-card">
      <div className="mtrw-table-top">
        <div><span>MTR DETAIL</span><h3>{filter==='ALL'?'All MTR lines':filter==='PENDING'?'Pending MTR lines':filter==='30'?'30+ day pending lines':filter==='FULL'?'Pending lines with full stock':filter==='PARTIAL'?'Pending lines with partial stock':filter==='NONE'?'Pending lines with no stock':'Completed MTR lines'}</h3></div>
        <div className="mtrw-controls"><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="Search MTR, PRF, SR, item, vessel…"/><small>{filtered.length.toLocaleString()} lines</small></div>
      </div>
      <div className="mtrw-table-wrap"><table><thead><tr><th>MTR No.</th><th>PRF No.</th><th>Section</th><th>SR No.</th><th>Asset / Vessel</th><th>From Warehouse</th><th>Item ID</th><th>Item Description</th><th>Requested</th><th>Transferred</th><th>Remaining</th><th>UOM</th><th>Warehouse On-Hand</th><th>Stock Coverage</th><th>Request Date</th><th>Approved Date</th><th>Age</th><th>ERP Status</th><th>Receipt Status</th><th>TO No.</th></tr></thead><tbody>{paged.map((r,i)=><tr key={`${r.mtrNo}-${r.lineNo}-${r.itemCode}-${i}`}><td><strong>{r.mtrNo||'—'}</strong></td><td>{r.prfNo||'—'}</td><td>{r.section||'—'}</td><td>{r.srNo||'—'}</td><td>{r.asset}</td><td>{r.fromWarehouse}</td><td>{r.itemCode||'—'}</td><td className="mtrw-desc">{r.itemName||'—'}</td><td>{r.requested.toLocaleString()}</td><td>{r.transferred.toLocaleString()}</td><td><strong>{r.remaining.toLocaleString()}</strong></td><td>{r.unit}</td><td>{r.onHand.toLocaleString()}</td><td><span className={`mtrw-pill ${r.coverage==='Fully Available'?'ok':r.coverage==='Partially Available'?'warn':r.coverage==='No Stock'?'bad':'done'}`}>{r.coverage}</span></td><td>{fmtDate(r.requestDate)}</td><td>{fmtDate(r.approvedDate)}</td><td><span className={`mtrw-age ${(r.age??0)>=60?'bad':(r.age??0)>=30?'warn':''}`}>{r.age==null?'—':`${r.age}d`}</span></td><td>{r.erpStatus}</td><td>{r.deliveryStatus}</td><td>{r.toNo}</td></tr>)}{!paged.length&&<tr><td colSpan="20" className="mtrw-empty">{loading?'Loading MTR data…':'No MTR records in this view.'}</td></tr>}</tbody></table></div>
      <div className="mtrw-pager"><button disabled={page<=1} onClick={()=>setPage((p)=>Math.max(1,p-1))}>Previous</button><span>Page {page} of {totalPages}</span><button disabled={page>=totalPages} onClick={()=>setPage((p)=>Math.min(totalPages,p+1))}>Next</button></div>
    </section>

    <style>{`
      .mtrw-shell{display:grid;gap:14px}.mtrw-toolbar{display:flex;justify-content:space-between;align-items:flex-end;gap:18px;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px 18px}.mtrw-eyebrow,.mtrw-head span,.mtrw-table-top>div>span{font-size:9px;font-weight:850;letter-spacing:.12em;color:#2563eb}.mtrw-toolbar h2{font-size:20px;margin:4px 0;color:#0f172a}.mtrw-toolbar p{margin:0;color:#64748b;font-size:12px}.mtrw-toolbar label{display:grid;gap:6px;font-size:10px;font-weight:800;color:#64748b;text-transform:uppercase}.mtrw-toolbar select{min-width:130px;padding:9px 10px}.mtrw-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.mtrw-stat{text-align:left;background:#fff;border:1px solid #e2e8f0;border-top:3px solid #cbd5e1;border-radius:12px;padding:13px;min-height:104px}.mtrw-stat.amber{border-top-color:#f59e0b}.mtrw-stat.red{border-top-color:#ef4444}.mtrw-stat.green{border-top-color:#10b981}.mtrw-stat.active{background:#eff6ff;border-color:#93c5fd}.mtrw-stat span{display:block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#64748b}.mtrw-stat strong{display:block;font-size:22px;margin:9px 0 5px;color:#0f172a}.mtrw-stat small{font-size:10px;color:#64748b}.mtrw-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.mtrw-card,.mtrw-table-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.mtrw-head,.mtrw-table-top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:14px 16px;border-bottom:1px solid #e2e8f0}.mtrw-head h3,.mtrw-table-top h3{font-size:14px;margin:3px 0 0;color:#0f172a}.mtrw-head small{color:#64748b}.mtrw-coverage{padding:12px 14px;display:grid;gap:9px}.mtrw-coverage button{border:1px solid #e2e8f0;background:#f8fafc;border-radius:10px;padding:10px;text-align:left}.mtrw-coverage button>div:first-child{display:flex;justify-content:space-between}.mtrw-coverage span{font-size:10px;color:#475569}.mtrw-coverage strong{font-size:15px}.mtrw-bar{height:7px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin:8px 0 5px}.mtrw-bar i{display:block;height:100%;background:#3b82f6;border-radius:999px}.mtrw-coverage small{color:#64748b}.mtrw-section-list{padding:8px 14px}.mtrw-section-list>div{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9}.mtrw-section-list strong,.mtrw-section-list small{display:block}.mtrw-section-list strong{font-size:11px}.mtrw-section-list small,.mtrw-section-list span{font-size:9px;color:#64748b}.mtrw-controls{display:flex;align-items:center;gap:10px}.mtrw-controls input{width:290px;padding:8px 10px;font-size:11px}.mtrw-controls small{white-space:nowrap;color:#64748b}.mtrw-table-wrap{overflow:auto;max-height:620px}.mtrw-table-wrap table{width:100%;border-collapse:collapse;font-size:9px;min-width:2100px}.mtrw-table-wrap th{position:sticky;top:0;background:#f8fafc;z-index:2;text-align:left;padding:8px 9px;border-bottom:1px solid #e2e8f0;color:#64748b;text-transform:uppercase;white-space:nowrap}.mtrw-table-wrap td{padding:8px 9px;border-bottom:1px solid #f1f5f9;color:#334155;white-space:nowrap;vertical-align:top}.mtrw-table-wrap td.mtrw-desc{white-space:normal;min-width:250px;max-width:360px}.mtrw-pill,.mtrw-age{display:inline-flex;padding:3px 7px;border-radius:999px;background:#f1f5f9;font-size:8px;font-weight:800}.mtrw-pill.ok{background:#dcfce7;color:#166534}.mtrw-pill.warn,.mtrw-age.warn{background:#fef3c7;color:#92400e}.mtrw-pill.bad,.mtrw-age.bad{background:#fee2e2;color:#b91c1c}.mtrw-pill.done{background:#e2e8f0;color:#475569}.mtrw-empty{text-align:center;padding:24px!important;color:#94a3b8}.mtrw-pager{display:flex;justify-content:flex-end;align-items:center;gap:10px;padding:10px 14px;border-top:1px solid #e2e8f0}.mtrw-pager button{border:1px solid #dbe3ed;background:#fff;border-radius:8px;padding:7px 10px;font-size:10px}.mtrw-pager span{font-size:10px;color:#64748b}@media(max-width:1100px){.mtrw-stats{grid-template-columns:repeat(2,1fr)}.mtrw-grid{grid-template-columns:1fr}}@media(max-width:700px){.mtrw-toolbar{align-items:stretch;flex-direction:column}.mtrw-stats{grid-template-columns:1fr}.mtrw-table-top{flex-direction:column}.mtrw-controls{width:100%}.mtrw-controls input{width:100%}}
    `}</style>
  </div>,host)
}
