import API_URL from './backendSetting'
import fetchWithAuth from './fetchWithAuth'

export class MarketApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'MarketApiError'
    this.status = status
  }
}

async function request(path, { admin = false, ...options } = {}) {
  // Market data is protected by the viewer allowlist in production. Keeping
  // one authenticated transport for both read and admin calls also prevents
  // an anonymous request from silently bypassing the backend gate.
  const response = await fetchWithAuth(`${API_URL}/market/${path}`, options)
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const fields = data && typeof data === 'object' ? data : {}
    const fieldMessages = Object.entries(fields).map(([field, value]) => `${field}：${Array.isArray(value) ? value.join('；') : value}`).join('；')
    const message = fields.detail || fields.message || fields.error || fieldMessages || `请求失败（${response.status}）`
    throw new MarketApiError(typeof message === 'string' ? message : `请求失败（${response.status}）`, response.status)
  }
  return response.json()
}

export const listMarketCategories = ({ signal } = {}) => request('categories/', { signal })

export async function getMarketQuality({ signal } = {}) {
  const data = await request('quality/', { signal, cache: 'no-store' })
  // Keep the time anchor in the query data so navigation cannot reset its age.
  return { ...data, client_read_monotonic_ms: typeof performance === 'undefined' ? null : performance.now() }
}

export function listMarketItems({ q = '', page = 1, categoryId, signal } = {}) {
  const params = new URLSearchParams({ q: q.trim(), page: String(page) })
  if (categoryId !== undefined && categoryId !== null && categoryId !== '') params.set('category_id', String(categoryId))
  return request(`items/?${params}`, { signal })
}

export function getMarketSeries(itemId, days, { signal } = {}) {
  if (![1, 7, 30].includes(days)) throw new Error('历史范围必须是 1、7 或 30 天')
  return request(`items/${encodeURIComponent(itemId)}/series/?days=${days}`, { signal })
}

export function getMarketHistory(itemId, days, { page = 1, signal } = {}) {
  if (![1, 7, 30].includes(days)) throw new Error('历史范围必须是 1、7 或 30 天')
  return request(`items/${encodeURIComponent(itemId)}/history/?days=${days}&page=${page}`, { signal })
}

export const getMarketConfig = () => request('admin/config/', { admin: true })
export const updateMarketConfig = payload => request('admin/config/', { admin: true, method: 'PATCH', body: JSON.stringify(payload) })
export function listMarketAdminItems({ q = '', page = 1 } = {}) {
  const params = new URLSearchParams()
  if (q.trim()) params.set('q', q.trim())
  params.set('page', String(page))
  return request(`admin/items/?${params}`, { admin: true })
}
export const createMarketItem = payload => request('admin/items/', { admin: true, method: 'POST', body: JSON.stringify(payload) })
export const updateMarketItem = (itemId, payload) => request(`admin/items/${encodeURIComponent(itemId)}/`, { admin: true, method: 'PATCH', body: JSON.stringify(payload) })
export const listMarketRuns = () => request('admin/runs/', { admin: true })
export const enqueueMarketRun = () => request('admin/run/', { admin: true, method: 'POST' })
