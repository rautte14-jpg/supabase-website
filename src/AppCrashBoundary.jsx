import { Component } from 'react'

export default class AppCrashBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('SRD Warehouse app render failed', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <main style={{minHeight:'100vh',background:'#F8FAFC',display:'grid',placeItems:'center',padding:24,fontFamily:'system-ui,sans-serif'}}>
        <section style={{width:'min(560px,100%)',background:'#fff',border:'1px solid #E2E8F0',borderRadius:16,padding:24,boxShadow:'0 8px 30px rgba(15,23,42,.08)'}}>
          <div style={{fontSize:12,fontWeight:800,letterSpacing:'.08em',color:'#DC2626'}}>MODULE RECOVERY</div>
          <h1 style={{fontSize:22,margin:'8px 0 6px',color:'#0F172A'}}>The dashboard caught a page error.</h1>
          <p style={{fontSize:14,lineHeight:1.6,color:'#475569',margin:'0 0 16px'}}>Instead of leaving the website blank, this recovery screen keeps the app usable. Reload the dashboard to return to Home.</p>
          <pre style={{whiteSpace:'pre-wrap',wordBreak:'break-word',fontSize:11,background:'#F8FAFC',border:'1px solid #E2E8F0',borderRadius:10,padding:12,color:'#64748B',maxHeight:140,overflow:'auto'}}>{String(this.state.error?.message || this.state.error || 'Unknown render error')}</pre>
          <button onClick={() => window.location.reload()} style={{marginTop:16,border:0,borderRadius:9,padding:'10px 15px',background:'#2563EB',color:'#fff',fontWeight:700,cursor:'pointer'}}>Reload Dashboard</button>
        </section>
      </main>
    )
  }
}
