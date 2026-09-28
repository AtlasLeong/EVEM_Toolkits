import API_URL from './backendSetting'

/**
 * The public market list endpoint caps a page at one hundred records.  The
 * manufacturing catalog is a small, known set of item IDs, so quote lookups
 * use the existing numeric `q` filter one ID at a time.  IDs are scheduled in
 * bounded chunks to avoid opening an unbounded number of requests at once.
 */
export const MARKET_PAGE_SIZE = 100
export const DEFAULT_QUOTE_CONCURRENCY = 8

const QUOTE_STATUSES = new Set(['fresh', 'stale', 'empty', 'uncollected', 'absent'])

export class ManufacturingMarketError extends Error {
  constructor(message, status, { code = 'market_error', cause } = {}) {
    super(message)
    this.name = 'ManufacturingMarketError'
    this.status = status
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}

function normalizeItemId(value) {
  const id = String(value ?? '').trim()
  if (!/^[1-9][0-9]*$/u.test(id)) return null
  return id
}

function normalizeItemIds(itemIds) {
  if (itemIds === undefined || itemIds === null) return []
  if (typeof itemIds === 'string' || typeof itemIds === 'number' || typeof itemIds === 'bigint') itemIds = [itemIds]
  if (!itemIds || typeof itemIds[Symbol.iterator] !== 'function') return []
  const seen = new Set()
  const result = []
  for (const value of itemIds) {
    const id = normalizeItemId(value)
    if (!id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/** Return de-duplicated numeric item IDs in chunks no larger than `size`. */
export function chunkItemIds(itemIds, size = MARKET_PAGE_SIZE) {
  const chunkSize = Number(size)
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new TypeError('chunk size must be a positive safe integer')
  }
  const normalized = normalizeItemIds(itemIds)
  const chunks = []
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    chunks.push(normalized.slice(offset, offset + chunkSize))
  }
  return chunks
}

function responseRows(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && Array.isArray(payload.results)) return payload.results
  return []
}

function normalizeStatus(value, fallback = 'uncollected') {
  const status = String(value ?? '').trim().toLowerCase()
  if (QUOTE_STATUSES.has(status)) return status
  return fallback
}

function normalizeRow(row, itemId) {
  const source = row && typeof row === 'object' && !Array.isArray(row) ? row : {}
  const normalizedId = normalizeItemId(source.item_id ?? source.itemId) ?? itemId
  return {
    ...source,
    item_id: normalizedId,
    status: normalizeStatus(source.status),
  }
}

/**
 * Convert one or more public `/market/items/` payloads into an ID-keyed
 * record.  Requested IDs not present in a response are retained as `absent`
 * instead of being dropped, so callers can show an explicit missing-quote
 * state and never mistake it for a zero price.
 */
export function normalizeManufacturingQuotes(payload, requestedItemIds = []) {
  const requested = normalizeItemIds(requestedItemIds)
  const requestedSet = new Set(requested)
  const normalized = Object.fromEntries(requested.map(itemId => [itemId, {
    item_id: itemId,
    status: 'absent',
  }]))

  for (const row of responseRows(payload)) {
    const itemId = normalizeItemId(row?.item_id ?? row?.itemId)
    if (!itemId || (requestedSet.size > 0 && !requestedSet.has(itemId))) continue
    normalized[itemId] = normalizeRow(row, itemId)
  }
  return normalized
}

// Descriptive aliases keep the adapter discoverable for callers that use the
// market-domain name rather than the manufacturing-page name.
export const normalizeMarketQuotes = normalizeManufacturingQuotes
export const normalizeQuoteResponse = normalizeManufacturingQuotes
export const chunkManufacturingItemIds = chunkItemIds

function buildItemsUrl(apiUrl, itemId) {
  const base = String(apiUrl ?? '').replace(/\/+$/u, '')
  const params = new URLSearchParams({
    q: itemId,
    page: '1',
    page_size: String(MARKET_PAGE_SIZE),
  })
  return `${base}/market/items/?${params}`
}

function errorMessage(payload, status) {
  const fields = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const message = fields.detail || fields.message || fields.error
  return typeof message === 'string' && message.trim() ? message : `请求失败（${status}）`
}

async function fetchOneQuote(itemId, { apiUrl, fetchImpl, signal }) {
  let response
  try {
    response = await fetchImpl(buildItemsUrl(apiUrl, itemId), {
      signal,
      credentials: 'omit',
    })
  } catch (cause) {
    throw new ManufacturingMarketError('行情请求失败，请稍后重试。', undefined, {
      code: 'transport_error',
      cause,
    })
  }
  if (!response?.ok) {
    const payload = typeof response?.json === 'function' ? await response.json().catch(() => ({})) : {}
    throw new ManufacturingMarketError(errorMessage(payload, response?.status), response?.status, {
      code: 'http_error',
    })
  }
  let payload
  try {
    if (typeof response.json !== 'function') throw new TypeError('JSON response body is unavailable')
    payload = await response.json()
  } catch (cause) {
    throw new ManufacturingMarketError('行情响应不是有效 JSON。', response?.status, {
      code: 'invalid_json',
      cause,
    })
  }
  return normalizeManufacturingQuotes(payload, [itemId])
}

async function mapWithConcurrency(values, worker, concurrency) {
  const output = new Array(values.length)
  let cursor = 0
  async function consume() {
    while (cursor < values.length) {
      const index = cursor++
      output[index] = await worker(values[index])
    }
  }
  const workerCount = Math.min(concurrency, values.length)
  await Promise.all(Array.from({ length: workerCount }, consume))
  return output
}

/**
 * Fetch read-only public market quotes for manufacturing purchase leaves.
 * `fetchImpl` and `apiUrl` are injectable for tests and local previews.  No
 * Authorization header, account token, or cookie is sent by this adapter.
 */
export async function fetchManufacturingQuotes(itemIds, options = {}) {
  const requested = normalizeItemIds(itemIds)
  if (requested.length === 0) return {}

  const fetchImpl = options.fetchImpl ?? options.fetch ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required')
  const concurrency = Number(options.concurrency ?? DEFAULT_QUOTE_CONCURRENCY)
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new TypeError('quote concurrency must be a positive safe integer')
  }

  const merged = Object.fromEntries(requested.map(itemId => [itemId, {
    item_id: itemId,
    status: 'absent',
  }]))
  for (const chunk of chunkItemIds(requested, MARKET_PAGE_SIZE)) {
    const records = await mapWithConcurrency(
      chunk,
      itemId => fetchOneQuote(itemId, {
        apiUrl: options.apiUrl ?? options.baseUrl ?? API_URL,
        fetchImpl,
        signal: options.signal,
      }),
      concurrency,
    )
    for (const record of records) Object.assign(merged, record)
  }
  return merged
}

export const fetchManufacturingMarketQuotes = fetchManufacturingQuotes

