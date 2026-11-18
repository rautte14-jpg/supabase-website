import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { loadWarehouseRtl } from './lib/warehouseRtl.js'
import rtlLogo from './assets/rtl-logo.svg'
import './warehouseRtlSlide.css'

const fmt = value => Number(value).toLocaleString(undefined,{maximumFractionDigits:2})
const dateLabel = value => new Date(value + 'T00:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})

export default function WarehouseRtlSlide() {
  const [model,setModel] = useState(null)
  const [error,setError] = useState('')
  const [retry,setRetry] = useState(0)
  useEffect(()=>{
    let active=true
    setModel(null);setError('')
    loadWarehouseRtl(supabase).then(data=>{if(active)setModel(data)}).catch(reason=>{if(active)setError(reason.message || 'RTL on-hand data could not load.')})
    return()=>{active=false}
  },[retry])
  return <div className="warehouse-rtl">
    <div className="warehouse-rtl-left">
      <p className="warehouse-rtl-date">{model ? 'Stock as of ' + dateLabel(model.source.snapshot_date) : 'Latest saved RTL on-hand report'} · 28 vessels · 2 engines per vessel</p>
      {model ? <>
        <section className="warehouse-rtl-panel">
          <h3>PM Readiness <small>Complete vessels</small></h3>
          <div className="warehouse-rtl-pm">{model.pm.map(row=><div key={row.label}><span>{row.label}</span><strong>{row.coverage}<small> / 28</small></strong></div>)}</div>
        </section>
        <div className="warehouse-rtl-stats">
          <section className="warehouse-rtl-panel"><h3>Standard Overhaul</h3><div className="warehouse-rtl-numbers"><strong>{model.standard.engines}<small> engines</small></strong><strong>{model.standard.vessels}<small> vessels</small></strong></div><p>{model.standard.items}-item mechanic-team standard</p></section>
          <section className="warehouse-rtl-panel"><h3>Shortages for 1 Engine</h3><div className="warehouse-rtl-numbers"><strong>{model.standard.shortItems}<small> items</small></strong><strong>{fmt(model.standard.shortUnits)}<small> pieces</small></strong></div><p>{model.standard.missing ? model.standard.missing + ' items not listed in on-hand report' : 'All required items listed in on-hand report'}</p></section>
        </div>
        <section className="warehouse-rtl-panel warehouse-rtl-table">
          <h3>Priority Shortages <small>1 engine · top 5 by quantity short</small></h3>
          <table><thead><tr><th>Item / description</th><th>Need</th><th>Available</th><th>Short</th></tr></thead><tbody>
            {model.shortages.map(row=><tr key={row.item}><td><b>{row.item}</b><span title={row.description}>{row.description}</span></td><td>{fmt(row.required)}</td><td>{row.missing ? 'Not listed' : fmt(row.available)}</td><td>{fmt(row.shortage)}</td></tr>)}
            {!model.shortages.length && <tr><td colSpan="4">No shortages for one engine against this stock snapshot.</td></tr>}
          </tbody></table>
        </section>
      </> : <div role={error ? 'alert' : 'status'} className="warehouse-rtl-panel warehouse-rtl-status"><p>{error || 'Loading RTL readiness…'}</p>{error && <button onClick={()=>setRetry(value=>value+1)}>Retry</button>}</div>}
    </div>
    <div className="warehouse-rtl-right">
      <div className="warehouse-rtl-logo"><img src={rtlLogo} alt="RTL · operated by MTCC" /></div>
      <section className="warehouse-rtl-attention">
        <h3><span aria-hidden="true">⚠</span> Attention Required</h3>
        <div><b>01</b><p><strong>RTL Yanmar Spare Orders</strong><span>Currently on hold due to payment issues.</span></p></div>
        <div><b>02</b><p><strong>Castoldi Jet Spare Orders</strong><span>Processing delayed for more than one month due to payment issues.</span></p></div>
      </section>
    </div>
    <p className="warehouse-rtl-note">Categories are assessed independently against shared stock. Coverage does not reserve parts for specific vessels. {model && <>Source: {model.source.source_file}. </>}Warehouse/site scope requires verification.</p>
  </div>
}
