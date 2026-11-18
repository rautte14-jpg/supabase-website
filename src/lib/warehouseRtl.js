import { RTL_ROWS } from '../rtlSpareSnapshot.js'
import { RTL_STANDARD_REQUIREMENTS, rtlStandardRequirementRows } from '../rtlMechanicStandard.js'
import { evaluateRequirementRows, calculateRtlShortages } from './rtlCoverage.js'
import { rtlStockFromRecords } from './rtlStockSource.js'

const pmRows = RTL_ROWS.filter(([group]) => ['1','2','3','4'].includes(group))
export const RTL_PRESENTATION_ITEMS = [...new Set([...pmRows.map(row => row[1]), ...RTL_STANDARD_REQUIREMENTS.map(row => row.item)])]

export function makeWarehouseRtlModel(records, source) {
  if (!source?.snapshot_date) throw new Error('Upload On-hand Stock in Update Centre to supply RTL readiness.')
  const stock = rtlStockFromRecords(records, RTL_PRESENTATION_ITEMS)
  const pm = ['1','2','3','4'].map(group => ({label:'PM' + group, ...evaluateRequirementRows(pmRows.filter(row => row[0] === group), stock)}))
  const requirements = rtlStandardRequirementRows()
  const vessels = evaluateRequirementRows(requirements, stock)
  const engines = evaluateRequirementRows(requirements.map(([group,item,qty])=>[group,item,qty/2,null]), stock, 56)
  const plan = calculateRtlShortages(vessels.rows, 1, 'engines')
  const info = new Map(RTL_STANDARD_REQUIREMENTS.map(row => [row.item,row]))
  const shortages = plan.rows.filter(row => row.shortage > 0).sort((a,b)=>b.shortage-a.shortage || a.item.localeCompare(b.item))
    .map(row => ({...row, ...info.get(row.item)}))
  return {source, pm, standard:{items:requirements.length, engines:engines.coverage, vessels:vessels.coverage, missing:vessels.missing, shortItems:shortages.length, shortUnits:plan.confirmedShortage}, shortages:shortages.slice(0,5)}
}

export async function loadWarehouseRtl(client) {
  const [source, stock] = await Promise.all([
    client.from('inventory_snapshot_archives').select('source_file,snapshot_date,imported_at').eq('source_type','STOCK').order('snapshot_date',{ascending:false}).limit(1).maybeSingle(),
    client.from('stock_items').select('item_code,raw_source').eq('is_current_snapshot',true).in('item_code',RTL_PRESENTATION_ITEMS),
  ])
  if (source.error) throw source.error
  if (stock.error) throw stock.error
  return makeWarehouseRtlModel(stock.data || [], source.data)
}
