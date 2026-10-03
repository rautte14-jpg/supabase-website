import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'

const clean = (v) => String(v ?? '').trim()
const fmtDate = (v) => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.valueOf()) ? clean(v) || '—' : d.toLocaleString()
}
const arr = (v) => Array.isArray(v) ? v : []

function Pill({ value }) {
  const text = clean(value) || '—'
  const low = text.toLowerCase()
  const tone = /approved|complete|received|closed|delivered/.test(low)
    ? '#166534'
    : /reject|cancel|fail/.test(low)
      ? '#b91c1c'
      : /pending|review|progress|processing|waiting/.test(low)
        ? '#92400e'
        : '#475569'
  const bg = tone === '#166534' ? '#dcfce7' : tone === '#b91c1c' ? '#fee2e2' : tone === '#92400e' ? '#fef3c7' : '#f1f5f9'
  return <span style={{display:'inline-flex',padding:'4px 9px',borderRadius:999,fontSize:11,fontWeight:700,color:tone,background:bg}}>{text}</span>
}

function Card({ label, value, pill }) {
  return <div style={{padding:'14px 16px',border:'1px solid #e2e8f0',borderRadius:12,background:'#fff'}}>
    <div style={{fontSize:10,fontWeight:800,letterSpacing:'.08em',color:'#64748b',textTransform:'uppercase',marginBottom:6}}>{label}</div>
    {pill ? <Pill value={value}/> : <div style={{fontSize:13,fontWeight:700,color:'#0f172a',wordBreak:'break-word'}}>{clean(value)||'—'}</div>}
  </div>
}

