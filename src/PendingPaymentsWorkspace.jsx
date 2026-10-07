import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const lower = (v) => clean(v).toLowerCase()
const money = (v) => `MVR ${Number(v || 0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`

function parseDate(v){ const d=v?new Date(v):null; return d && !Number.isNaN(d.valueOf()) ? d : null }
function ageDays(v){ const d=parseDate(v); return d ? Math.max(0,Math.floor((Date.now()-d.valueOf())/86400000)) : null }
function urgent(r){ return /(urgent|critical|high)/i.test(clean(r.priority)) }
function bucket(age){ if(age==null) return 'Unknown'; if(age<=14) return '0–14 days'; if(age<=30) return '15–30 days'; if(age<=60) return '31–60 days'; return '60+ days' }
function actionText(r){ const s=lower(r.status); if(urgent(r)) return 'Urgent follow-up'; if(s.includes('advance')) return 'Follow up advance / Finance'; if(s.includes('hold')) return 'Resolve hold before payment'; if(s.includes('credit')) return 'Awaiting credit payment'; return 'Follow up payment status' }

function findPage(){
  const title=[...document.querySelectorAll('h1,h2,h3')].find((el)=>clean(el.textContent)==='Pending Payments')
  if(!title) return null
  const root=title.parentElement?.parentElement || title.parentElement
  if(!root) return null
  const metric=[...root.querySelectorAll('.metric-grid')][0] || [...document.querySelectorAll('.metric-grid')].find((el)=>el.compareDocumentPosition(title)&Node.DOCUMENT_POSITION_PRECEDING)
  const listLeaf=[...document.querySelectorAll('body *')].find((el)=>el.children.length===0 && clean(el.textContent).toUpperCase().includes('PROCUREMENT · PENDING PAYMENT LIST'))
  const listSection=listLeaf?.closest('section') || null
  return { title, root, metric, listSection }
}

function Tab({id,active,setActive,children}){ return <button className={`ppw-tab ${active===id?'active':''}`} onClick={()=>setActive(id)}>{children}</button> }
function Stat({label,value,helper,tone='',onClick,active=false}){ return <button className={`ppw-stat ${tone} ${active?'active':''}`} onClick={onClick}><span>{label}</span><strong>{value}</strong><small>{helper}</small></button> }

