import API_URL from './backendSetting'
import fetchWithAuth from './fetchWithAuth'

export class KillboardApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'KillboardApiError'
    this.status = status
  }
}

async function request(path, { signal } = {}) {
  const response = await fetchWithAuth(`${API_URL}/killboard/${path}`, {
    method: 'GET', cache: 'no-store', signal,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const message = data?.detail || data?.message || data?.error || `请求失败（${response.status}）`
    throw new KillboardApiError(typeof message === 'string' ? message : `请求失败（${response.status}）`, response.status)
  }
  return response.json()
}

export const getKillboardAccess = ({ signal } = {}) => request('access/', { signal })
export function listKillReports({ page = 1, pageSize = 20, q = '', shipClass = '', system = '', character = '', corporation = '', from = '', to = '', signal } = {}) {
  const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) })
  const values = { q, ship_class: shipClass, system, character, corporation, from, to }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim())
  }
  return request(`reports/?${params}`, { signal })
}

export const getKillReport = (killId, { signal } = {}) => request(`reports/${encodeURIComponent(killId)}/`, { signal })
export const listKillboardFilters = ({ signal } = {}) => request('filters/', { signal })
export const getKillboardStatus = ({ signal } = {}) => request('status/', { signal })
export const getKillboardCollectorLogs = ({ signal } = {}) => request('collector/logs/', { signal })
