import { requestSimplix } from './simplix-http.mjs'
import readline from 'node:readline'

const DEFAULT_GRAPHQL_URL = 'https://apisimplix-maldivetransportcontracting.msappproxy.net/graphql'

// Read-only schema fields confirmed in the production Apollo Sandbox documentation.
// The probe deliberately does not persist tokens or fetched data.
const QUERY = `
query SRDProbePurchaseRequisitionLines($query: PurchaseRequisitionLinesQueryInput!) {
  purchaseRequisitionLines(query: $query) {
    ItemNumber
    ProductName
    LineDescription
    RequestedPurchaseQuantity
    PurchasePrice
    LineAmount
    CurrencyCode
    LineStatus
    RecId
  }
}
`

function argument(name, fallback = '') {
  const flag = process.argv.find(x => x.startsWith('--' + name + '='))
  return flag ? flag.slice(name.length + 3) : fallback
}

function promptHidden(question) {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Run this in an interactive terminal to enter the token securely.')
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
      process.stdin.removeListener('data', key)
    }
    const key = (char) => {
      if (char === '\u0003') {
        clean()
        process.stdout.write('\n')
        reject(new Error('Cancelled'))
      } else if (char === '\r' || char === '\n') {
        clean()
        process.stdout.write('\n')
        resolve(value.trim())
      } else if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1)
      } else {
        value += char
      }
    }
    process.stdin.on('data', key)
  })
}

function amount(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

async function main() {
  const pr = argument('pr', 'PR104021').toUpperCase()
  if (!/^PR[0-9]{4,12}$/.test(pr)) throw new Error('Use a valid PR number, e.g. --pr=PR104021')
  const top = 100
  const url = process.env.SIMPLIX_GRAPHQL_URL || DEFAULT_GRAPHQL_URL
  // Prefer the same production authorization method already used by sync-simplix-prs.mjs.
  const token = process.env.SIMPLIX_BEARER_TOKEN || await promptHidden('Paste your authorized Simplix bearer token (hidden): ')
  if (!token) throw new Error('Authorization token required')
  const auth = token.toLowerCase().startsWith('bearer ') ? token : 'Bearer ' + token

  const { response, bodyText } = await requestSimplix(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: auth },
    body: JSON.stringify({
      operationName: 'SRDProbePurchaseRequisitionLines',
      query: QUERY,
      variables: { query: { requisitionNumber: pr, skip: 0, top } },
    }),
  })

  let payload
  try { payload = JSON.parse(bodyText) } catch {
    throw new Error('API did not return JSON (HTTP ' + response.status + ')')
  }

  if (response.status === 401 || payload?.errors?.some(e => e.extensions?.code === 'UNAUTHENTICATED')) {
    throw new Error('401 UNAUTHENTICATED: the token was not accepted for PR line details')
  }
  if (response.status === 403 || payload?.errors?.some(e => e.extensions?.code === 'FORBIDDEN')) {
    throw new Error('403 FORBIDDEN: your account cannot access this PR-line operation')
  }
  if (!response.ok || payload?.errors?.length) {
    const errors = (payload?.errors || []).map(e => ({
      message: e.message,
      code: e.extensions?.code || null,
    }))
    console.error('GraphQL errors (no tokens or raw headers):', JSON.stringify(errors))
    throw new Error('PR-line query failed; see sanitized GraphQL errors above')
  }
  const data = payload?.data?.purchaseRequisitionLines
  if (!Array.isArray(data)) throw new Error('Unexpected response: purchaseRequisitionLines was not an array')

  const items = data.map(line => ({
    item: line.ItemNumber || '',
    description: line.ProductName || line.LineDescription || '',
    requested: amount(line.RequestedPurchaseQuantity),
    unitPrice: amount(line.PurchasePrice),
    lineAmount: amount(line.LineAmount),
    currency: line.CurrencyCode || '',
    status: line.LineStatus || '',
  }))
  console.log('\nPR: ' + pr + ' | Lines: ' + items.length)
  console.table(items)
  console.log('This confirms PR requested-line data only. PO receipt quantities and actual received value are NOT verified by this query.')
  console.log('Read-only test complete. No database records were modified or uploaded.')
}

main().catch(err => {
  console.error('PR line probe failed:', err.message)
  process.exitCode = 1
})
