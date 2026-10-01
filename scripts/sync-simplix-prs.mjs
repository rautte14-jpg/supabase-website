import { createClient } from '@supabase/supabase-js'
import readline from 'node:readline'

const SUPABASE_URL = 'https://cqimpmvaobrnpejokuvx.supabase.co'
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tAoik_yGhIhp3VCE2qnf4g_GAviUG_B'
const DEFAULT_GRAPHQL_URL = 'https://apisimplix-maldivetransportcontracting.msappproxy.net/graphql'

const GET_PRS_QUERY = [
  'query GetPRs($after: String, $before: String, $first: Int, $last: Int, $search: String, $site: String) {',
  '  getPRs(after: $after, before: $before, first: $first, last: $last, search: $search, site: $site) {',
  '    edges { cursor node { createdAt createdBy description id purchReqId recId status site __typename } __typename }',
  '    pageInfo { count endCursor hasNextPage hasPreviousPage startCursor __typename }',
  '    __typename',
  '  }',
  '}',
].join('\n')

function argValue(name, fallback = null) {
  const prefix = '--' + name + '='
  const match = process.argv.find((arg) => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : fallback
}

function hasFlag(name) {
  return process.argv.includes('--' + name)
}

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close()
    resolve(answer.trim())
  }))
}

function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) return prompt(question)

  return new Promise((resolve, reject) => {
    let value = ''
    process.stdout.write(question)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
    }

    const onData = (char) => {
      if (char === '\u0003') {
        cleanup()
        process.stdout.write('\n')
        reject(new Error('Cancelled'))
        return
      }

      if (char === '\r' || char === '\n') {
        cleanup()
        process.stdout.write('\n')
        resolve(value)
        return
      }

      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1)
        return
      }

      value += char
    }

    process.stdin.on('data', onData)
  })
}

function parseSimplixDate(value) {
  const text = String(value || '').trim()
  if (!text) return null

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)$/i)
  if (!match) return null

  let [, month, day, year, hour, minute, second, meridiem] = match
  month = Number(month)
  day = Number(day)
  year = Number(year)
  hour = Number(hour)
  minute = Number(minute)
  second = Number(second)

  if (meridiem.toLowerCase() === 'pm' && hour !== 12) hour += 12
  if (meridiem.toLowerCase() === 'am' && hour === 12) hour = 0

  const local = new Date(year, month - 1, day, hour, minute, second)
  return Number.isNaN(local.getTime()) ? null : local.toISOString()
}

async function fetchPrPage({ url, bearerToken, after, first, site, search }) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: bearerToken.toLowerCase().startsWith('bearer ')
        ? bearerToken
        : 'Bearer ' + bearerToken,
    },
    body: JSON.stringify({
      operationName: 'GetPRs',
      variables: { first, last: null, before: null, after, site: site || null, search: search || '' },
      query: GET_PRS_QUERY,
    }),
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
      String(item?.message || '').toLowerCase().includes('unauthorized')
    )

  if (authFailed) return { authFailed: true, data: null }

  if (!response.ok) {
    throw new Error('Simplix API returned HTTP ' + response.status + ': ' + bodyText.slice(0, 500))
  }

  if (payload?.errors?.length) throw new Error('GraphQL error: ' + JSON.stringify(payload.errors))
  return { authFailed: false, data: payload?.data?.getPRs }
}

