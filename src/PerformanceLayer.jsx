import { useEffect } from 'react'
import { clearSupabaseReadCache, supabase } from './lib/supabase'

const ROUTE_TABLES = {
  home: ['pending_payment_records', 'stock_items', 'source_updates', 'sr_issue_records', 'weekly_snapshots', 'procurement_records'],
  overview: ['procurement_records', 'material_records', 'sr_issue_records', 'source_updates', 'weekly_snapshots', 'pending_payment_records'],
  prf: ['procurement_records', 'lld_updates', 'case_notes'],
  prpo: ['procurement_records', 'lld_updates', 'case_notes', 'erp_pr_headers', 'erp_pr_details'],
  payments: ['pending_payment_records', 'procurement_records'],
  mtr: ['material_records', 'case_notes'],
  mrn: ['material_records', 'sr_issue_records', 'inventory_transactions', 'case_notes'],
  vessel: ['procurement_records', 'material_records', 'inventory_transactions', 'sr_issue_records', 'lld_updates'],
  stock: ['stock_items', 'weekly_snapshots'],
  updates: ['source_updates'],
  warehouse: ['procurement_records', 'material_records', 'sr_issue_records', 'inventory_transactions'],
  inventoryPresentation: ['procurement_records', 'material_records', 'pending_payment_records', 'stock_items', 'weekly_snapshots', 'inventory_transactions'],
  history: ['source_updates', 'weekly_snapshots'],
}

function currentRoute() {
  return String(window.__SRD_ACTIVE_VIEW__ || '').trim()
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
      window.dispatchEvent(new Event('srd:refresh-current-view'))
      window.setTimeout(() => dependencies.forEach((table) => dirtyTables.delete(table)), 2500)
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