function Workflow({ title, steps }) {
  const rows = arr(steps)
  return <section style={{marginTop:22}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
      <h3 style={{margin:0,fontSize:15,color:'#0f172a'}}>{title}</h3>
      <span style={{fontSize:12,color:'#64748b'}}>{rows.length} steps</span>
    </div>
    {!rows.length ? <div style={{padding:16,border:'1px dashed #cbd5e1',borderRadius:10,color:'#64748b',fontSize:12}}>No workflow data synced yet.</div> :
      <div style={{display:'grid',gap:8}}>{rows.map((s,i)=><div key={s.RecId??i} style={{display:'grid',gridTemplateColumns:'1fr auto',gap:12,padding:'12px 14px',border:'1px solid #e2e8f0',borderRadius:10,background:'#fff'}}>
        <div><div style={{fontWeight:700,fontSize:13,color:'#0f172a'}}>{clean(s.UserName)||'Unknown user'}</div><div style={{fontSize:12,color:'#64748b',marginTop:2}}>{clean(s.Position)||'—'}</div><div style={{fontSize:11,color:'#94a3b8',marginTop:5}}>{s.ApprovedDateTime||s.ApprovedDate||'No approval date yet'}</div>{clean(s.Comment)&&<div style={{fontSize:12,color:'#475569',marginTop:6}}>{s.Comment}</div>}</div>
        <Pill value={s.Status}/>
      </div>)}</div>}
  </section>
}

function TableBlock({ title, columns, rows }) {
  const data = arr(rows)
  return <section style={{marginTop:22}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}><h3 style={{margin:0,fontSize:15,color:'#0f172a'}}>{title}</h3><span style={{fontSize:12,color:'#64748b'}}>{data.length}</span></div>
    {!data.length ? <div style={{padding:16,border:'1px dashed #cbd5e1',borderRadius:10,color:'#64748b',fontSize:12}}>No linked records synced yet.</div> :
    <div style={{overflowX:'auto',border:'1px solid #e2e8f0',borderRadius:10}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr style={{background:'#f8fafc'}}>{columns.map(c=><th key={c.key} style={{textAlign:'left',padding:'10px 12px',color:'#64748b',fontSize:10,letterSpacing:'.05em',textTransform:'uppercase',whiteSpace:'nowrap'}}>{c.label}</th>)}</tr></thead><tbody>{data.map((r,i)=><tr key={i} style={{borderTop:'1px solid #e2e8f0'}}>{columns.map(c=><td key={c.key} style={{padding:'10px 12px',color:'#334155',whiteSpace:'nowrap'}}>{c.render?c.render(r[c.key],r):(clean(r[c.key])||'—')}</td>)}</tr>)}</tbody></table></div>}
  </section>
}

export default function PrDetailOverlay(){
  const [prNo,setPrNo]=useState('')
  const [header,setHeader]=useState(null)
  const [details,setDetails]=useState(null)
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')

  useEffect(()=>{
    const handler=(event)=>{
      const target=event.target instanceof Element?event.target:null
      if(!target) return
      const row=target.closest('tbody tr')
      if(!row) return
      const table=row.closest('table')
      if(!table) return
      const heads=[...table.querySelectorAll('thead th')].map(x=>clean(x.textContent).toLowerCase())
      const prIndex=heads.findIndex(x=>x==='pr number'||x==='pr no.'||x==='pr no')
      if(prIndex<0) return
      const cells=[...row.querySelectorAll(':scope > td')]
      const value=clean(cells[prIndex]?.textContent).replace(/\s+/g,'').toUpperCase()
      if(!/^PR\d+$/.test(value)) return
      event.preventDefault()
      setPrNo(value)
    }
    document.addEventListener('click',handler,true)
    return()=>document.removeEventListener('click',handler,true)
  },[])

  useEffect(()=>{
    if(!prNo) return
    let active=true
    setLoading(true);setError('');setHeader(null);setDetails(null)
    Promise.all([
      supabase.from('erp_pr_headers').select('*').eq('purch_req_id',prNo).maybeSingle(),
      supabase.from('erp_pr_details').select('*').eq('purch_req_id',prNo).maybeSingle(),
    ]).then(([h,d])=>{
      if(!active)return
      setLoading(false)
      if(h.error){setError(h.error.message||'Could not load PR.');return}
      setHeader(h.data||null)
      setDetails(d.data||null)
    }).catch(e=>{if(active){setLoading(false);setError(e?.message||'Could not load PR.')}})
    return()=>{active=false}
  },[prNo])

  useEffect(()=>{
    if(!prNo)return
    const fn=e=>{if(e.key==='Escape')setPrNo('')}
    document.addEventListener('keydown',fn)
    const old=document.body.style.overflow;document.body.style.overflow='hidden'
    return()=>{document.removeEventListener('keydown',fn);document.body.style.overflow=old}
  },[prNo])

  const rfqs=useMemo(()=>arr(details?.rfqs),[details])
  const pos=useMemo(()=>arr(details?.purchase_orders),[details])
  const receipts=useMemo(()=>arr(details?.product_receipts),[details])
  const prFlow=useMemo(()=>arr(details?.pr_workflow),[details])
  const poFlow=useMemo(()=>arr(details?.po_workflow),[details])

  if(!prNo)return null
  return <div onMouseDown={e=>{if(e.target===e.currentTarget)setPrNo('')}} style={{position:'fixed',inset:0,zIndex:9999,background:'rgba(15,23,42,.42)',display:'flex',justifyContent:'flex-end'}}>
    <aside style={{width:'min(860px,92vw)',height:'100%',background:'#f8fafc',boxShadow:'-18px 0 50px rgba(15,23,42,.18)',overflowY:'auto'}}>
      <div style={{position:'sticky',top:0,zIndex:2,background:'#fff',borderBottom:'1px solid #e2e8f0',padding:'20px 24px',display:'flex',justifyContent:'space-between',gap:20}}>
        <div><div style={{fontSize:10,fontWeight:800,letterSpacing:'.12em',color:'#2563eb'}}>PURCHASE REQUEST</div><h2 style={{margin:'4px 0 3px',fontSize:24,color:'#0f172a'}}>{prNo}</h2><div style={{fontSize:13,color:'#64748b'}}>{header?.description||'Loading PR details…'}</div></div>
        <button onClick={()=>setPrNo('')} style={{width:36,height:36,borderRadius:10,border:'1px solid #cbd5e1',background:'#fff',fontSize:22,cursor:'pointer'}}>×</button>
      </div>
      <div style={{padding:'22px 24px 40px'}}>
        {loading?<div style={{padding:28,textAlign:'center',color:'#64748b'}}>Loading synced Simplix data…</div>:
        error?<div style={{padding:16,borderRadius:10,background:'#fee2e2',color:'#b91c1c'}}>{error}</div>:
        !header?<div style={{padding:18,border:'1px dashed #cbd5e1',borderRadius:10,color:'#64748b'}}>This PR is not available in the Simplix header sync.</div>:
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:10}}>
            <Card label="ERP Status" value={header.status} pill/><Card label="Current Approver" value={details?.current_approver}/><Card label="Position" value={details?.current_position}/><Card label="Workflow Status" value={details?.current_workflow_status} pill/><Card label="Requested By" value={header.created_by}/><Card label="Submitted" value={header.created_at_raw||fmtDate(header.created_at)}/><Card label="RFQs" value={details?.rfq_count??rfqs.length}/><Card label="Purchase Orders" value={details?.po_count??pos.length}/><Card label="Receipts" value={details?.receipt_count??receipts.length}/><Card label="Last Detail Sync" value={details?.detail_synced_at?fmtDate(details.detail_synced_at):'Not synced yet'}/>
          </div>
          {!details&&<div style={{marginTop:14,padding:'12px 14px',borderRadius:10,background:'#eff6ff',border:'1px solid #bfdbfe',color:'#1e40af',fontSize:12}}>The PR header is available, but detailed workflow data has not been synced for this PR yet.</div>}
          <Workflow title="PR Approval Workflow" steps={prFlow}/>
          <TableBlock title="RFQs" rows={rfqs} columns={[{key:'rfqId',label:'RFQ'},{key:'title',label:'Title'},{key:'status',label:'Status',render:v=><Pill value={v}/>},{key:'deliveryDate',label:'Delivery Date'}]}/>
          <TableBlock title="Purchase Orders" rows={pos} columns={[{key:'PurchId',label:'PO'},{key:'PurchName',label:'Name'},{key:'PurchStatus',label:'Status',render:v=><Pill value={v}/>},{key:'VendorAccount',label:'Vendor'},{key:'PendingApprovers',label:'Pending Approvers',render:v=>Array.isArray(v)?v.join(', '):(clean(v)||'—')}]}/>
          {poFlow.map((g,i)=><Workflow key={g.PurchId??i} title={`PO Workflow · ${g.PurchId||'PO'}`} steps={g.Workflow}/>) }
          <TableBlock title="Product Receipts" rows={receipts} columns={[{key:'po',label:'PO'},{key:'productReciept',label:'Product Receipt'},{key:'createdAt',label:'Created'},{key:'recId',label:'Record ID'}]}/>
        </>}
      </div>
    </aside>
  </div>
}
