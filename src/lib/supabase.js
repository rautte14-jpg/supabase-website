import { createClient } from '@supabase/supabase-js'

const supabaseUrl =
  import.meta.env.VITE_SUPABASE_URL ||
  'https://cqimpmvaobrnpejokuvx.supabase.co'

const supabaseKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_tAoik_yGhIhp3VCE2qnf4g_GAviUG_B'

// Shared read-through cache for PostgREST GETs. This is intentionally short lived
// and is invalidated immediately by the realtime performance layer whenever the
// underlying table changes. It lets background warm-up requests be reused by the
// normal App data loader instead of downloading the same large table twice.
const inFlightGets = new Map()
const responseCache = new Map()
const CACHE_TTL_MS = 120000

function requestHeaders(input, init) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined)
  if (init?.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value))
  return headers
}

function requestKey(input, init = {}) {
  const url = input instanceof Request ? input.url : String(input)
  const headers = requestHeaders(input, init)
  return [
    url,
    headers.get('authorization') || '',
    headers.get('apikey') || '',
    headers.get('range') || '',
    headers.get('prefer') || '',
    headers.get('accept-profile') || '',
  ].join('|')
}

function cacheableUrl(url) {
  return url.includes('/rest/v1/')
}

function responseFromCache(entry) {
  return new Response(entry.body.slice(0), {
    status: entry.status,
    statusText: entry.statusText,
    headers: new Headers(entry.headers),
  })
}

export function clearSupabaseReadCache(table = '') {
  const marker = table ? `/rest/v1/${encodeURIComponent(table)}?` : '/rest/v1/'
  for (const key of responseCache.keys()) {
    if (!table || key.includes(marker) || key.includes(`/rest/v1/${table}?`)) responseCache.delete(key)
  }
}

async function fastFetch(input, init = {}) {
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
  if (method !== 'GET') {
    // Any write can make cached reads stale. Realtime will narrow this later,
    // but clearing here guarantees the next read cannot reuse pre-write data.
    clearSupabaseReadCache()
    return fetch(input, init)
  }

  const url = input instanceof Request ? input.url : String(input)
  const key = requestKey(input, init)
  const now = Date.now()

  if (cacheableUrl(url)) {
    const cached = responseCache.get(key)
    if (cached && cached.expiresAt > now) return responseFromCache(cached)
    if (cached) responseCache.delete(key)
  }

  let pending = inFlightGets.get(key)
  if (!pending) {
    pending = (async () => {
      const response = await fetch(input, init)
      if (response.ok && cacheableUrl(url)) {
        const clone = response.clone()
        const body = await clone.arrayBuffer()
        responseCache.set(key, {
          body,
          status: clone.status,
          statusText: clone.statusText,
          headers: [...clone.headers.entries()],
          expiresAt: Date.now() + CACHE_TTL_MS,
        })
      }
      return response
    })()
    inFlightGets.set(key, pending)
    pending.finally(() => inFlightGets.delete(key))
  }

  const response = await pending
  return response.clone()
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  global: { fetch: fastFetch },
})
