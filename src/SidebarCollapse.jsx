import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const STORAGE_KEY = 'srd-sidebar-collapsed'
const GROUP_LABELS = new Set(['Workspace','Procurement','Materials','Inventory','Reporting','Administration'])

export default function SidebarCollapse(){
  const [host,setHost]=useState(null)
  const [collapsed,setCollapsed]=useState(()=>localStorage.getItem(STORAGE_KEY)==='1')

  useEffect(()=>{
    let disposed=false
    const setup=()=>{
      if(disposed) return
      const shell=document.querySelector('.app-shell')
      const sidebar=document.querySelector('.sidebar')
      const brand=sidebar?.querySelector('.brand')
      if(!shell||!sidebar||!brand) return

      shell.classList.toggle('srd-sidebar-collapsed',collapsed)
      sidebar.classList.toggle('srd-sidebar-collapsed',collapsed)

      sidebar.querySelectorAll('.nav-item').forEach((el)=>{
        const label=(el.textContent||'').trim()
        if(label) el.title=label
      })

      ;[...sidebar.querySelectorAll('*')].forEach((el)=>{
        if(el.children.length===0 && GROUP_LABELS.has((el.textContent||'').trim())){
          el.classList.add('srd-nav-group-label')
        }
      })

      let mount=brand.querySelector('.srd-sidebar-toggle-host')
      if(!mount){
        mount=document.createElement('div')
        mount.className='srd-sidebar-toggle-host'
        brand.appendChild(mount)
      }
      if(!host) setHost(mount)
    }

    setup()
    const id=window.setInterval(setup,700)
    return()=>{disposed=true;window.clearInterval(id)}
  },[collapsed,host])

  const toggle=()=>{
    setCollapsed((value)=>{
      const next=!value
      localStorage.setItem(STORAGE_KEY,next?'1':'0')
      return next
    })
  }

  if(!host) return null

  return createPortal(<>
    <button
      type="button"
      className="srd-sidebar-toggle"
      onClick={toggle}
      title={collapsed?'Expand sidebar':'Collapse sidebar'}
      aria-label={collapsed?'Expand sidebar':'Collapse sidebar'}
      aria-expanded={!collapsed}
    >
      <span></span><span></span><span></span>
    </button>
    <style>{`
      .app-shell,.sidebar{transition:all .22s ease}
      .srd-sidebar-toggle-host{margin-left:auto;display:flex;align-items:center;justify-content:center;flex:0 0 auto}
      .srd-sidebar-toggle{width:34px;height:34px;border:1px solid rgba(255,255,255,.14);border-radius:9px;background:rgba(255,255,255,.06);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:0;color:#d9e3f4}
      .srd-sidebar-toggle:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.22)}
      .srd-sidebar-toggle span{display:block;width:14px;height:1.5px;border-radius:99px;background:currentColor}

      .app-shell.srd-sidebar-collapsed{grid-template-columns:76px minmax(0,1fr)}
      .sidebar.srd-sidebar-collapsed{padding:18px 8px;gap:18px}
      .sidebar.srd-sidebar-collapsed .brand{justify-content:center;padding:0 0 8px;gap:0}
      .sidebar.srd-sidebar-collapsed .brand>*:not(.srd-sidebar-toggle-host){display:none!important}
      .sidebar.srd-sidebar-collapsed .srd-sidebar-toggle-host{margin-left:0}
      .sidebar.srd-sidebar-collapsed .srd-nav-group-label{display:none!important}
      .sidebar.srd-sidebar-collapsed nav{gap:6px}
      .sidebar.srd-sidebar-collapsed .nav-item{justify-content:center;gap:0;padding:10px 0;font-size:0;min-height:42px}
      .sidebar.srd-sidebar-collapsed .nav-item .nav-icon{margin:0}
      .sidebar.srd-sidebar-collapsed .sidebar-bottom{display:none!important}

      @media(max-width:760px){
        .app-shell.srd-sidebar-collapsed{grid-template-columns:64px minmax(0,1fr)}
        .sidebar.srd-sidebar-collapsed{padding-left:6px;padding-right:6px}
      }
    `}</style>
  </>,host)
}
