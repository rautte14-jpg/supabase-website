import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function SidebarCollapse(){
  const [host,setHost]=useState(null)
  const [open,setOpen]=useState(false)

  useEffect(()=>{
    const shell=document.querySelector('.app-shell')
    const sidebar=document.querySelector('.sidebar')
    const mount=document.getElementById('sidebar-toggle-host')
    if(!shell||!sidebar||!mount) return

    shell.classList.add('srd-drawer-layout')
    sidebar.classList.add('srd-sidebar-drawer')
    setHost(mount)

    return()=>{
      shell.classList.remove('srd-drawer-layout')
      sidebar.classList.remove('srd-sidebar-drawer','open')
      document.body.classList.remove('srd-sidebar-open')
    }
  },[])

  useEffect(()=>{
    const sidebar=document.querySelector('.sidebar')
    if(!sidebar) return
    sidebar.classList.toggle('open',open)
    document.body.classList.toggle('srd-sidebar-open',open)

    sidebar.querySelectorAll('.nav-item').forEach((el)=>{
      const label=(el.textContent||'').trim()
      if(label) el.title=label
    })
  },[open])

  useEffect(()=>{
    if(!open) return
    const sidebar=document.querySelector('.sidebar')
    const onClick=(event)=>{
      if(event.target.closest('.nav-item')) setOpen(false)
    }
    const onKey=(event)=>{
      if(event.key==='Escape') setOpen(false)
    }
    sidebar?.addEventListener('click',onClick)
    window.addEventListener('keydown',onKey)
    return()=>{
      sidebar?.removeEventListener('click',onClick)
      window.removeEventListener('keydown',onKey)
    }
  },[open])

  if(!host) return null

  return createPortal(<>
    <button
      type="button"
      className="srd-sidebar-toggle"
      onClick={()=>setOpen((v)=>!v)}
      title={open?'Close menu':'Open menu'}
      aria-label={open?'Close menu':'Open menu'}
      aria-expanded={open}
    >
      <span></span><span></span><span></span>
    </button>
    {open && <button className="srd-sidebar-backdrop" aria-label="Close menu" onClick={()=>setOpen(false)} />}
    <style>{`
      .app-shell.srd-drawer-layout{grid-template-columns:minmax(0,1fr)!important}
      .app-shell.srd-drawer-layout>.workspace{grid-column:1!important;min-width:0}

      .sidebar.srd-sidebar-drawer{
        position:fixed!important;
        left:0;top:0;bottom:0;
        width:238px!important;
        height:100vh!important;
        z-index:80;
        transform:translateX(-100%);
        transition:transform .22s ease;
        box-shadow:14px 0 34px rgba(15,23,42,.20);
      }
      .sidebar.srd-sidebar-drawer.open{transform:translateX(0)}

      .srd-sidebar-toggle-host{display:flex;align-items:center;flex:0 0 auto;margin-right:2px}
      .srd-sidebar-toggle{
        width:38px;height:38px;
        border:1px solid #dbe3ee;
        border-radius:10px;
        background:#fff;
        display:flex;flex-direction:column;
        align-items:center;justify-content:center;
        gap:4px;padding:0;
        color:#334155;
        box-shadow:0 1px 2px rgba(15,23,42,.03)
      }
      .srd-sidebar-toggle:hover{background:#f8fafc;border-color:#cbd5e1}
      .srd-sidebar-toggle span{display:block;width:16px;height:1.6px;border-radius:99px;background:currentColor}

      .srd-sidebar-backdrop{
        position:fixed;inset:0;z-index:70;
        border:0;padding:0;margin:0;
        background:rgba(15,23,42,.32);
        backdrop-filter:blur(1px)
      }
      body.srd-sidebar-open{overflow:hidden}

      @media(max-width:760px){
        .sidebar.srd-sidebar-drawer{width:min(86vw,280px)!important}
        .topbar{padding-left:12px!important}
      }
    `}</style>
  </>,host)
}
