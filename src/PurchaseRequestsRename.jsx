import { useEffect } from 'react'

const TARGET = 'PR & PO Tracker'
const REPLACEMENT = 'Purchase Requests'

export default function PurchaseRequestsRename() {
  useEffect(() => {
    let disposed = false

    const rename = () => {
      if (disposed) return

      document.querySelectorAll('body *').forEach((el) => {
        if (el.children.length !== 0) return
        const text = String(el.textContent || '').trim()
        if (text === TARGET) el.textContent = REPLACEMENT
      })

      document.title = document.title.replace(TARGET, REPLACEMENT)
    }

    rename()
    const id = window.setInterval(rename, 500)
    return () => {
      disposed = true
      window.clearInterval(id)
    }
  }, [])

  return null
}
