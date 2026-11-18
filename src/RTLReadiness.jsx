import { useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { rtlStockFromRecords } from './lib/rtlStockSource.js'
import { RTL_STANDARD_REQUIREMENTS, rtlStandardRequirementRows } from './rtlMechanicStandard.js'
import { calculateRtlShortages, evaluateRequirementRows } from './lib/rtlCoverage.js'
import { RTL_ROWS, RTL_SOURCE } from './rtlSpareSnapshot.js'
import { RTL_PM_METADATA } from './rtlPartMetadataPm.js'
import { RTL_STANDARD_METADATA } from './rtlPartMetadataStandard.js'
import { RTL_CONDITIONAL_METADATA } from './rtlPartMetadataConditional.js'
import * as XLSX from 'xlsx'
import './rtlReadiness.css'

const TYPES = [
  { key: 'PM1', group: '1', label: 'PM1 Service', short: 'PM1', description: 'Routine PM1 spare-parts set' },
  { key: 'PM2', group: '2', label: 'PM2 Service', short: 'PM2', description: 'Routine PM2 spare-parts set' },
  { key: 'PM3', group: '3', label: 'PM3 Service', short: 'PM3', description: 'Routine PM3 spare-parts set' },
  { key: 'PM4', group: '4', label: 'PM4 Service', short: 'PM4', description: 'Routine PM4 spare-parts set' },
  { key: 'STANDARD', group: 'S', label: 'Standard Overhaul', short: 'Standard', description: `Mechanic-team standard: ${RTL_STANDARD_REQUIREMENTS.length} active item lines per engine; 2 engines per vessel` },
  { key: 'FULL', group: 'FULL', label: 'Extended Overhaul (Earlier List)', short: 'Extended', description: 'Earlier 263-item reference; separate scope from the new mechanic-team standard' },
]
// Metadata is retained from the original PM and overhaul requirement sheets.
const RTL_ITEM_INFO = new Map()
let pmIndex = 0
for (const [group, item] of RTL_ROWS) {
  if (group === '1' || group === '2' || group === '3' || group === '4') {
    const [partNumber, description] = RTL_PM_METADATA[pmIndex++] || ['', '']
    RTL_ITEM_INFO.set(group + '|' + item, { partNumber, description })
  }
}
for (const [item, partNumber, description] of RTL_STANDARD_METADATA) {
  RTL_ITEM_INFO.set('S|' + item, { partNumber, description })
}
for (const [item, partNumber, description] of RTL_CONDITIONAL_METADATA) {
  RTL_ITEM_INFO.set('C|' + item, { partNumber, description })
}
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
for (const row of RTL_STANDARD_REQUIREMENTS) {
  RTL_ITEM_INFO.set('S|' + row.item, {partNumber:row.partNumber, description:row.description})
}
const targetRows = type => type === 'S' ? rtlStandardRequirementRows() : RTL_ROWS.filter(([g]) => type === 'FULL' ? (g === 'S' || g === 'C') : g === type)

// Every category uses per-vessel quantities; the mechanic standard is supplied per engine.
export function evaluateRtlGroup(group, stockByItem, fleetSize = 28, target = 1) {
  const result = evaluateRequirementRows(targetRows(group), stockByItem, fleetSize, target)
  return {...result, rows:result.rows.map(row => ({...row,
    name:RTL_ITEM_INFO.get(row.group + '|' + row.item)?.description || '',
    partNumber:RTL_ITEM_INFO.get(row.group + '|' + row.item)?.partNumber || '',
  }))}
}

function readStockImport(rows) {
  const data = {}
  let found = 0
  for (const row of rows) {
    const normal = Object.fromEntries(Object.entries(row).map(([key, value]) =>
      [String(key).replace(/[^a-z0-9]/gi, '').toLowerCase(), value]))
    const id = String(normal.itemnumber ?? normal.itemno ?? normal.productidentification ?? '').trim()
    if (!/^\d-\d{7}$/.test(id)) continue
    const raw = normal.availablephysical ?? normal.availableonhandquantity
    if (raw === undefined || raw === null || raw === '') continue
    const value = Number(String(raw).replace(/,/g, ''))
    if (!Number.isFinite(value) || value < 0) continue
    data[id] = value
    found++
  }
  if (!found) throw Error('No item-number and Available physical columns were recognized. Please use the Dynamics on-hand export format.')
  return data
}

const REQUIRED_ITEMS=[...new Set([...RTL_ROWS.map(row=>row[1]), ...RTL_STANDARD_REQUIREMENTS.map(row=>row.item)])]
const EMPTY_STOCK=Object.fromEntries(REQUIRED_ITEMS.map(item=>[item,null]))

export default function RTLReadiness({refreshKey=0}) {
  const [selected, setSelected] = useState('STANDARD')
  const [target, setTarget] = useState(1)
  const [targetUnit, setTargetUnit] = useState('engines')
  const [filter, setFilter] = useState('blockers')
  const [search, setSearch] = useState('')
  const [stockOverride, setStockOverride] = useState({...EMPTY_STOCK})
  const [savedStock, setSavedStock] = useState({...EMPTY_STOCK})
  const [savedSource, setSavedSource] = useState(null)
  const [loadingSaved, setLoadingSaved] = useState(true)
  const [savedError, setSavedError] = useState('')
  const [importLabel, setImportLabel] = useState('')
  const [importError, setImportError] = useState('')
  const [importing, setImporting] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [showQuantityHelp, setShowQuantityHelp] = useState(false)
  useEffect(() => {
    let active=true
    setLoadingSaved(true)
    setSavedError('')
    ;(async()=>{
      try {
        const [source,stock]=await Promise.all([
          supabase.from('inventory_snapshot_archives').select('source_file,snapshot_date,imported_at').eq('source_type','STOCK').order('snapshot_date',{ascending:false}).limit(1).maybeSingle(),
          supabase.from('stock_items').select('item_code,raw_source').eq('is_current_snapshot',true).in('item_code',REQUIRED_ITEMS),
        ])
        if(source.error) throw source.error
        if(stock.error) throw stock.error
        if(!source.data) throw new Error('No saved on-hand report is available. Upload On-hand Stock in Update Centre.')
        const values=rtlStockFromRecords(stock.data || [],REQUIRED_ITEMS)
        if(active){setSavedStock(values);setStockOverride(values);setSavedSource(source.data);setImportLabel('')}
      } catch(error) {if(active){setSavedError(error.message || 'Could not load saved on-hand stock');setStockOverride({...EMPTY_STOCK})}}
      finally {if(active) setLoadingSaved(false)}
    })()
    return()=>{active=false}
  },[refreshKey])
  const coverage = useMemo(() => TYPES.map(type => ({
    ...type, ...evaluateRtlGroup(type.group, stockOverride, RTL_SOURCE.fleetSize, 1),
  })), [stockOverride])
  const vesselCoverage = coverage.find(row => row.key === selected) || coverage[0]
  const engineModeAvailable = vesselCoverage.rows.every(row => Number.isInteger(row.perVessel / 2))
  const planUnit = engineModeAvailable ? targetUnit : 'vessels'
  const maxTarget = planUnit === 'engines' ? 56 : 28
  const planTarget = Math.min(target, maxTarget)
  const targetLabel = planTarget === 1 ? planUnit.slice(0, -1) : planUnit
  const current = useMemo(() => ({...vesselCoverage, ...calculateRtlShortages(vesselCoverage.rows, planTarget, planUnit)}), [vesselCoverage, planTarget, planUnit])
  const itemsBelowTarget = current.rows.filter(row => row.missing || row.shortage > 0).length
  const visibleRows = useMemo(() => current.rows
    .filter(row => {
      if (filter === 'missing') return row.missing
      if (filter === 'short') return !row.missing && row.shortage > 0
      if (filter === 'blockers') return row.missing || row.shortage > 0
      return true
    })
    .filter(row => !search || (row.item + ' ' + row.name + ' ' + row.partNumber).toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.missing) - Number(a.missing) || b.provisionalNeed - a.provisionalNeed || a.item.localeCompare(b.item)),
  [current, filter, search])

  async function uploadStock(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setImporting(true)
    setImportError('')
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
      const updated = readStockImport(rows)
      // Override all items in this export. Items omitted from the new source stay missing.
      const all = Object.fromEntries(REQUIRED_ITEMS.map(item => [item, Object.hasOwn(updated, item) ? updated[item] : null]))
      setStockOverride(all)
      setImportLabel(file.name)
      setFilter('blockers')
    } catch (error) {
      setImportError(error.message || 'Unable to read stock export.')
    } finally {
      setImporting(false)
      event.target.value = ''
    }
  }
  function reset() {
    setStockOverride(savedStock)
    setImportLabel('')
    setImportError('')
  }
  function downloadShortages() {
    const lines = [
      ['Maintenance type', 'Item number', 'Manufacturer part number', 'Item description', 'Per engine', 'Per vessel (2 engines)', 'Available physical', 'Source record', 'Target count', 'Target unit', 'Required for target', 'Additional units required (unlisted stock = 0)'].join(','),
      ...current.rows.filter(row => row.missing || row.shortage > 0).map(row =>
        [current.label, row.item, row.partNumber, row.name, engineModeAvailable ? row.perVessel / 2 : '', row.perVessel, row.missing ? 0 : row.available,
          row.missing ? 'NOT IN ON-HAND REPORT - UNAVAILABLE' : 'PRESENT',
          planTarget, planUnit, row.required, row.shortage]
          .map(value => '"' + String(value).replace(/"/g, '""') + '"').join(',')),
    ]
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'RTL-' + selected + '-shortages-' + planTarget + '-' + planUnit + '.csv'
    link.click()
    URL.revokeObjectURL(url)
  }
  if (loadingSaved) return <section className="rtl-shell"><p role="status">Loading the latest saved on-hand stock…</p></section>
  return <section className="rtl-shell">
    <header className="rtl-hero">
      <div>
        <span className="rtl-eyebrow">MTCC · SHIPBUILDING & REPAIR DIVISION</span>
        <h1>RTL Vessel Spares Readiness</h1>
        <p>Fleet maintenance coverage · 28 RTL vessels · 2 engines per vessel</p>
      </div>
      <div className="rtl-hero-mark">RTL <span>MAINTENANCE CONTROL</span></div>
    </header>
    {savedError && <div role="alert" className="rtl-warning">{savedError}</div>}
    <div className="rtl-warning">
      <div><strong>Planning snapshot — warehouse scope not verified.</strong><span> Figures use Available physical from {importLabel || savedSource?.source_file || 'the saved on-hand export'}{importLabel ? ' (temporary comparison)' : savedSource ? ' as of ' + savedSource.snapshot_date : ''}. Warehouse/site scope must be verified. Items not listed are treated as unavailable (zero usable stock). Do not treat coverage as confirmed vessel allocation.</span></div>
      <button type="button" onClick={() => setShowNotes(!showNotes)}>{showNotes ? 'Hide' : 'Method'}</button>
    </div>
    {showNotes && <div className="rtl-method">
      <p><b>Independent coverage:</b> For each category, complete-vessel coverage is the smallest floor(available physical ÷ quantity required per two-engine vessel), capped at 28. Each category is calculated separately; the same item can appear in PM and overhaul sets, and stock is not double-allocated.</p>
      <p><b>Overhaul definitions:</b> Standard uses the mechanic-team list supplied on 18 November: {RTL_STANDARD_REQUIREMENTS.length} active lines after excluding item 1-0018347, with quantities for one engine doubled for one two-engine vessel. The source numbering skips 92–95; only supplied lines are included. Extended Overhaul retains the earlier 263-item reference as a separate scope; it is not the new standard plus additional parts.</p>
      <p><b>Missing vs zero:</b> An item missing from the supplied on-hand report is unavailable (zero usable stock) for planning. It remains marked as not listed, distinguishing it from a confirmed zero balance.</p>
      <p><b>Uploaded stock:</b> On-hand Stock uploads in Update Centre update saved RTL readiness quantities only. The comparison upload below is temporary to this browser session. Warehouse figures use Inventory Ageing.</p>
    </div>}
    <div className="rtl-kpis">
      {coverage.map((card) => <button type="button" key={card.key} className={'rtl-kpi' + (selected === card.key ? ' selected' : '')} onClick={() => { setSelected(card.key); setFilter('blockers'); setSearch('') }}>
        <div className="rtl-kpi-caption">{card.label}</div>
        <div className="rtl-kpi-coverage"><strong>{card.coverage}</strong><span>/ {RTL_SOURCE.fleetSize}</span></div>
        <div className="rtl-kpi-progress"><span style={{ width: (card.coverage / RTL_SOURCE.fleetSize * 100) + '%' }} /></div>
        <div className="rtl-kpi-foot">{card.rows.length} required items · {card.blocked} blocking <span title="Items below the quantity required for one vessel, including items absent from the shared on-hand report">ⓘ</span></div>
      </button>)}
    </div>
    <div className="rtl-layout">
      <section className="rtl-panel rtl-coverage-panel">
        <div className="rtl-panel-title">
          <div><small>SELECTED MAINTENANCE CATEGORY</small><h2>{current.label}</h2><p>{current.description}</p></div>
          <span className="rtl-count">{current.coverage} fully covered</span>
        </div>
        <div className="rtl-progress-block">
          <div className="rtl-progress-heading"><span>Complete vessel coverage</span><b>{fmt(current.coverage)} of 28 vessels</b></div>
          <div className="rtl-progress-bar"><span style={{ width: current.coverage / 28 * 100 + '%' }} /></div>
        </div>
        <div className="rtl-stats">
          <div><small>Total required lines</small><strong>{current.rows.length}</strong></div>
          <div><small>Items below 1 vessel <button type="button" className="rtl-inline-help" aria-label="Explain items versus units" title="Explain items versus units" onClick={() => setShowQuantityHelp(true)}>ⓘ</button></small><strong>{current.belowOne}</strong></div>
          <div><small>Not in on-hand report</small><strong>{current.missing}</strong></div>
        </div>
      </section>
      <section className="rtl-panel rtl-plan-panel">
        <div className="rtl-panel-title"><div><small>ADDITIONAL COVERAGE PLAN</small><h2>Shortage calculator</h2><p>Quantities for your selected engine or vessel count</p></div></div>
        <div className="rtl-plan-units" role="group" aria-label="Shortage calculation unit">
          <button type="button" aria-pressed={planUnit === 'engines'} disabled={!engineModeAvailable} onClick={() => setTargetUnit('engines')}>Engines</button>
          <button type="button" aria-pressed={planUnit === 'vessels'} onClick={() => {setTargetUnit('vessels');setTarget(value => Math.min(28,value))}}>Vessels</button>
        </div>
        {!engineModeAvailable && <p className="rtl-calculator-note">This earlier list includes vessel-level requirements. Use vessel mode until per-engine quantities are confirmed.</p>}
        <label className="rtl-target">Target number of {planUnit}
          <input type="number" min="1" max={maxTarget} step="1" value={planTarget} onChange={event => setTarget(Math.min(maxTarget, Math.max(1, Math.round(Number(event.target.value) || 1))))} />
        </label>
        <p className="rtl-calculator-note">Checking {planTarget} {targetLabel}{planUnit === 'vessels' ? ' · ' + (planTarget * 2) + ' engines' : ''}. One RTL vessel has 2 engines. Coverage cards above remain in vessels.</p>
        <div className="rtl-calculator-results">
          <div><small>Additional units required <button type="button" className="rtl-inline-help" aria-label="Explain items versus units" title="Explain items versus units" onClick={() => setShowQuantityHelp(true)}>ⓘ</button></small><strong>{fmt(current.confirmedShortage)}</strong></div>
          <div><small>Not in on-hand report</small><strong>{current.missing}</strong></div>
        </div>
        <p className="rtl-calculator-note">Additional quantity includes items absent from the on-hand report (treated as zero usable stock). Confirm warehouse scope before procurement.</p>
      </section>
    </div>
    <section className="rtl-panel rtl-table-panel">
      <div className="rtl-table-heading">
        <div><small>STOCK EXCEPTIONS</small><h2>Limiting spares & item requirements</h2><p><b>Blocking</b> = short for the selected target of {planTarget} {targetLabel}, or unavailable in the on-hand report. Search by item number, part number, or description.</p></div>
        <div className="rtl-table-actions"><button type="button" onClick={downloadShortages}>Export shortages CSV</button></div>
      </div>
      <div className="rtl-controls">
        <div className="rtl-filters">
          {[['blockers','Blocking / unavailable'],['short','Shortage'],['missing','Not in report'],['all','All items']].map(([key,label]) => <button key={key} type="button" className={filter===key?'active':''} onClick={() => setFilter(key)}>{label}</button>)}
        </div>
        <input value={search} onChange={event => setSearch(event.target.value)} aria-label="Search item number, part number or description" placeholder="Search item, P/N or description…" />
      </div>
      <div className="rtl-table-scroll"><table><thead><tr>
        <th>Item number / description</th><th>Part number (P/N)</th>{engineModeAvailable && <th>Per engine</th>}<th>Per vessel (2 engines)</th><th>Available</th><th>Vessels covered</th><th>Need for {planTarget} {targetLabel}</th><th>Additional qty</th><th>Record status</th>
      </tr></thead><tbody>
        {visibleRows.map(row => <tr key={row.item}>
          <td><b>{row.item}</b>{row.name && <small>{row.name}</small>}</td><td className="rtl-part-number">{row.partNumber || '—'}</td>
          {engineModeAvailable && <td>{fmt(row.perVessel / 2)}</td>}<td>{fmt(row.perVessel)}</td><td>{row.missing ? '0 (not listed)' : fmt(row.available)}</td>
          <td>{fmt(Math.min(28,row.cover))}</td>
          <td>{fmt(row.required)}</td>
          <td>{fmt(row.shortage)}</td>
          <td><span className={'rtl-status ' + (row.missing?'missing': row.shortage > 0?'short':'ok')}>{row.missing ? 'Not in on-hand report' : row.shortage > 0 ? 'Target shortfall' : 'Recorded'}</span></td>
        </tr>)}
        {!visibleRows.length && <tr><td colSpan={engineModeAvailable ? 9 : 8} className="rtl-empty">No items match these filters.</td></tr>}
      </tbody></table></div>
      <div className="rtl-table-footer">Showing {visibleRows.length} of {current.rows.length} item lines · Source quantities use the latest saved on-hand upload, not live ERP updates</div>
    </section>
    <section className="rtl-panel rtl-update-panel">
      <div><small>UPDATE AVAILABLE PHYSICAL</small><h2>Compare with a newer Dynamics export</h2><p>The saved source updates when you upload On-hand Stock in Update Centre. You can also choose a file here for a temporary browser-only comparison.</p></div>
      <div className="rtl-upload-actions"><label className="rtl-upload-button">{importing ? 'Reading file…' : 'Choose Excel export'}<input type="file" accept=".xlsx,.xls,.csv" disabled={importing} onChange={uploadStock}/></label>{importLabel && <button type="button" onClick={reset}>Restore saved on-hand stock</button>}</div>
      {importLabel && <p className="rtl-upload-success">Temporary stock comparison loaded: {importLabel}</p>}
      {importError && <p role="alert" className="rtl-upload-error">{importError}</p>}
    </section>
    {showQuantityHelp && <div className="rtl-help-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowQuantityHelp(false) }}>
      <section className="rtl-help-dialog" role="dialog" aria-modal="true" aria-labelledby="rtl-items-units-title">
        <button type="button" className="rtl-help-close" aria-label="Close explanation" onClick={() => setShowQuantityHelp(false)}>×</button>
        <span className="rtl-eyebrow">HOW TO READ THE FIGURES</span>
        <h2 id="rtl-items-units-title">Spare parts vs. units</h2>
        <p><strong>Items</strong> counts the different spare-part lines that need more stock. <strong>Units</strong> adds up the actual quantities needed across those items.</p>
        <div className="rtl-help-comparison">
          <div><span>Spare-part items short for {planTarget} {targetLabel}</span><strong>{itemsBelowTarget}</strong><small>Different items with shortages</small></div>
          <div><span>Additional units needed</span><strong>{fmt(current.confirmedShortage)}</strong><small>Total quantity across those items</small></div>
        </div>
        <p className="rtl-help-context">{current.label}: For the selected target of {planTarget} {targetLabel}, these figures use the shared on-hand report. Items not listed in that report are treated as unavailable (zero usable stock).</p>
        {(planTarget !== 1 || planUnit === 'engines') && <p className="rtl-help-context">The “Items below 1 vessel” card always uses a one-vessel requirement; the calculator and the figures above use your selected target of {planTarget} {targetLabel}.</p>}
        <button type="button" className="rtl-help-done" onClick={() => setShowQuantityHelp(false)}>Got it</button>
      </section>
    </div>}
    <footer className="rtl-footer">Planning interpretation: individual vessel “Ready” statuses require Engineering inspection and allocation priorities; category coverage alone does not identify specific vessels.</footer>
  </section>
}
