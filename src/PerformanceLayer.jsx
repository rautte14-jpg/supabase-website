import { useEffect } from 'react'
import { clearSupabaseReadCache, supabase } from './lib/supabase'

const ROUTE_TABLES = {
  Home: ['pending_payment_records', 'stock_items', 'source_updates', 'sr_issue_records', 'weekly_snapshots', 'procurement_records'],
  Overview: ['procurement_records', 'material_records', 'sr_issue_records', 'source_updates', 'weekly_snapshots', 'pending_payment_records'],
  'PRF Tracker': ['procurement_records', 'lld_updates', 'case_notes'],
  'PR & PO Tracker': ['procurement_records', 'lld_updates', 'case_notes', 'erp_pr_headers', 'erp_pr_details'],
  'Pending Payments': ['pending_payment_records'],
  'MTR Tracker': ['material_records', 'case_notes'],
  'MRN & Issues': ['material_records', 'sr_issue_records', 'inventory_transactions', 'case_notes'],
  'Vessel / SR View': ['procurement_records', 'material_records', 'inventory_transactions', 'sr_issue_records', 'lld_updates'],
  'Stock & Ageing': ['stock_items', 'weekly_snapshots'],
  'Update Centre': ['source_updates'],
  'Warehouse Presentation': ['procurement_records', 'material_records', 'sr_issue_records', 'inventory_transactions'],
  'Inventory Presentation': ['procurement_records', 'material_records', 'pending_payment_records', 'stock_items', 'weekly_snapshots', 'inventory_transactions'],
  History: ['source_updates', 'weekly_snapshots'],
}

function currentRoute() {
  return String(document.querySelector('.topbar-context strong')?.textContent || '').trim()
}

function clickRefresh() {
  const buttons = [...document.querySelectorAll('.topbar .top-actions button')]
  const refresh = buttons.find((button) => /refresh/i.test(button.textContent || ''))
  if (!refresh || refresh.disabled || /refreshing/i.test(refresh.textContent || '')) return false
  refresh.click()
  return true
}

export default function PerformanceLayer() {
  useEffect(() => {
    if (window.__SRD_PERFORMANCE_LAYER_ACTIVE__) return
    window.__SRD_PERFORMANCE_LAYER_ACTIVE__ = true

    let disposed = false
    let refreshTimer = null
    const dirtyTables = new Set()

    const refreshForCurrentRoute = () => {
      if (disposed || document.hidden) return
      const route = currentRoute()
      const dependencies = ROUTE_TABLES[route] || []
      if (!dependencies.some((table) => dirtyTables.has(table))) return
      if (clickRefresh()) {
        window.setTimeout(() => dependencies.forEach((table) => dirtyTables.delete(table)), 2500)
      }
    }

    const scheduleCurrentRefresh = () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(refreshForCurrentRoute, 1200)
    }

    const onDatabaseChange = (payload) => {
      const table = payload?.table
      if (!table) {
        clearSupabaseReadCache()
        return
      }
      clearSupabaseReadCache(table)
      dirtyTables.add(table)
      scheduleCurrentRefresh()
    }

    const channel = supabase
      .channel('srd-warehouse-live-performance')
      .on('postgres_changes', { event: '*', schema: 'public' }, onDatabaseChange)
      .subscribe()

    const onVisibility = () => {
      if (!document.hidden) refreshForCurrentRoute()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      window.__SRD_PERFORMANCE_LAYER_ACTIVE__ = false
      window.clearTimeout(refreshTimer)
      document.removeEventListener('visibilitychange', onVisibility)
      supabase.removeChannel(channel)
    }
  }, [])

  return null
}
