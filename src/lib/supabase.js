import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://cqimpmvaobrnpejokuvx.supabase.co'

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_tAoik_yGhIhp3VCE2qnf4g_GAviUG_B'

// Several dashboard modules can request the same Supabase resource at nearly
// the same time during startup/navigation. Share only requests that are still
// in flight. Nothing is cached after the response completes, so every later
// refresh still goes back to Supabase and receives current data.
const inFlightGets = new Map()

function requestHeaders(input, init) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  return headers
}

async function fastFetch(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET') return fetch(input, init)

  const url = input instanceof Request ? input.url : String(input)
  const headers = requestHeaders(input, init)
  const key = [
    url,
    headers.get('authorization') || '',
    headers.get('apikey') || '',
    headers.get('range') || '',
    headers.get('prefer') || '',
    headers.get('accept-profile') || '',
  ].join('|')

  let pending = inFlightGets.get(key)
  if (!pending) {
    pending = fetch(input, init)
    inFlightGets.set(key, pending)
    pending.finally(() => inFlightGets.delete(key))
  }

  const response = await pending
  return response.clone()
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: fastFetch },
})
