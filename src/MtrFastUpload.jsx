import { useEffect, useRef, useState } from 'react'

const clean=(v)=>String(v??'').trim()

export default function MtrFastUpload(){
  const workerRef=useRef(null)
  const [message,setMessage]=useState('')

  useEffect(()=>{
    const handler=async(event)=>{
      const input=event.target
      if(!(input instanceof HTMLInputElement) || input.type!=='file') return
      if(input.dataset.mtrPreprocessed==='1'){
        delete input.dataset.mtrPreprocessed
        return
      }

      const updateHeading=[...document.querySelectorAll('h1,h2,h3')].find((el)=>clean(el.textContent)==='Update Centre')
      if(!updateHeading) return
      const content=updateHeading.closest('.content') || updateHeading.parentElement?.parentElement
      if(!content?.contains(input)) return
      const select=[...content.querySelectorAll('select')].find((el)=>[...el.options].some((o)=>clean(o.textContent)==='MTR Register'))
      const isMtr=select && (select.value==='MTR' || clean(select.options[select.selectedIndex]?.textContent)==='MTR Register')
      if(!isMtr) return

      const file=input.files?.[0]
      if(!file || !/\.xlsx?$/i.test(file.name)) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      setMessage('Preparing large MTR workbook in the background…')

      try{
        workerRef.current?.terminate?.()
        const worker=new Worker(new URL('./mtrPreprocessWorker.js', import.meta.url),{type:'module'})
        workerRef.current=worker
        const buffer=await file.arrayBuffer()
        const result=await new Promise((resolve,reject)=>{
          worker.onmessage=(ev)=>ev.data?.ok?resolve(ev.data):reject(new Error(ev.data?.error||'Unable to read workbook'))
          worker.onerror=(err)=>reject(new Error(err.message||'Worker error'))
          worker.postMessage({buffer},[buffer])
        })
        worker.terminate(); workerRef.current=null

        const csvName=file.name.replace(/\.xlsx?$/i,'.csv')
        const csvFile=new File([result.csv],csvName,{type:'text/csv'})
        const dt=new DataTransfer()
        dt.items.add(csvFile)
        input.dataset.mtrPreprocessed='1'
        input.files=dt.files
        setMessage(`Workbook prepared (${result.sheetName}). Loading rows…`)
        input.dispatchEvent(new Event('change',{bubbles:true}))
        window.setTimeout(()=>setMessage(''),2500)
      }catch(err){
        setMessage(`Could not prepare MTR workbook: ${err.message||err}`)
      }
    }

    document.addEventListener('change',handler,true)
    return()=>{
      document.removeEventListener('change',handler,true)
      workerRef.current?.terminate?.()
    }
  },[])

  if(!message) return null
  return <div style={{position:'fixed',right:20,bottom:20,zIndex:120,background:'#0f172a',color:'#fff',padding:'12px 16px',borderRadius:10,fontSize:12,boxShadow:'0 10px 30px rgba(15,23,42,.25)'}}>{message}</div>
}
