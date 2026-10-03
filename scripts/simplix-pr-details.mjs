const GET_REQUEST_TIMELINE_QUERY = [
  'query GetRequestTimeline($prRecId: Float!, $purchReqId: String!, $createdAt: Date) {',
  '  getRequestTimeline(prRecId: $prRecId, purchReqId: $purchReqId, createdAt: $createdAt) {',
  '    PRWorkflowGroup {',
  '      Workflow { ApprovedDate ApprovedDateTime Position RecId Status UserName daysBetween hoursBetween Comment __typename }',
  '      totalTimeSpent',
  '      __typename',
  '    }',
  '    POWorkflow {',
  '      PurchId',
  '      Workflow { ApprovedDate Position ApprovedDateTime RecId Status UserName daysBetween hoursBetween Comment __typename }',
  '      __typename',
  '    }',
  '    ProductReceipts { createdAt id po productReciept recId __typename }',
  '    __typename',
  '  }',
  '}',
].join('\n')

const GET_ALL_DATA_QUERY = [
  'query GetAllDatafromPR($prRecId: Float!, $purchReqId: String!) {',
  '  getAllDatafromPR(prRecId: $prRecId, purchReqId: $purchReqId) {',
  '    RFQs { id recId rfqId status title expiration deliveryDate __typename }',
  '    PurchaseOrderDetailsWithWorkflowHistory {',
  '      PurchId PurchStatus RFQNumber PurchName VendorAccount InventSiteId InventLocationId PendingApprovers __typename',
  '    }',
  '    ProductReceipts { id po createdAt recId productReciept __typename }',
  '    FixedAssets { ItemId Name IsFixedAsset IsAssetAcquired BusinessJustification PurchReqName Reason __typename }',
  '    __typename',
  '  }',
  '}',
].join('\n')

function lower(value) {
  return String(value ?? '').toLowerCase()
}

function parseHeaderDate(row) {
  const value = row?.created_at || row?.createdAt || null
  if (value) {
    const date = new Date(value)
    if (!Number.isNaN(date.valueOf())) return date
  }

  const raw = String(row?.created_at_raw || row?.createdAt || '').trim()
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i)
  if (!match) return null

  let [, month, day, year, hour, minute, second, meridiem] = match
  hour = Number(hour)
  if (meridiem.toLowerCase() === 'pm' && hour !== 12) hour += 12
  if (meridiem.toLowerCase() === 'am' && hour === 12) hour = 0

  const date = new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute), Number(second))
  return Number.isNaN(date.valueOf()) ? null : date
}

function isOpenStatus(status) {
  const text = lower(status)
  if (!text) return true
  return !['closed', 'completed', 'complete', 'cancelled', 'canceled', 'rejected'].some((word) => text.includes(word))
}

function detailCandidates(headers, syncedMap, recentDays, staleHours, maxDetails) {
  const now = Date.now()
  const recentCutoff = now - recentDays * 86400000
  const staleCutoff = now - staleHours * 3600000

  return headers
    .filter((row) => {
      const prNo = String(row.purch_req_id || row.purchReqId || '').trim()
      const recId = row.rec_id ?? row.recId
      if (!prNo || !recId) return false

      const created = parseHeaderDate(row)
      const recent = created ? created.valueOf() >= recentCutoff : false
      if (!recent && !isOpenStatus(row.status)) return false

      const previous = syncedMap.get(prNo)
      if (!previous) return true
      const lastSync = new Date(previous).valueOf()
      return Number.isNaN(lastSync) || lastSync < staleCutoff
    })
    .sort((a, b) => {
      const aDate = parseHeaderDate(a)?.valueOf() || 0
      const bDate = parseHeaderDate(b)?.valueOf() || 0
      return bDate - aDate
    })
    .slice(0, maxDetails)
}

async function graphqlRequest({ url, bearerToken, operationName, variables, query }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: bearerToken.toLowerCase().startsWith('bearer ')
        ? bearerToken
        : 'Bearer ' + bearerToken,
    },
    body: JSON.stringify({ operationName, variables, query }),
  })

  const bodyText = await response.text()
  let payload = null
  try {
    payload = JSON.parse(bodyText)
  } catch {
    payload = null
  }

  const authFailed =
    response.status === 401 ||
    payload?.errors?.some((item) =>
      String(item?.extensions?.code || '').toUpperCase() === 'UNAUTHENTICATED' ||
      lower(item?.message).includes('unauthorized')
    )

  if (authFailed) return { authFailed: true, data: null }
  if (!response.ok) throw new Error(operationName + ' returned HTTP ' + response.status + ': ' + bodyText.slice(0, 500))
  if (payload?.errors?.length) throw new Error(operationName + ' GraphQL error: ' + JSON.stringify(payload.errors))

  return { authFailed: false, data: payload?.data || {} }
}