async function fetchAllPrs({ url, bearerToken, first, site, search, maxPages, onPage }) {
  const rows = []
  let after = null
  let page = 0
  let total = null
  let token = bearerToken

  while (true) {
    page += 1
    let result = await fetchPrPage({ url, bearerToken: token, after, first, site, search })

    if (result.authFailed) {
      console.log('\nSimplix authorization expired while syncing.')
      console.log('Open Simplix, refresh the PR page, copy a fresh bearer token, then paste it below.')
      token = await promptHidden('Fresh Simplix bearer token: ')
      if (!token) throw new Error('A fresh Simplix bearer token is required to continue.')

      result = await fetchPrPage({ url, bearerToken: token, after, first, site, search })
      if (result.authFailed) throw new Error('The replacement Simplix token was also rejected.')
    }

    const data = result.data
    if (!data) throw new Error('GraphQL response did not contain data.getPRs')

    total ??= data.pageInfo?.count ?? null
    const edges = data.edges || []
    const pageRows = edges.map((edge) => edge.node).filter(Boolean)

    rows.push(...pageRows)
    process.stdout.write('Fetched page ' + page + ': ' + rows.length + (total ? ' / ' + total : '') + ' PRs\n')

    if (onPage) await onPage(pageRows, rows.length, total)

    const pageInfo = data.pageInfo || {}
    if (!pageInfo.hasNextPage || !pageInfo.endCursor) break
    if (maxPages && page >= maxPages) break
    after = pageInfo.endCursor
  }

  return rows
}

function toDbRow(node) {
  return {
    purch_req_id: String(node.purchReqId || '').trim(),
    description: node.description || null,
    site: node.site || null,
    created_at: parseSimplixDate(node.createdAt),
    created_at_raw: node.createdAt || null,
    created_by: node.createdBy || null,
    status: node.status || null,
    rec_id: node.recId ?? null,
    simplix_id: node.id ?? null,
    raw_source: node,
    synced_at: new Date().toISOString(),
  }
}

async function upsertInBatches(supabase, rows, batchSize = 500) {
  let written = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize)
    const { error } = await supabase.from('erp_pr_headers').upsert(batch, { onConflict: 'purch_req_id' })
    if (error) throw error
    written += batch.length
    process.stdout.write('Synced ' + written + ' / ' + rows.length + ' PRs to Supabase\n')
  }
}

async function main() {
  console.log('SRD Warehouse System — Simplix PR Sync')
  console.log('The Simplix bearer token is used only in memory and is never written to disk.\n')

  const graphqlUrl = argValue('url', process.env.SIMPLIX_GRAPHQL_URL || DEFAULT_GRAPHQL_URL)
  const site = argValue('site', process.env.SIMPLIX_SITE || 'EDD')
  const search = argValue('search', '')
  const first = Number(argValue('page-size', '100'))
  const maxPages = Number(argValue('max-pages', '0')) || null
  const dryRun = hasFlag('dry-run')

  const bearerToken = process.env.SIMPLIX_BEARER_TOKEN || await promptHidden('Paste Simplix Authorization bearer token: ')
  if (!bearerToken) throw new Error('Simplix bearer token is required')

  const email = process.env.SRD_PORTAL_EMAIL || await prompt('SRD portal email: ')
  const password = process.env.SRD_PORTAL_PASSWORD || await promptHidden('SRD portal password: ')
  if (!email || !password) throw new Error('SRD portal email and password are required')

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password })
  if (authError) throw authError

  console.log('Signed in as ' + (authData.user?.email || email))
  console.log('Fetching Simplix PRs' + (site ? ' for site ' + site : '') + '...\n')

  const nodes = await fetchAllPrs({
    url: graphqlUrl,
    bearerToken,
    first,
    site,
    search,
    maxPages,
    onPage: dryRun
      ? null
      : async (pageNodes) => {
          const pageRows = pageNodes.map(toDbRow).filter((row) => row.purch_req_id)
          if (pageRows.length) await upsertInBatches(supabase, pageRows)
        },
  })

  const rows = nodes.map(toDbRow).filter((row) => row.purch_req_id)
  console.log('\nPrepared ' + rows.length + ' PR records.')

  if (dryRun) {
    console.log('Dry run complete. Nothing was written to Supabase.')
    return
  }

  const uniqueStatuses = [...new Set(rows.map((row) => row.status).filter(Boolean))]
  console.log('\nSync complete.')
  console.log('Records synced: ' + rows.length)
  console.log('Statuses seen: ' + (uniqueStatuses.join(', ') || 'None'))
}

main().catch((error) => {
  console.error('\nSync failed:', error?.message || error)
  process.exitCode = 1
})
