import { createClient } from '@supabase/supabase-js'
import { requestSimplix } from './simplix-http.mjs'
import readline from 'node:readline'

const SUPABASE_URL = 'https://cqimpmvaobrnpejokuvx.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tAoik_yGhIhp3VCE2qnf4g_GAviUG_B'
const GRAPHQL_URL = process.env.SIMPLIX_GRAPHQL_URL ||
  'https://apisimplix-maldivetransportcontracting.msappproxy.net/graphql'

const PR_LINES_QUERY = `
query SRDSyncPRLines($query: PurchaseRequisitionLinesQueryInput!) {
  purchaseRequisitionLines(query: $query) {
    RecId
    ItemNumber
    ProductName
    LineDescription
    RequestedPurchaseQuantity
    PurchasePrice
    LineAmount
    CurrencyCode
    LineStatus
  }
}`

const arg = (name, fallback = '') => {
  const found = process.argv.find(v => v.startsWith('--' + name + '='))
  return found ? found.slice(name.length + 3) : fallback
}
const flag = name => process.argv.includes('--' + name)

function prompt(question, hidden = false) {
  if (!process.stdin.isTTY) throw new Error('Run from the interactive command prompt')
  if (!hidden || !process.stdin.setRawMode) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()) }))
  }
  return new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write(question)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    const clean = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', keypress)
    }
    const keypress = char => {
      if (char === '\u0003') { clean(); process.stdout.write('\n'); reject(new Error('Cancelled')); return }
      if (char === '\r' || char === '\n') { clean(); process.stdout.write('\n'); resolve(value.trim()); return }
      if (char === '\u007f' || char === '\b') { value = value.slice(0, -1); return }
      value += char
    }
    process.stdin.on('data', keypress)
  })
}

function numeric(value) {
  if (value === '' || value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function databaseLine(pr, item, index, time) {
  const recId = item.RecId == null ? '' : String(item.RecId).trim()
  return {
    purch_req_id: pr,
    line_key: recId ? 'recid:' + recId : 'position:' + String(index + 1),
    line_rec_id: recId || null,
    item_code: item.ItemNumber || null,
    item_name: item.ProductName || null,
    line_description: item.LineDescription || null,
    requested_qty: numeric(item.RequestedPurchaseQuantity),
    unit_price: numeric(item.PurchasePrice),
    line_amount: numeric(item.LineAmount),
    currency_code: item.CurrencyCode || null,
    line_status: item.LineStatus || null,
    synced_at: time,
  }
}

async function getPRLines(pr, token) {
  const all = []
  const pageSize = 100
  for (let offset = 0; offset < 5000; offset += pageSize) {
    const { response, bodyText } = await requestSimplix(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: /^bearer /i.test(token) ? token : 'Bearer ' + token,
      },
      body: JSON.stringify({
        operationName: 'SRDSyncPRLines',
        query: PR_LINES_QUERY,
        variables: { query: { requisitionNumber: pr, skip: offset, top: pageSize } },
      }),
    })

    let result
    try { result = JSON.parse(bodyText) } catch { throw new Error('Non-JSON response HTTP ' + response.status) }
    if (result?.errors?.length) {
      const codes = result.errors.map(e => e.extensions?.code || '').filter(Boolean).join(', ')
      const safe = result.errors.map(e => String(e.message || '').slice(0, 150)).join('; ')
      throw new Error('GraphQL ' + (codes || 'error') + ': ' + safe)
    }
    if (!response.ok) throw new Error('ERP HTTP ' + response.status)
    const lines = result?.data?.purchaseRequisitionLines
    if (!Array.isArray(lines)) throw new Error('Unexpected response: PR lines are not an array')
    all.push(...lines)
    if (lines.length < pageSize) return all
  }
  throw new Error('More than 5000 lines for ' + pr + ': limit reached; no data saved')
}

async function loadPRNumbers(supabase, year, limit) {
  const numbers = []
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('erp_pr_headers')
      .select('purch_req_id,created_at')
      .gte('created_at', year + '-01-01T00:00:00Z')
      .lt('created_at', String(year + 1) + '-01-01T00:00:00Z')
      .order('created_at', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw error
    const rows = data || []
    for (const row of rows) if (/^PR\d+(?:-\d+)?$/i.test(row.purch_req_id || '')) numbers.push(row.purch_req_id)
    if (rows.length < pageSize) break
  }
  return [...new Set(numbers)].slice(0, limit)
}

async function loadPreviouslySyncedPRs(supabase) {
  const seen = new Set()
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.from('erp_pr_line_items')
      .select('purch_req_id')
      .order('purch_req_id')
      .order('line_key')
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error('Failed to load saved PR lines: ' + error.message)
    for (const row of data || []) seen.add(row.purch_req_id)
    if (!data || data.length < pageSize) break
  }
  return seen
}

