import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

const CURRENT_YEAR = new Date().getFullYear()
const YEAR_START = `${CURRENT_YEAR}-01-01T00:00:00.000Z`
const NEXT_YEAR_START = `${CURRENT_YEAR + 1}-01-01T00:00:00.000Z`

function applyVisibleCount(count) {
  const formatted = Number(count || 0).toLocaleString()
  const leaves = [...document.querySelectorAll('body *')].filter((el) => el.children.length === 0)

  for (const el of leaves) {
    const text = String(el.textContent || '').trim()

    // The main card and the blue section summary both render as "4,744 PRs".
    if (/^\d[\d,]*\s+PRs$/i.test(text)) {
      el.textContent = `${formatted} PRs`
      continue
    }

    if (/^SIMPLIX SYNC\s*·/i.test(text)) {
      el.textContent = `SIMPLIX SYNC · ${formatted} PRs · ${CURRENT_YEAR}`
    }
  }
}

export default function PrCountFix() {
  const [count, setCount] = useState(null)

  useEffect(() => {
    let active = true

    async function loadCount() {
      const { count: total, error } = await supabase
        .from('erp_pr_headers')
        .select('purch_req_id', { count: 'exact', head: true })
        .gte('created_at', YEAR_START)
        .lt('created_at', NEXT_YEAR_START)

      if (error) {
        console.warn('Could not load current-year PR count', error.message)
        return
      }

      if (active) setCount(total || 0)
    }

    loadCount()
    const refreshTimer = window.setInterval(loadCount, 60000)
    return () => {
      active = false
      window.clearInterval(refreshTimer)
    }
  }, [])

  useEffect(() => {
    if (count == null) return
    applyVisibleCount(count)
    const uiTimer = window.setInterval(() => applyVisibleCount(count), 1200)
    return () => window.clearInterval(uiTimer)
  }, [count])

  return null
}
