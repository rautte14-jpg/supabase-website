import { useEffect } from 'react'
import { clearSupabaseReadCache, supabase } from './lib/supabase'

const TABLES = [
  ['procurement_records', 'updated_at', false],
  ['material_records', 'updated_at', false],
  ['stock_items', 'item_code', true],
  ['inventory_transactions', 'physical_date', false],
  ['sr_issue_records', 'requested_receipt_date', false],
  ['lld_updates', 'updated_at', false],
  ['case_notes', 'updated_at', false],
  ['source_updates', 'imported_at', false],
  ['weekly_snapshots', 'snapshot_date', false],
  ['pending_payment_records', 'po_date', false],
  ['erp_pr_headers', 'created_at', false],
]

const ROUTE_TABLES = {
  Home: ['pending_payment_records', 'stock_items', 'source_updates', 'sr_issue_records', 'weekly_snapshots', 'procurement_records'],
  Overview: ['procurement_records', 'material_records', 'sr_issue_records', 'source_updates', 'weekly_snapshots', 'pending_payment_records'],
  'PRF Tracker': ['procurement_records', 'lld_updates', 'case_notes'],
  'PR & PO Tracker': ['procurement_records', 'lld_updates', 'case_notes', 'erp_pr_headers'],
  'Pending Payments': ['pending_payment_records'],
  'MTR Tracker': ['material_records', 'case_notes'],
  'MRN & Issues': ['material_records', 'sr_issue_records', 'case_notes'],
  'Vessel / SR View': ['procurement_records', 'material_records', 'inventory_transactions', 'sr_issue_records', 'lld_updates'],
  'Stock & Ageing': ['stock_items', 'weekly_snapshots'],
  'Update Centre': ['source_updates'],
  'Warehouse Presentation': ['procurement_records', 'material_records', 'sr_issue_records'],
  History: ['source_updates', 'weekly_snapshots'],
}

const PAGE_SIZE = 1000

async function warmTable([table, orderColumn, ascending]) {
  let from = 0
  while (true) {
    let query = supabase.from(table).select('*').range(from, from + PAGE_SIZE - 1)
    if (orderColumn) query = query.order(orderColumn, { ascending })
    const { data, error } = await query
    if (error) throw error
    const count = data?.length || 0
    if (count < PAGE_SIZE) break
    from += PAGE_SIZE
  }
}

async function warmWarehouseData() {
  // A small worker pool prevents initial warm-up from flooding the connection,
  // while still making the first visit to each module much faster.
  let next = 0
  const workers = Array.from({ length: 3 }, async () => {
    while (next < TABLES.length) {
      const index = next++
      try {
        await warmTable(TABLES[index])
      } catch (error) {
        console.warn('Background data warm-up failed for', TABLES[index][0], error)
      }
    }
  })
  await Promise.all(workers)
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
    let warmTimer = null
    let refreshTimer = null
    let navTimer = null
    const dirtyTables = new Set()

    const refreshForCurrentRoute = () => {
      if (disposed || document.hidden) return
      const route = currentRoute()
      const dependencies = ROUTE_TABLES[route] || []
      const needsRefresh = dependencies.some((table) => dirtyTables.has(table))
      if (!needsRefresh) return
      if (clickRefresh()) {
        window.setTimeout(() => dependencies.forEach((table) => dirtyTables.delete(table)), 2500)
      }
    }

    const scheduleCurrentRefresh = () => {
      window.clearTimeout(refreshTimer)
      refreshTimer = window.setTimeout(refreshForCurrentRoute, 350)
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

    const onNav = (event) => {
      if (!event.target.closest('.nav-item')) return
      window.clearTimeout(navTimer)
      navTimer = window.setTimeout(refreshForCurrentRoute, 180)
    }
    document.addEventListener('click', onNav, true)

    const onFocus = () => {
      // Even if realtime was briefly interrupted, returning to the tab forces
      // the visible module to reconcile with Supabase.
      if (!document.hidden) clickRefresh()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)

    const periodic = window.setInterval(() => {
      if (!document.hidden) clickRefresh()
    }, 60000)

    const beginWarmup = async () => {
      const { data } = await supabase.auth.getSession()
      if (!data.session || disposed) return
      await warmWarehouseData()
    }

    // Let Home paint first, then immediately warm the data layer in the background.
    warmTimer = window.setTimeout(beginWarmup, 250)

    return () => {
      disposed = true
      window.__SRD_PERFORMANCE_LAYER_ACTIVE__ = false
      window.clearTimeout(warmTimer)
      window.clearTimeout(refreshTimer)
      window.clearTimeout(navTimer)
      window.clearInterval(periodic)
      document.removeEventListener('click', onNav, true)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
      supabase.removeChannel(channel)
    }
  }, [])

  return null
}
