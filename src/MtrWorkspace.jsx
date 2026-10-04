import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

const clean=(v)=>String(v??'').trim()
const norm=(v)=>clean(v).toLowerCase().replace(/[^a-z0-9]+/g,'')
const num=(v)=>{const n=Number(String(v??'').replace(/,/g,'').replace(/[^0-9.-]/g,''));return Number.isFinite(n)?n:0}
function rawField(row,names=[]){const raw=row?.raw_source;if(!raw||typeof raw!=='object')return '';const entries=Object.entries(raw);for(const name of names){const hit=entries.find(([k])=>norm(k)===norm(name));if(hit&&clean(hit[1])!=='')return hit[1]}return ''}
function pick(row,direct=[],raw=[]){for(const key of direct){const v=row?.[key];if(v!==null&&v!==undefined&&clean(v)!=='')return v}return rawField(row,raw)}
function parseDate(v){if(!v)return null;if(v instanceof Date&&!Number.isNaN(v.valueOf()))return v;const t=clean(v);if(!t)return null;const d=new Date(t);return Number.isNaN(d.valueOf())?null:d}
const fmtDate=(v)=>{const d=parseDate(v);return d?d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}):'—'}
function daysOld(v){const d=parseDate(v);return d?Math.max(0,Math.floor((Date.now()-d.valueOf())/86400000)):null}
function derive(row){
  const requestDate=pick(row,['document_date','request_date'],['Request Date','Request date'])
  const remaining=num(pick(row,['remaining_qty'],['Remaining Quantity','Remaining Qty']))
  const requested=num(pick(row,['requested_qty'],['Requested Quantity','Requested Qty']))
  const transferred=num(pick(row,['transferred_qty'],['Transferred Quantity','Transfered Quantity','Transferred Qty','Transfered Qty']))
  const onHand=num(rawField(row,['Available Physical','Available physical','Warehouse On-Hand','On Hand']))
  const age=daysOld(requestDate)
  let coverage='Completed'
  if(remaining>0){if(onHand>=remaining)coverage='Fully Available';else if(onHand>0)coverage='Partially Available';else coverage='No Stock'}
  let action='No action'
  if(remaining>0&&coverage==='Fully Available')action='Follow up transfer'
  else if(remaining>0&&coverage==='Partially Available')action='Partial transfer / balance pending'
  else if(remaining>0&&coverage==='No Stock')action='Await stock / alternate source'
  const section=clean(rawField(row,['Section','Workshop','Department']))
  return {...row,
    mtrNo:clean(pick(row,['document_no'],['MTR Number','MTR No','MTR'])),lineNo:clean(pick(row,['line_no'],['Line Number','Line No'])),
    prfNo:clean(rawField(row,['PRF Number','PRF No','PRF'])),srNo:clean(rawField(row,['SR Number','SR No','SR/WO','SR / WO'])),section,
    fromWarehouse:clean(rawField(row,['From Warehouse','Warehouse','From']))||'—',note:clean(rawField(row,['Note','Remarks','Remark']))||'—',
    asset:clean(rawField(row,['Asset / Vessel','Asset/Vessel','Asset','Vessel']))||'—',itemCode:clean(pick(row,['item_code'],['Item Number','Item Code','Item ID'])),
    itemName:clean(pick(row,['item_description'],['Item Name','Item Description','Description'])),unit:clean(pick(row,['unit'],['Unit','UOM']))||'—',
    requested,transferred,remaining,requestDate,approvedDate:pick(row,['approved_date'],['Approved Date','Approval Date']),onHand,
    erpStatus:clean(rawField(row,['ERP Status','Status']))||clean(row?.status)||'—',deliveryStatus:clean(rawField(row,['Delivery Status ERP','Delivery Status']))||'—',
    receivedDate:rawField(row,['Received Date','Receipt Date']),toNo:clean(rawField(row,['TO Number','TO No','Transfer Order']))||'—',avgCost:num(rawField(row,['Average Cost','Avg Cost'])),
    age,coverage,action,year:parseDate(requestDate)?.getFullYear()||null,
  }
}
function findMtrPage(){const heading=[...document.querySelectorAll('h1,h2,h3')].find(el=>clean(el.textContent)==='MTR Tracker');if(!heading)return null;const pageHeader=heading.closest('.page-header')||heading.parentElement;const content=pageHeader?.parentElement;if(!pageHeader||!content)return null;return{pageHeader,content}}
function Stat({label,value,helper,tone='',active,onClick}){return <button className={`mtrw-stat ${tone} ${active?'active':''}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{helper}</small></button>}

export default function MtrWorkspace(){
  const [host,setHost]=useState(null),[hidden,setHidden]=useState([]),[rows,setRows]=useState([]),[loading,setLoading]=useState(false)
  const [year,setYear]=useState(String(new Date().getFullYear())),[tab,setTab]=useState('OVERVIEW'),[filter,setFilter]=useState('ALL'),[sectionFilter,setSectionFilter]=useState('')
  const [search,setSearch]=useState(''),[page,setPage]=useState(1),[selectedMtr,setSelectedMtr]=useState('')
  const pageSize=75

  useEffect(()=>{let disposed=false;const setup=()=>{if(disposed)return;if(host&&host.isConnected)return;const info=findMtrPage();if(!info)return;const {pageHeader,content}=info;const el=document.createElement('div');el.className='mtrw-host';pageHeader.insertAdjacentElement('afterend',el);const toHide=[...content.children].filter(c=>c!==pageHeader&&c!==el);toHide.forEach(x=>{x.dataset.mtrwOldDisplay=x.style.display||'';x.style.display='none'});setHidden(toHide);setHost(el)};setup();const id=setInterval(setup,500);return()=>{disposed=true;clearInterval(id)}},[host])
  useEffect(()=>()=>{hidden.forEach(x=>{try{x.style.display=x.dataset.mtrwOldDisplay||''}catch{}})},[hidden])
  useEffect(()=>{if(!host)return;let alive=true;(async()=>{setLoading(true);const all=[];const size=1000;for(let from=0;;from+=size){const {data,error}=await supabase.from('material_records').select('*').eq('document_type','MTR').range(from,from+size-1);if(error){console.error(error);break}all.push(...(data||[]));if(!data||data.length<size)break}if(alive){setRows(all.map(derive));setLoading(false)}})();return()=>{alive=false}},[host])

  const years=useMemo(()=>[...new Set(rows.map(r=>r.year).filter(Boolean))].sort((a,b)=>b-a),[rows])
  useEffect(()=>{if(year!=='ALL'&&years.length&&!years.includes(Number(year)))setYear(String(years[0]))},[years,year])
  const base=useMemo(()=>year==='ALL'?rows:rows.filter(r=>r.year===Number(year)),[rows,year])

  const model=useMemo(()=>{
    const pending=base.filter(r=>r.remaining>0),completed=base.filter(r=>r.remaining<=0),totalMtrs=new Set(base.map(r=>r.mtrNo).filter(Boolean)),pendingMtrs=new Set(pending.map(r=>r.mtrNo).filter(Boolean))
    const age0=pending.filter(r=>(r.age??0)<=30),age31=pending.filter(r=>(r.age??0)>30&&(r.age??0)<=60),age61=pending.filter(r=>(r.age??0)>60&&(r.age??0)<=90),age90=pending.filter(r=>(r.age??0)>90)
    const full=pending.filter(r=>r.coverage==='Fully Available'),partial=pending.filter(r=>r.coverage==='Partially Available'),none=pending.filter(r=>r.coverage==='No Stock')
    const missingSection=pending.filter(r=>!r.section),missingTo=pending.filter(r=>r.toNo==='—'),receivedMissingDate=base.filter(r=>/receiv/i.test(r.deliveryStatus)&&!r.receivedDate)
    const sections=new Map();for(const r of pending){const key=r.section||'Unassigned';if(!sections.has(key))sections.set(key,{section:key,lines:0,mtrs:new Set(),remaining:0});const s=sections.get(key);s.lines++;if(r.mtrNo)s.mtrs.add(r.mtrNo);s.remaining+=r.remaining}
    const monthly=Array.from({length:12},(_,i)=>({month:i,count:0,mtrs:new Set()}));for(const r of base){const d=parseDate(r.requestDate);if(d){const m=monthly[d.getMonth()];m.count++;if(r.mtrNo)m.mtrs.add(r.mtrNo)}}
    return{pending,completed,totalMtrs,pendingMtrs,age0,age31,age61,age90,full,partial,none,missingSection,missingTo,receivedMissingDate,sections:[...sections.values()].sort((a,b)=>b.lines-a.lines),monthly}
  },[base])

  const attention=useMemo(()=>[
    {label:'90+ Days Pending',count:model.age90.length,key:'AGE90',tone:'red'},
    {label:'Fully Available, Not Transferred',count:model.full.length,key:'FULL',tone:'green'},
    {label:'Partial Stock Pending',count:model.partial.length,key:'PARTIAL',tone:'amber'},
    {label:'No Stock',count:model.none.length,key:'NONE',tone:'red'},
    {label:'Missing Section',count:model.missingSection.length,key:'MISSING_SECTION',tone:'amber'},
    {label:'Missing TO Number',count:model.missingTo.length,key:'MISSING_TO',tone:''},
  ],[model])

  const filtered=useMemo(()=>{let list=base
    const map={PENDING:model.pending,AGE0:model.age0,AGE31:model.age31,AGE61:model.age61,AGE90:model.age90,FULL:model.full,PARTIAL:model.partial,NONE:model.none,COMPLETED:model.completed,MISSING_SECTION:model.missingSection,MISSING_TO:model.missingTo}
    if(map[filter])list=map[filter]
    if(sectionFilter)list=list.filter(r=>(r.section||'Unassigned')===sectionFilter)
    const q=norm(search);if(q)list=list.filter(r=>norm([r.mtrNo,r.prfNo,r.srNo,r.section,r.asset,r.fromWarehouse,r.itemCode,r.itemName,r.erpStatus,r.toNo,r.action].join(' ')).includes(q))
    return list
  },[base,model,filter,sectionFilter,search])
  useEffect(()=>setPage(1),[year,filter,sectionFilter,search,tab]);const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));const paged=filtered.slice((page-1)*pageSize,page*pageSize)
  const mtrLines=useMemo(()=>selectedMtr?base.filter(r=>r.mtrNo===selectedMtr):[],[base,selectedMtr])
  const mtrSummary=useMemo(()=>({requested:mtrLines.reduce((a,r)=>a+r.requested,0),transferred:mtrLines.reduce((a,r)=>a+r.transferred,0),remaining:mtrLines.reduce((a,r)=>a+r.remaining,0)}),[mtrLines])

  const filterTitle={ALL:'All MTR lines',PENDING:'Pending MTR lines',AGE0:'0–30 day pending lines',AGE31:'31–60 day pending lines',AGE61:'61–90 day pending lines',AGE90:'90+ day pending lines',FULL:'Fully available pending lines',PARTIAL:'Partial stock pending lines',NONE:'No stock pending lines',COMPLETED:'Completed MTR lines',MISSING_SECTION:'Pending lines missing section',MISSING_TO:'Pending lines missing TO number'}[filter]||'MTR lines'
  if(!host)return null

  return createPortal(<div className="mtrw-shell">
    <div className="mtrw-toolbar"><div><span className="mtrw-eyebrow">MATERIAL TRANSFER REQUESTS</span><h2>MTR Operational Tracker</h2><p>Warehouse availability, ageing, action status and MTR-level follow-up.</p></div><label>Year<select value={year} onChange={e=>setYear(e.target.value)}><option value="ALL">All Years</option>{years.map(y=><option key={y}>{y}</option>)}</select></label></div>
    <div className="mtrw-tabs">{[['OVERVIEW','Overview'],['AGEING','Ageing & Attention'],['DETAILS','MTR Details']].map(([k,l])=><button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}</div>

    {tab==='OVERVIEW'&&<>
      <div className="mtrw-stats"><Stat label="Total MTRs" value={model.totalMtrs.size.toLocaleString()} helper="Unique requests" active={filter==='ALL'} onClick={()=>setFilter('ALL')}/><Stat label="Pending MTRs" value={model.pendingMtrs.size.toLocaleString()} helper="Unique MTRs with open lines" tone="amber" active={filter==='PENDING'} onClick={()=>setFilter('PENDING')}/><Stat label="Pending Lines" value={model.pending.length.toLocaleString()} helper="Individual open material lines" tone="amber" active={filter==='PENDING'} onClick={()=>setFilter('PENDING')}/><Stat label="Completed Lines" value={model.completed.length.toLocaleString()} helper="Remaining qty is zero" onClick={()=>setFilter('COMPLETED')}/></div>
      <div className="mtrw-grid"><section className="mtrw-card"><div className="mtrw-head"><div><span>STOCK COVERAGE</span><h3>Can the warehouse fulfil pending lines?</h3></div></div><div className="mtrw-coverage">{[['Fully Available',model.full.length,'FULL'],['Partially Available',model.partial.length,'PARTIAL'],['No Stock',model.none.length,'NONE']].map(([l,c,k])=><button key={k} onClick={()=>setFilter(k)}><div><span>{l}</span><strong>{c}</strong></div><div className="mtrw-bar"><i style={{width:`${model.pending.length?c/model.pending.length*100:0}%`}}/></div><small>{model.pending.length?(c/model.pending.length*100).toFixed(1):0}%</small></button>)}</div></section>
      <section className="mtrw-card"><div className="mtrw-head"><div><span>SECTION VIEW</span><h3>Pending workload by section</h3></div><small>Click to filter</small></div><div className="mtrw-section-list">{model.sections.slice(0,10).map(s=><button key={s.section} className={sectionFilter===s.section?'active':''} onClick={()=>setSectionFilter(sectionFilter===s.section?'':s.section)}><div><strong>{s.section}</strong><small>{s.mtrs.size} MTRs · {s.lines} lines</small></div><span>{s.remaining.toLocaleString()} qty pending</span></button>)}</div></section></div>
      <section className="mtrw-card"><div className="mtrw-head"><div><span>MONTHLY ACTIVITY</span><h3>MTRs raised by month</h3></div></div><div className="mtrw-months">{model.monthly.map((m,i)=><div key={i}><strong>{new Date(2000,i,1).toLocaleString(undefined,{month:'short'})}</strong><span>{m.mtrs.size}</span><small>{m.count} lines</small></div>)}</div></section>
    </>}

    {tab==='AGEING'&&<>
      <div className="mtrw-stats"><Stat label="0–30 Days" value={model.age0.length} helper="Pending lines" active={filter==='AGE0'} onClick={()=>setFilter('AGE0')}/><Stat label="31–60 Days" value={model.age31.length} helper="Pending lines" tone="amber" active={filter==='AGE31'} onClick={()=>setFilter('AGE31')}/><Stat label="61–90 Days" value={model.age61.length} helper="Pending lines" tone="amber" active={filter==='AGE61'} onClick={()=>setFilter('AGE61')}/><Stat label="90+ Days" value={model.age90.length} helper="Immediate attention" tone="red" active={filter==='AGE90'} onClick={()=>setFilter('AGE90')}/></div>
      <section className="mtrw-card"><div className="mtrw-head"><div><span>ATTENTION NEEDED</span><h3>Operational follow-up</h3></div></div><div className="mtrw-attention">{attention.map(a=><button key={a.key} className={`${a.tone} ${filter===a.key?'active':''}`} onClick={()=>setFilter(a.key)}><span>{a.label}</span><strong>{a.count}</strong></button>)}</div></section>
    </>}

    <section className="mtrw-table-card"><div className="mtrw-table-top"><div><span>MTR DETAIL</span><h3>{filterTitle}{sectionFilter?` · ${sectionFilter}`:''}</h3></div><div className="mtrw-controls">{sectionFilter&&<button onClick={()=>setSectionFilter('')}>Clear section</button>}<input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search MTR, PRF, SR, item, vessel…"/><small>{filtered.length.toLocaleString()} lines</small></div></div>
      <div className="mtrw-table-wrap"><table><thead><tr><th>MTR No.</th><th>PRF No.</th><th>Section</th><th>SR No.</th><th>Asset / Vessel</th><th>Item ID</th><th>Item Description</th><th>Remaining</th><th>Warehouse On-Hand</th><th>Stock Coverage</th><th>Age</th><th>Action Required</th><th>ERP Status</th></tr></thead><tbody>{paged.map((r,i)=><tr key={`${r.mtrNo}-${r.lineNo}-${i}`}><td><button className="mtrw-link" onClick={()=>{setSelectedMtr(r.mtrNo);setTab('DETAILS')}}>{r.mtrNo||'—'}</button></td><td>{r.prfNo||'—'}</td><td>{r.section||'Unassigned'}</td><td>{r.srNo||'—'}</td><td>{r.asset}</td><td>{r.itemCode||'—'}</td><td>{r.itemName||'—'}</td><td>{r.remaining}</td><td>{r.onHand}</td><td><span className={`mtrw-badge ${norm(r.coverage)}`}>{r.coverage}</span></td><td>{r.age??'—'}d</td><td>{r.action}</td><td>{r.erpStatus}</td></tr>)}{!paged.length&&<tr><td colSpan="13">{loading?'Loading MTR data…':'No MTR lines found.'}</td></tr>}</tbody></table></div>
      <div className="mtrw-pager"><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {totalPages}</span><button disabled={page>=totalPages} onClick={()=>setPage(p=>p+1)}>Next</button></div>
    </section>

    {tab==='DETAILS'&&<section className="mtrw-card mtrw-detail"><div className="mtrw-head"><div><span>MTR-LEVEL VIEW</span><h3>{selectedMtr||'Select an MTR from the table'}</h3></div></div>{selectedMtr&&<><div className="mtrw-detail-stats"><div><span>Requested</span><strong>{mtrSummary.requested}</strong></div><div><span>Transferred</span><strong>{mtrSummary.transferred}</strong></div><div><span>Remaining</span><strong>{mtrSummary.remaining}</strong></div><div><span>Lines</span><strong>{mtrLines.length}</strong></div></div><div className="mtrw-table-wrap"><table><thead><tr><th>Line</th><th>Item</th><th>Description</th><th>Requested</th><th>Transferred</th><th>Remaining</th><th>UOM</th><th>From Warehouse</th><th>On-Hand</th><th>TO No.</th><th>Receipt Status</th><th>Received Date</th><th>Note</th><th>Average Cost</th></tr></thead><tbody>{mtrLines.map((r,i)=><tr key={i}><td>{r.lineNo||'—'}</td><td>{r.itemCode||'—'}</td><td>{r.itemName||'—'}</td><td>{r.requested}</td><td>{r.transferred}</td><td>{r.remaining}</td><td>{r.unit}</td><td>{r.fromWarehouse}</td><td>{r.onHand}</td><td>{r.toNo}</td><td>{r.deliveryStatus}</td><td>{fmtDate(r.receivedDate)}</td><td>{r.note}</td><td>{r.avgCost||'—'}</td></tr>)}</tbody></table></div></>}</section>}

    <style>{`
      .mtrw-shell{display:grid;gap:14px}.mtrw-toolbar,.mtrw-card,.mtrw-table-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px}.mtrw-toolbar{padding:16px;display:flex;justify-content:space-between;gap:20px}.mtrw-toolbar h2,.mtrw-head h3,.mtrw-table-top h3{margin:3px 0}.mtrw-toolbar p{margin:0;color:#64748b}.mtrw-eyebrow,.mtrw-head span,.mtrw-table-top>div>span{font-size:11px;font-weight:800;letter-spacing:.08em;color:#2563eb}.mtrw-toolbar label{font-size:11px;font-weight:700}.mtrw-toolbar select{display:block;margin-top:6px;padding:8px 28px 8px 10px;border:1px solid #cbd5e1;border-radius:9px;background:#fff}.mtrw-tabs{display:grid;grid-template-columns:repeat(3,1fr);background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.mtrw-tabs button{padding:12px;border:0;border-right:1px solid #e2e8f0;background:#fff;font-weight:700}.mtrw-tabs button.active{background:#eff6ff;color:#1d4ed8;box-shadow:inset 0 -2px #2563eb}.mtrw-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.mtrw-stat{padding:13px;text-align:left;background:#fff;border:1px solid #dbe4ef;border-top:2px solid #94a3b8;border-radius:11px}.mtrw-stat span{display:block;font-size:10px;font-weight:800;color:#64748b}.mtrw-stat strong{display:block;font-size:25px;margin:5px 0}.mtrw-stat small{color:#64748b}.mtrw-stat.amber{border-top-color:#f59e0b}.mtrw-stat.red{border-top-color:#ef4444}.mtrw-stat.green{border-top-color:#10b981}.mtrw-stat.active{background:#eff6ff;border-color:#60a5fa}.mtrw-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.mtrw-card{padding:12px}.mtrw-head,.mtrw-table-top{display:flex;justify-content:space-between;align-items:center;gap:12px}.mtrw-coverage{display:grid;gap:8px;margin-top:10px}.mtrw-coverage button{padding:10px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;text-align:left}.mtrw-coverage button>div:first-child{display:flex;justify-content:space-between}.mtrw-bar{height:5px;background:#e2e8f0;border-radius:9px;margin:7px 0}.mtrw-bar i{display:block;height:100%;background:#3b82f6;border-radius:9px}.mtrw-section-list{display:grid;margin-top:8px}.mtrw-section-list button{display:flex;justify-content:space-between;align-items:center;padding:8px;border:0;border-bottom:1px solid #eef2f7;background:#fff;text-align:left}.mtrw-section-list button.active{background:#eff6ff}.mtrw-section-list small{display:block;color:#64748b}.mtrw-months{display:grid;grid-template-columns:repeat(12,1fr);gap:6px;margin-top:10px}.mtrw-months div{padding:10px;border:1px solid #e2e8f0;border-radius:9px;text-align:center}.mtrw-months span{display:block;font-size:20px;font-weight:800}.mtrw-months small{color:#64748b}.mtrw-attention{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.mtrw-attention button{padding:13px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;text-align:left}.mtrw-attention button strong{float:right;font-size:18px}.mtrw-attention button.active{background:#eff6ff;border-color:#60a5fa}.mtrw-attention button.red{border-left:3px solid #ef4444}.mtrw-attention button.amber{border-left:3px solid #f59e0b}.mtrw-attention button.green{border-left:3px solid #10b981}.mtrw-table-card{overflow:hidden}.mtrw-table-top{padding:12px}.mtrw-controls{display:flex;gap:8px;align-items:center}.mtrw-controls input{min-width:270px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px}.mtrw-controls button{padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;background:#fff}.mtrw-table-wrap{overflow:auto;max-height:520px}.mtrw-table-wrap table{width:100%;border-collapse:collapse;min-width:1350px}.mtrw-table-wrap th,.mtrw-table-wrap td{padding:8px 9px;border-top:1px solid #eef2f7;text-align:left;white-space:nowrap;font-size:12px}.mtrw-table-wrap th{position:sticky;top:0;background:#f8fafc;z-index:1;font-size:10px;text-transform:uppercase;color:#475569}.mtrw-link{border:0;background:none;color:#1d4ed8;font-weight:800;padding:0}.mtrw-badge{padding:3px 7px;border-radius:99px;background:#f1f5f9}.mtrw-badge.fullyavailable{background:#dcfce7;color:#166534}.mtrw-badge.partiallyavailable{background:#fef3c7;color:#92400e}.mtrw-badge.nostock{background:#fee2e2;color:#991b1b}.mtrw-pager{display:flex;justify-content:flex-end;gap:8px;align-items:center;padding:10px}.mtrw-pager button{padding:7px 10px;border:1px solid #cbd5e1;background:#fff;border-radius:8px}.mtrw-detail-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}.mtrw-detail-stats div{padding:12px;border:1px solid #e2e8f0;border-radius:9px}.mtrw-detail-stats span{display:block;color:#64748b;font-size:11px}.mtrw-detail-stats strong{font-size:22px}@media(max-width:1000px){.mtrw-stats,.mtrw-detail-stats{grid-template-columns:repeat(2,1fr)}.mtrw-grid{grid-template-columns:1fr}.mtrw-months{grid-template-columns:repeat(6,1fr)}.mtrw-attention{grid-template-columns:repeat(2,1fr)}}
    `}</style>
  </div>,host)
}
