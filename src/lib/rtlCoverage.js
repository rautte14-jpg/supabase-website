// Requirement rows store quantities per two-engine vessel.
export function evaluateRequirementRows(requirements, stockByItem, fleetSize = 28, target = 1) {
  const checkedQty = value => value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : null
  const rows = requirements.map(([group, item, perVessel, original]) => {
    const available = Object.hasOwn(stockByItem, item) ? checkedQty(stockByItem[item]) : checkedQty(original)
    const missing = available === null
    const cover = missing ? 0 : Math.floor(available / perVessel)
    const shortage = Math.max(0, perVessel * target - (available ?? 0))
    return {group, item, perVessel, available, missing, cover, shortage, provisionalNeed:shortage}
  })
  return {
    coverage: rows.length ? Math.min(fleetSize, ...rows.map(row => row.cover)) : 0,
    rows,
    missing: rows.filter(row => row.missing).length,
    belowOne: rows.filter(row => !row.missing && row.available < row.perVessel).length,
    blocked: rows.filter(row => row.missing || row.available < row.perVessel).length,
    confirmedShortage: rows.reduce((sum, row) => sum + row.shortage, 0),
  }
}

export function calculateRtlShortages(rows, target = 1, unit = 'vessels') {
  const divisor = unit === 'engines' ? 2 : 1
  const plannedRows = rows.map(row => {
    const perUnit = row.perVessel / divisor
    if (!Number.isInteger(perUnit)) throw new Error('This requirement is defined per vessel; engine quantities are not confirmed.')
    const required = perUnit * target
    const shortage = Math.max(0, required - (row.available ?? 0))
    return {...row, required, shortage, provisionalNeed:shortage}
  })
  return {rows:plannedRows, confirmedShortage:plannedRows.reduce((sum,row)=>sum+row.shortage,0)}
}
