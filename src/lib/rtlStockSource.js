export function rtlStockFromRecords(records, items) {
  const result=Object.fromEntries(items.map(item=>[item,null]))
  let recognized=0
  for(const record of records) {
    const normalized=Object.fromEntries(Object.entries(record.raw_source || {}).map(([k,v])=>[k.toLowerCase().replace(/[^a-z0-9]/g,''),v]))
    const raw=normalized.availablephysical ?? normalized.availableonhandquantity
    if(raw === null || raw === undefined || raw === '') continue
    const quantity=Number(String(raw).replace(/,/g,''))
    if(!Number.isFinite(quantity) || quantity<0) continue
    recognized++
    if(Object.hasOwn(result,record.item_code)) result[record.item_code]=quantity
  }
  if(records.length && !recognized) throw new Error('The saved on-hand export does not supply Available physical. Upload the Dynamics on-hand export; ageing quantities cannot substitute for usable stock.')
  return result
}