async function main() {
  const explicit = arg('pr').trim().toUpperCase()
  const year = Number(arg('year', String(new Date().getFullYear())))
  const limit = Number(arg('limit', '25'))
  const dryRun = flag('dry-run')
  const refreshAll = flag('refresh-all')
  if (explicit && !/^PR\d{4,12}(?:-\d+)?$/.test(explicit)) throw new Error('Expected --pr=PR104021')
  if (!Number.isInteger(year) || year < 2020 || year > 2100) throw new Error('Invalid --year')
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new Error('Use --limit between 1 and 5000')

  let token = process.env.SIMPLIX_BEARER_TOKEN || await prompt('Paste authorized production Simplix bearer token (hidden): ', true)
  if (!token) throw new Error('Simplix bearer token required')
  const email = process.env.SRD_PORTAL_EMAIL || await prompt('SRD portal email: ')
  const password = process.env.SRD_PORTAL_PASSWORD || await prompt('SRD portal password (hidden): ', true)
  if (!email || !password) throw new Error('SRD portal login required for protected Supabase writes')
  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError) throw new Error('SRD portal sign-in failed: ' + authError.message)

  const candidates = explicit ? [explicit] : await loadPRNumbers(supabase, year, limit)
  if (!candidates.length) { console.log('No PR headers found for the selected year.'); return }
  const previouslySynced = (!explicit && !refreshAll)
    ? await loadPreviouslySyncedPRs(supabase) : new Set()
  const numbers = candidates.filter(pr => !previouslySynced.has(pr))
  const skipped = candidates.length - numbers.length
  if (skipped) console.log('Resume mode: skipping ' + skipped + ' PRs with item lines already saved in Supabase.')
  if (!numbers.length) {
    console.log('All selected PRs have existing saved lines. Use --refresh-all to explicitly refresh their data.')
    return
  }
  console.log('\nRead-only ERP fetch for ' + numbers.length + ' remaining PR(s). ' +
    (dryRun ? 'DRY RUN — NO database writes.' : 'Saving lines to separate erp_pr_line_items table.'))
  let success = 0, failed = 0, savedLines = 0
  const failedPRs = []
  for (const [index, pr] of numbers.entries()) {
    try {
      let lines
      try {
        lines = await getPRLines(pr, token)
      } catch (error) {
        if (!/UNAUTHENTICATED|Unauthorized|ERP HTTP 401/i.test(error.message)) throw error
        console.log('Simplix token expired at ' + pr + '. Already saved PRs remain safe.')
        console.log('Refresh the live Simplix PR Tracking page and obtain a fresh authorized bearer token.')
        token = await prompt('Paste FRESH production Simplix bearer token (hidden): ', true)
        if (!token) throw new Error('No replacement token provided')
        // Retry this exact PR only once; no previously saved PRs are repeated.
        lines = await getPRLines(pr, token)
      }
      const now = new Date().toISOString()
      const rows = lines.map((line, i) => databaseLine(pr, line, i, now))
      // Protect against invalid or duplicate IDs silently overwriting items.
      if (new Set(rows.map(r => r.line_key)).size !== rows.length) {
        throw new Error('Duplicate PR line identifiers: skipped')
      }
      if (!dryRun && rows.length) {
        const { error } = await supabase.from('erp_pr_line_items')
          .upsert(rows, { onConflict: 'purch_req_id,line_key' })
        if (error) throw new Error('Supabase write rejected: ' + error.message)
      }
      success++
      savedLines += rows.length
      console.log('[' + (index + 1) + '/' + numbers.length + '] ' + pr + ': ' + rows.length +
        ' lines' + (dryRun ? ' checked' : ' saved'))
    } catch (error) {
      failed++
      failedPRs.push(pr)
      console.error('[' + (index + 1) + '/' + numbers.length + '] ' + pr + ': ' + error.message)
      if (/UNAUTHENTICATED|FORBIDDEN|Supabase write rejected|replacement token|Unauthorized/i.test(error.message)) {
        console.error('Stopping to avoid repeated unauthorized requests.')
        break
      }
    }
  }
  console.log('\nFinished. Already saved PRs skipped: ' + skipped +
    ' | New PRs successful: ' + success + ' | Failed: ' + failed +
    ' | Lines ' + (dryRun ? 'checked: ' : 'saved: ') + savedLines)
  if (failedPRs.length) {
    console.log('Failed PRs (no tokens included): ' + failedPRs.join(', '))
    process.exitCode = 1
  }
  console.log('Existing ERP header/receipt sync and reporting calculations were NOT modified.')
}

main().catch(error => {
  console.error('PR line sync failed:', error.message)
  process.exitCode = 1
})
