const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504])

export async function requestSimplix(url, init, {
  fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 4, timeoutMs = 45000, log = console.log,
} = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      const bodyText = await response.text()
      if (!RETRY_STATUSES.has(response.status)) return { response, bodyText }
      if (attempt === attempts) throw Object.assign(new Error('ERP returned HTTP ' + response.status + ' after ' + attempts + ' attempts.'), { retryable: true })
    } catch (error) {
      if (error.retryable) throw error
      const networkError = error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name)
      if (!networkError) throw error
      if (attempt === attempts) throw Object.assign(new Error('ERP network request failed after ' + attempts + ' attempts.'), { retryable: true })
    }
    const delay = Math.min(2000 * 2 ** (attempt - 1), 15000)
    log('\nERP temporarily unavailable. Retrying request ' + (attempt + 1) + '/' + attempts + ' in ' + delay / 1000 + ' seconds…')
    await sleep(delay)
  }
}