async function requestWithFreshToken({ url, tokenState, promptHidden, operationName, variables, query, onTokenChange }) {
  let result = await graphqlRequest({
    url,
    bearerToken: tokenState.value,
    operationName,
    variables,
    query,
  })

  if (!result.authFailed) return result.data

  console.log('\nSimplix authorization expired while loading PR detail data.')
  console.log('Refresh Simplix in Chrome, copy a fresh bearer token, then paste it below.')
  const freshToken = await promptHidden('Fresh Simplix bearer token: ')
  if (!freshToken) throw new Error('A fresh Simplix bearer token is required to continue.')

  tokenState.value = freshToken
  if (onTokenChange) onTokenChange(freshToken)

  result = await graphqlRequest({
    url,
    bearerToken: freshToken,
    operationName,
    variables,
    query,
  })

  if (result.authFailed) throw new Error('The replacement Simplix token was also rejected.')
  return result.data
}

function currentWorkflowStep(workflow) {
  const steps = Array.isArray(workflow) ? workflow : []
  const pending = steps.find((step) => lower(step?.Status).includes('pending'))
  return pending || steps[steps.length - 1] || null
}

async function loadExistingDetailSyncs(supabase) {
  const map = new Map()
  let from = 0
  const pageSize = 1000

  while (true) {
    const { data, error } = await supabase
      .from('erp_pr_details')
      .select('purch_req_id,detail_synced_at')
      .range(from, from + pageSize - 1)

    if (error) throw error
    for (const row of data || []) map.set(String(row.purch_req_id || '').trim(), row.detail_synced_at)
    if (!data || data.length < pageSize) break
    from += pageSize
  }

  return map
}

export async function syncPrDetails({
  supabase,
  url,
  bearerToken,
  headers,
  promptHidden,
  onTokenChange,
  recentDays = 180,
  staleHours = 6,
  maxDetails = 100,
  dryRun = false,
}) {
  const syncedMap = await loadExistingDetailSyncs(supabase)
  const candidates = detailCandidates(headers, syncedMap, recentDays, staleHours, maxDetails)

  console.log('\nPR detail sync candidates: ' + candidates.length)
  if (!candidates.length) return { bearerToken, synced: 0 }

  const tokenState = { value: bearerToken }
  let synced = 0

  for (const header of candidates) {
    const prNo = String(header.purch_req_id || header.purchReqId || '').trim()
    const recId = Number(header.rec_id ?? header.recId)
    const createdAt = header.created_at_raw || header.createdAt || null

    process.stdout.write('Detail ' + (synced + 1) + '/' + candidates.length + ' · ' + prNo + ' ... ')

    const timelineData = await requestWithFreshToken({
      url,
      tokenState,
      promptHidden,
      onTokenChange,
      operationName: 'GetRequestTimeline',
      variables: { prRecId: recId, purchReqId: prNo, createdAt },
      query: GET_REQUEST_TIMELINE_QUERY,
    })

    const allData = await requestWithFreshToken({
      url,
      tokenState,
      promptHidden,
      onTokenChange,
      operationName: 'GetAllDatafromPR',
      variables: { prRecId: recId, purchReqId: prNo },
      query: GET_ALL_DATA_QUERY,
    })

    const timeline = timelineData?.getRequestTimeline || {}
    const details = allData?.getAllDatafromPR || {}
    const prWorkflowGroup = timeline.PRWorkflowGroup || {}
    const prWorkflow = prWorkflowGroup.Workflow || []
    const current = currentWorkflowStep(prWorkflow)
    const receipts = details.ProductReceipts || timeline.ProductReceipts || []
    const rfqs = details.RFQs || []
    const purchaseOrders = details.PurchaseOrderDetailsWithWorkflowHistory || []

    const row = {
      purch_req_id: prNo,
      pr_rec_id: recId,
      pr_workflow: prWorkflow,
      po_workflow: timeline.POWorkflow || [],
      rfqs,
      purchase_orders: purchaseOrders,
      product_receipts: receipts,
      fixed_assets: details.FixedAssets || [],
      current_approver: current?.UserName || null,
      current_position: current?.Position || null,
      current_workflow_status: current?.Status || null,
      total_pr_workflow_time: prWorkflowGroup.totalTimeSpent == null ? null : String(prWorkflowGroup.totalTimeSpent),
      rfq_count: rfqs.length,
      po_count: purchaseOrders.length,
      receipt_count: receipts.length,
      detail_synced_at: new Date().toISOString(),
    }

    if (!dryRun) {
      const { error } = await supabase
        .from('erp_pr_details')
        .upsert(row, { onConflict: 'purch_req_id' })
      if (error) throw error
    }

    synced += 1
    console.log(dryRun ? 'checked' : 'synced')
  }

  return { bearerToken: tokenState.value, synced }
}