export default function PendingPaymentsWorkspace(){
  const [host,setHost]=useState(null)
  const [hidden,setHidden]=useState([])
  const [rows,setRows]=useState([])
  const [active,setActive]=useState('overview')
  const [filter,setFilter]=useState('ALL')
  const [loading,setLoading]=useState(false)

  useEffect(()=>{
    const el=document.getElementById('pending-payments-workspace-host')
    const base=document.getElementById('pending-payments-base')
    if(!el) return
    if(base) base.style.display='none'
    setHidden(base?[base]:[])
    setHost(el)
    return()=>{ if(base?.isConnected) base.style.display='' }
  },[])

  useEffect(()=>{
    if(!host) return
    let alive=true
    let refreshTimer=null
    async function load(){
      if(!alive) return
      setLoading(true)
      const {data,error}=await supabase.from('current_pending_payment_records').select('po_no,po_date,supplier,status,priority,po_value').order('po_date',{ascending:false})
      if(alive){ if(!error) setRows(data||[]); setLoading(false) }
    }
    const scheduleLoad=()=>{
      window.clearTimeout(refreshTimer)
      refreshTimer=window.setTimeout(load,250)
    }
    load()
    const channel=supabase
      .channel('pending-payments-workspace-live')
      .on('postgres_changes',{event:'*',schema:'public',table:'pending_payment_records'},scheduleLoad)
      .on('postgres_changes',{event:'*',schema:'public',table:'procurement_records'},scheduleLoad)
      .subscribe()
    return()=>{
      alive=false
      window.clearTimeout(refreshTimer)
      supabase.removeChannel(channel)
    }
  },[host])

  const model=useMemo(()=>{
    const enriched=rows.map((r)=>({...r,age:ageDays(r.po_date),bucket:bucket(ageDays(r.po_date)),action:actionText(r)}))
    const status=(name)=>enriched.filter((r)=>lower(r.status)===lower(name))
    const supplierMap=new Map()
    for(const r of enriched){ const k=clean(r.supplier)||'Unknown'; if(!supplierMap.has(k)) supplierMap.set(k,{supplier:k,count:0,value:0,urgent:0}); const x=supplierMap.get(k); x.count++; x.value+=Number(r.po_value||0); if(urgent(r)) x.urgent++ }
    const suppliers=[...supplierMap.values()].sort((a,b)=>b.value-a.value)
    const buckets=['0–14 days','15–30 days','31–60 days','60+ days'].map((name)=>{ const list=enriched.filter((r)=>r.bucket===name); return {name,count:list.length,value:list.reduce((s,r)=>s+Number(r.po_value||0),0),rows:list} })
    return {
      enriched,
      totalValue:enriched.reduce((s,r)=>s+Number(r.po_value||0),0),
      urgentRows:enriched.filter(urgent),
      advance:status('Advance Pending'), credit:status('Credit'), creditHold:status('Credit on Hold'),
      d30:enriched.filter((r)=>(r.age??-1)>30), d60:enriched.filter((r)=>(r.age??-1)>60), suppliers,buckets,
    }
  },[rows])

  const visible=useMemo(()=>{
    let list=model.enriched
    if(filter==='URGENT') list=model.urgentRows
    else if(filter==='ADVANCE') list=model.advance
    else if(filter==='CREDIT') list=model.credit
    else if(filter==='HOLD') list=model.creditHold
    else if(filter==='30') list=model.d30
    else if(filter==='60') list=model.d60
    return list
  },[model,filter])

  const urgentVisible=useMemo(()=>{
    if(filter==='URGENT') return model.urgentRows
    if(filter==='ADVANCE') return model.advance
    if(filter==='HOLD') return model.creditHold
    return [...new Map([...model.urgentRows,...model.advance,...model.creditHold].map((r)=>[r.po_no,r])).values()]
  },[model,filter])

  const urgentTitle = filter==='URGENT' ? 'Urgent pending payment POs' : filter==='ADVANCE' ? 'Advance Pending POs' : filter==='HOLD' ? 'Credit on Hold POs' : 'Urgent and hold follow-up'

  if(!host) return null
  return createPortal(<div className="ppw-shell">
    <div className="ppw-tabs"><Tab id="overview" active={active} setActive={setActive}>Overview</Tab><Tab id="ageing" active={active} setActive={setActive}>Ageing</Tab><Tab id="supplier" active={active} setActive={setActive}>Supplier View</Tab><Tab id="urgent" active={active} setActive={setActive}>Urgent / Hold</Tab></div>

    {active==='overview' && <>
      <div className="ppw-stats">
        <Stat label="Total Pending POs" value={model.enriched.length.toLocaleString()} helper="Current uploaded payment list" active={filter==='ALL'} onClick={()=>setFilter('ALL')}/>
        <Stat label="Total Pending Value" value={money(model.totalValue)} helper="Open PO value" active={filter==='ALL'} onClick={()=>setFilter('ALL')}/>
        <Stat label="Advance Pending" value={model.advance.length.toLocaleString()} helper="Advance payment cases" tone="amber" active={filter==='ADVANCE'} onClick={()=>setFilter('ADVANCE')}/>
        <Stat label="Credit" value={model.credit.length.toLocaleString()} helper="Credit payment cases" active={filter==='CREDIT'} onClick={()=>setFilter('CREDIT')}/>
        <Stat label="Credit on Hold" value={model.creditHold.length.toLocaleString()} helper="Held payment cases" tone="red" active={filter==='HOLD'} onClick={()=>setFilter('HOLD')}/>
        <Stat label="Urgent" value={model.urgentRows.length.toLocaleString()} helper="Urgent / high priority" tone="red" active={filter==='URGENT'} onClick={()=>setFilter('URGENT')}/>
        <Stat label="30+ Days Pending" value={model.d30.length.toLocaleString()} helper="Based on PO date" tone="amber" active={filter==='30'} onClick={()=>setFilter('30')}/>
        <Stat label="60+ Days Pending" value={model.d60.length.toLocaleString()} helper="Oldest payment exposure" tone="red" active={filter==='60'} onClick={()=>setFilter('60')}/>
      </div>
      <PaymentTable rows={visible} loading={loading} title={filter==='ALL'?'All pending payment POs':filter==='URGENT'?'Urgent pending payment POs':filter==='ADVANCE'?'Advance Pending POs':filter==='CREDIT'?'Credit POs':filter==='HOLD'?'Credit on Hold POs':filter==='30'?'30+ day pending POs':'60+ day pending POs'} />
    </>}

    {active==='ageing' && <div className="ppw-card"><div className="ppw-head"><div><span>PAYMENT AGEING</span><h3>Pending value by age</h3></div><small>Age measured from PO date</small></div><div className="ppw-age-grid">{model.buckets.map((b)=><button key={b.name} onClick={()=>{setActive('overview');setFilter(b.name==='31–60 days'?'30':b.name==='60+ days'?'60':'ALL')}}><span>{b.name}</span><strong>{b.count} POs</strong><em>{money(b.value)}</em></button>)}</div><div className="ppw-bars">{model.buckets.map((b)=>{const max=Math.max(...model.buckets.map(x=>x.value),1); return <div key={b.name}><span>{b.name}</span><div><i style={{width:`${Math.max(2,(b.value/max)*100)}%`}}/></div><strong>{money(b.value)}</strong></div>})}</div></div>}

    {active==='supplier' && <div className="ppw-card"><div className="ppw-head"><div><span>SUPPLIER EXPOSURE</span><h3>Pending payments by supplier</h3></div><small>{model.suppliers.length} suppliers</small></div><div className="ppw-supplier-wrap"><table><thead><tr><th>Supplier</th><th>Pending POs</th><th>Urgent</th><th>Pending Value</th></tr></thead><tbody>{model.suppliers.map((s)=><tr key={s.supplier}><td><strong>{s.supplier}</strong></td><td>{s.count}</td><td>{s.urgent}</td><td>{money(s.value)}</td></tr>)}</tbody></table></div></div>}

    {active==='urgent' && <><div className="ppw-focus"><Stat label="Urgent" value={model.urgentRows.length} helper="Priority follow-up" tone="red" active={filter==='URGENT'} onClick={()=>setFilter(filter==='URGENT'?'ALL':'URGENT')}/><Stat label="Advance Pending" value={model.advance.length} helper="Finance / advance follow-up" tone="amber" active={filter==='ADVANCE'} onClick={()=>setFilter(filter==='ADVANCE'?'ALL':'ADVANCE')}/><Stat label="Credit on Hold" value={model.creditHold.length} helper="Resolve hold status" tone="red" active={filter==='HOLD'} onClick={()=>setFilter(filter==='HOLD'?'ALL':'HOLD')}/></div><PaymentTable rows={urgentVisible} loading={loading} title={urgentTitle} /></>}

    <style>{`
      .ppw-shell{margin-top:14px}.ppw-tabs{display:grid;grid-template-columns:repeat(4,1fr);background:#fff;border:1px solid #dbe5f0;border-radius:12px;overflow:hidden;margin-bottom:14px}.ppw-tab{height:50px;border:0;border-right:1px solid #e2e8f0;background:#fff;font-size:12px;font-weight:750;color:#475569;cursor:pointer}.ppw-tab:last-child{border-right:0}.ppw-tab.active{background:#eff6ff;color:#1d4ed8;box-shadow:inset 0 -3px 0 #2563eb}.ppw-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.ppw-stat{text-align:left;background:#fff;border:1px solid #e2e8f0;border-top:3px solid #cbd5e1;border-radius:12px;padding:13px;min-height:104px;cursor:pointer}.ppw-stat.amber{border-top-color:#f59e0b}.ppw-stat.red{border-top-color:#ef4444}.ppw-stat.active{background:#eff6ff;border-color:#93c5fd;box-shadow:0 0 0 1px #bfdbfe}.ppw-stat span{display:block;font-size:9px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#64748b}.ppw-stat strong{display:block;font-size:21px;margin:10px 0 6px;color:#0f172a}.ppw-stat small{font-size:10px;color:#64748b}.ppw-card,.ppw-table-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden}.ppw-head{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;border-bottom:1px solid #e2e8f0}.ppw-head span{font-size:9px;font-weight:800;letter-spacing:.1em;color:#2563eb}.ppw-head h3{font-size:15px;margin:4px 0 0}.ppw-head small{color:#64748b}.ppw-age-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px}.ppw-age-grid button{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px;text-align:left;cursor:pointer}.ppw-age-grid span{font-size:10px;color:#64748b}.ppw-age-grid strong{display:block;font-size:19px;margin:8px 0}.ppw-age-grid em{font-style:normal;font-size:11px;color:#334155}.ppw-bars{padding:0 14px 16px}.ppw-bars>div{display:grid;grid-template-columns:100px 1fr 150px;align-items:center;gap:10px;margin:9px 0;font-size:10px}.ppw-bars>div>div{height:10px;background:#eef2f7;border-radius:999px;overflow:hidden}.ppw-bars i{display:block;height:100%;background:#3b82f6;border-radius:999px}.ppw-supplier-wrap,.ppw-table-wrap{overflow:auto;max-height:560px}.ppw-supplier-wrap table,.ppw-table-wrap table{width:100%;border-collapse:collapse;font-size:10px}.ppw-supplier-wrap th,.ppw-table-wrap th{position:sticky;top:0;background:#f8fafc;text-align:left;padding:9px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:9px;text-transform:uppercase}.ppw-supplier-wrap td,.ppw-table-wrap td{padding:9px 10px;border-bottom:1px solid #f1f5f9;color:#334155}.ppw-focus{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px}.ppw-pill{display:inline-flex;padding:3px 7px;border-radius:999px;background:#f1f5f9;font-size:9px;font-weight:800}.ppw-age.bad{background:#fee2e2;color:#b91c1c}.ppw-age.warn{background:#fef3c7;color:#92400e}@media(max-width:1000px){.ppw-stats{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.ppw-tabs,.ppw-stats,.ppw-focus,.ppw-age-grid{grid-template-columns:1fr}.ppw-tab{border-right:0;border-bottom:1px solid #e2e8f0}.ppw-bars>div{grid-template-columns:80px 1fr}}
    `}</style>
  </div>,host)
}

