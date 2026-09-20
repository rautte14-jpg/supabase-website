const clean = (v) => String(v ?? '').trim()

const normalized = (s) =>
  clean(s)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '')

function lookup(row, names) {
  const entries = Object.entries(row)
  for (const name of names) {
    const wanted = normalized(name)
    const hit = entries.find(([key]) => normalized(key) === wanted)
    if (hit && clean(hit[1]) !== '') return hit[1]
  }
  return ''
}

const text = (row, names) => clean(lookup(row, names))
const number = (row, names) => {
  const raw = String(lookup(row, names) ?? '').replace(/,/g, '').trim()
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

const date = (row, names) => {
  const raw = lookup(row, names)
  if (!raw) return null
  if (raw instanceof Date && !Number.isNaN(raw.valueOf())) {
    return raw.toISOString().slice(0, 10)
  }
  if (typeof raw === 'number') {
    const base = new Date(Date.UTC(1899, 11, 30))
    base.setUTCDate(base.getUTCDate() + raw)
    return base.toISOString().slice(0, 10)
  }
  const d = new Date(raw)
  return Number.isNaN(d.valueOf()) ? null : d.toISOString().slice(0, 10)
}

const rawSource = (row) => row

export const SOURCE_OPTIONS = [
  ['PRF', 'PRF / IPF Register'],
  ['PR', 'ERP PR Lines'],
  ['PO', 'ERP PO List'],
  ['MTR', 'MTR Register'],
  ['MRN', 'MRN / Material Request Register'],
  ['TRANSACTIONS', 'ERP Receipts & Issues'],
  ['STOCK', 'On-hand Stock'],
  ['AGEING', 'Inventory Ageing'],
]

export function mapRows(source, rows) {
  if (source === 'PRF') {
    return rows.map((r) => {
      const linked = text(r, ['PR/MTR Number', 'PR / MTR Number', 'PR-MTR Number', 'Linked PR/MTR'])
      const directPrf = text(r, ['PRF', 'PRF No', 'PRF/IPF', 'PRF/IPF Number', 'PRF / IPF Number', 'IPF', 'PRF Number', 'PRF ID', 'Request Number', 'Title'])
      const linkedPrf = linked.match(/\b(?:[A-Z]{2,6}\s+)?PRF\s*-?\s*\d+\b/i)?.[0] || ''
      const linkedPr = linked.match(/\bPR\s*-?\s*\d+\b/i)?.[0] || ''

      const latest = text(r, ['Latest Updates', 'Latest Update', 'Updates'])
      const cancelReason = text(r, ['CANCEL / REJECT REASON', 'Cancel / Reject Reason', 'Cancel Reject Reason'])

      return {
        prf_no: directPrf || linkedPrf,
        pr_no: linkedPr,
        po_no: text(r, ['PO', 'PO No', 'PO Number', 'Purchase Order']),
        linked_pr_mtr: linked,
        section: text(r, ['Section', 'Department']),
        workshop: text(r, ['Workshop', 'Workshop/Section']),
        vessel: text(r, ['Vessel', 'Asset Name', 'Vessel Name']),
        asset: text(r, ['Asset / Service', 'Asset/Service', 'Asset', 'Service']),
        sr_wo: text(r, ['SR Number / WO Number', 'SR/WO', 'SR / WO', 'SR Number', 'WO Number', 'Service Request', 'Work Order']),
        work_order_type: text(r, ['Work Order Type']),
        purchase_from: text(r, ['Purchase From']),
        purchase_type: text(r, ['Purchase Type']),
        priority: text(r, ['Priority', 'Urgency']),
        supplier: text(r, ['Supplier', 'Vendor', 'Supplier Name']),
        item_code: text(r, ['Item', 'Item Code', 'Item Number', 'Item ID']),
        item_description: text(r, ['Description', 'Item Description', 'Product Name', 'Request Description']),
        unit: text(r, ['Unit', 'UOM']),
        qty_requested: number(r, ['Requested Qty', 'Request Qty', 'Quantity', 'PR Qty']),
        qty_ordered: number(r, ['Ordered Qty', 'PO Qty', 'Order Qty']),
        qty_received: number(r, ['Received', 'Received Qty', 'Receipt Qty']),
        balance_qty: number(r, ['Balance', 'Balance Qty', 'Remaining Qty']),
        currency: text(r, ['Currency']),
        amount: number(r, ['Amount', 'PO Amount', 'Total Amount', 'Value']),
        pr_date: date(r, ['PR Date', 'Created Date', 'PR Created Date', 'Created']),
        po_date: date(r, ['PO Date', 'Purchase Order Date']),
        required_date: date(r, ['Required Date', 'Need By Date']),
        processed_date: date(r, ['Processed Date', 'Processing Date']),
        expected_delivery: date(r, ['Delivery Date', 'Expected Delivery', 'ETA']),
        payment_status: text(r, ['Payment Status', 'Payment']),
        delivery_status: text(r, ['Delivery Status', 'Delivery']),
        requested_by: text(r, ['Requested By', 'Requester', 'Created By']),
        modified_by: text(r, ['Modified By']),
        cancel_reject_reason: cancelReason,
        latest_updates: latest,
        status: text(r, ['Status', 'PRF Status']),
        remarks: latest || cancelReason || text(r, ['Remarks', 'Remark', 'Comments']),
        source_type: source,
        source_updated_at: new Date().toISOString(),
        raw_source: rawSource(r),
      }
    }).filter((r) =>
      r.prf_no ||
      r.linked_pr_mtr ||
      r.sr_wo ||
      r.asset ||
      r.workshop ||
      r.status
    )
  }

  if (source === 'PR' || source === 'PO') {
    return rows.map((r) => ({
      prf_no: text(r, ['PRF', 'PRF No', 'PRF/IPF', 'IPF', 'PRF Number']),
      pr_no: text(r, ['PR', 'PR No', 'PR Number']),
      po_no: text(r, ['PO', 'PO No', 'PO Number', 'Purchase Order']),
      linked_pr_mtr: text(r, ['PR/MTR Number', 'PR / MTR Number']),
      section: text(r, ['Section', 'Department']),
      workshop: text(r, ['Workshop', 'Workshop/Section']),
      vessel: text(r, ['Vessel', 'Asset Name', 'Vessel Name']),
      asset: text(r, ['Asset', 'Asset/Service', 'Asset / Service', 'Service']),
      sr_wo: text(r, ['SR/WO', 'SR / WO', 'SR Number / WO Number', 'SR', 'WO', 'Service Request', 'Work Order']),
      work_order_type: text(r, ['Work Order Type']),
      purchase_from: text(r, ['Purchase From']),
      purchase_type: text(r, ['Purchase Type']),
      priority: text(r, ['Priority', 'Urgency']),
      supplier: text(r, ['Supplier', 'Vendor', 'Supplier Name']),
      item_code: text(r, ['Item', 'Item Code', 'Item Number', 'Item ID']),
      item_description: text(r, ['Description', 'Item Description', 'Product Name']),
      unit: text(r, ['Unit', 'UOM']),
      qty_requested: number(r, ['Requested Qty', 'Request Qty', 'Quantity', 'PR Qty']),
      qty_ordered: number(r, ['Ordered Qty', 'PO Qty', 'Order Qty']),
      qty_received: number(r, ['Received', 'Received Qty', 'Receipt Qty']),
      balance_qty: number(r, ['Balance', 'Balance Qty', 'Remaining Qty']),
      currency: text(r, ['Currency']),
      amount: number(r, ['Amount', 'PO Amount', 'Total Amount', 'Value']),
      pr_date: date(r, ['PR Date', 'Created Date', 'PR Created Date']),
      po_date: date(r, ['PO Date', 'Purchase Order Date']),
      required_date: date(r, ['Required Date', 'Need By Date']),
      processed_date: date(r, ['Processed Date']),
      expected_delivery: date(r, ['Delivery Date', 'Expected Delivery', 'ETA']),
      payment_status: text(r, ['Payment Status', 'Payment']),
      delivery_status: text(r, ['Delivery Status', 'Delivery']),
      requested_by: text(r, ['Requested By', 'Requester']),
      modified_by: text(r, ['Modified By']),
      cancel_reject_reason: text(r, ['CANCEL / REJECT REASON', 'Cancel / Reject Reason']),
      latest_updates: text(r, ['Latest Updates', 'Latest Update']),
      status: text(r, ['Status', 'PR Status', 'PO Status']),
      remarks: text(r, ['Remarks', 'Remark', 'Comments', 'Latest Updates']),
      source_type: source,
      source_updated_at: new Date().toISOString(),
      raw_source: rawSource(r),
    })).filter((r) => r.prf_no || r.pr_no || r.po_no || r.item_code)
  }

  if (source === 'MTR' || source === 'MRN') {
    return rows.map((r) => ({
      document_type: source,
      document_no: text(r, [source, source + ' No', 'Document No', 'Request No']),
      document_date: date(r, [source + ' Date', 'Date', 'Request Date']),
      workshop: text(r, ['Workshop', 'Section']),
      vessel: text(r, ['Vessel', 'Asset Name', 'Vessel Name']),
      asset: text(r, ['Asset', 'Asset/Service', 'Service']),
      sr_wo: text(r, ['SR/WO', 'SR', 'WO', 'Service Request', 'Work Order']),
      item_code: text(r, ['Item', 'Item Code', 'Item Number', 'Item ID']),
      item_description: text(r, ['Description', 'Item Description', 'Product Name']),
      unit: text(r, ['Unit', 'UOM']),
      requested_qty: number(r, ['Requested Qty', 'Request Qty', 'Quantity']),
      transferred_qty: number(r, ['Transferred Qty', 'Transfer Qty']),
      issued_qty: number(r, ['Issued Qty', 'Issue Qty']),
      remaining_qty: number(r, ['Remaining', 'Remaining Qty', 'Balance', 'Balance Qty']),
      status: text(r, ['Status']),
      remarks: text(r, ['Remarks', 'Remark', 'Comments']),
      source_updated_at: new Date().toISOString(),
      raw_source: rawSource(r),
    })).filter((r) => r.document_no || r.item_code || r.sr_wo)
  }

  if (source === 'TRANSACTIONS') {
    return rows.map((r) => ({
      physical_date: date(r, ['Physical Date', 'Date', 'Transaction Date']),
      transaction_type: text(r, ['Type', 'Transaction Type', 'Receipt/Issue']),
      item_code: text(r, ['Item', 'Item Code', 'Item Number', 'Item ID']),
      item_description: text(r, ['Description', 'Item Description', 'Product Name']),
      quantity: number(r, ['Quantity', 'Qty']),
      unit: text(r, ['Unit', 'UOM']),
      cost: number(r, ['Cost', 'Cost Amount', 'Value']),
      po_no: text(r, ['PO', 'PO No', 'Purchase Order']),
      sales_order: text(r, ['Sales Order', 'SO', 'SO No']),
      journal_no: text(r, ['Journal', 'Journal No', 'Journal Number']),
      delivery_name: text(r, ['Delivery Name', 'Delivery']),
      vessel: text(r, ['Vessel', 'Asset']),
      sr_wo: text(r, ['SR/WO', 'SR', 'WO']),
      status: text(r, ['Status']),
      raw_source: rawSource(r),
    })).filter((r) => r.item_code || r.po_no || r.sales_order || r.journal_no)
  }

  if (source === 'STOCK') {
    return rows.map((r) => {
      const onHand = number(r, ['On Hand', 'On-hand', 'Physical Inventory', 'Stock'])
      const reserved = number(r, ['Reserved', 'Reserved Qty'])
      const available = number(r, ['Available', 'Available Qty'])
      const onOrder = number(r, ['On Order', 'On Ordered Qty', 'Ordered Qty'])
      const unitCost = number(r, ['Unit Cost', 'Cost Price', 'Cost'])
      return {
        item_code: text(r, ['Item', 'Item Code', 'Item Number', 'Item ID']),
        item_description: text(r, ['Description', 'Item Description', 'Product Name']),
        unit: text(r, ['Unit', 'UOM']),
        on_hand: onHand ?? 0,
        reserved: reserved ?? 0,
        available: available ?? ((onHand ?? 0) - (reserved ?? 0)),
        on_order: onOrder ?? 0,
        unit_cost: unitCost ?? 0,
        stock_value: number(r, ['Stock Value', 'Inventory Value']) ?? ((onHand ?? 0) * (unitCost ?? 0)),
        age_band: text(r, ['Age Band', 'Ageing', 'Aging']),
        last_transaction_date: date(r, ['Last Transaction Date', 'Last Movement Date']),
        source_updated_at: new Date().toISOString(),
        raw_source: rawSource(r),
        updated_at: new Date().toISOString(),
      }
    }).filter((r) => r.item_code)
  }

  if (source === 'AGEING') {
    return rows.map((r) => ({
      item_code: text(r, ['Item', 'Item Code', 'Item Number', 'Item ID']),
      age_band: text(r, ['Age Band', 'Ageing', 'Aging', 'Inventory Age']),
      stock_value: number(r, ['Stock Value', 'Inventory Value', 'Value']),
      last_transaction_date: date(r, ['Last Transaction Date', 'Last Movement Date']),
      source_updated_at: new Date().toISOString(),
    })).filter((r) => r.item_code)
  }

  return []
}

export function entityKey(type, row) {
  if (type === 'procurement') {
    return [
      row.po_no || row.pr_no || row.prf_no || 'NOREF',
      row.item_code || row.item_description || 'NOITEM',
      row.sr_wo || row.vessel || row.asset || '',
    ].join('|')
  }
  if (type === 'material') {
    return [
      row.document_type,
      row.document_no || 'NOREF',
      row.item_code || row.item_description || 'NOITEM',
      row.sr_wo || row.vessel || '',
    ].join('|')
  }
  if (type === 'stock') return row.item_code
  return String(row.id ?? '')
}

export function humanSource(source) {
  return SOURCE_OPTIONS.find(([value]) => value === source)?.[1] ?? source
}