function PaymentTable({rows,loading,title}){ return <div className="ppw-table-card"><div className="ppw-head"><div><span>PROCUREMENT · PENDING PAYMENT LIST</span><h3>{title}</h3></div><small>{loading?'Refreshing…':`${rows.length} POs`}</small></div><div className="ppw-table-wrap"><table><thead><tr><th>PO Number</th><th>PO Date</th><th>Supplier</th><th>Status</th><th>Priority</th><th>PO Value</th><th>Age</th><th>Action Needed</th></tr></thead><tbody>{rows.map((r)=><tr key={r.po_no}><td><strong>{clean(r.po_no)||'—'}</strong></td><td>{parseDate(r.po_date)?.toLocaleDateString()||'—'}</td><td>{clean(r.supplier)||'—'}</td><td><span className="ppw-pill">{clean(r.status)||'—'}</span></td><td>{clean(r.priority)||'—'}</td><td>{money(r.po_value)}</td><td><span className={`ppw-pill ppw-age ${(r.age??0)>60?'bad':(r.age??0)>30?'warn':''}`}>{r.age==null?'—':`${r.age}d`}</span></td><td>{r.action}</td></tr>)}{!rows.length&&<tr><td colSpan="8" style={{textAlign:'center',padding:24,color:'#94a3b8'}}>No pending payment records in this view.</td></tr>}</tbody></table></div></div> }