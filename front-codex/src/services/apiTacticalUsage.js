import API_URL from './backendSetting'
import fetchWithAuth from './fetchWithAuth'

async function readUsage(path, { signal } = {}) {
  const response = await fetchWithAuth(`${API_URL}/tactical/usage/${path}/`, {
    method: 'GET', cache: 'no-store', signal,
  })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const error = new Error(typeof data?.detail === 'string' ? data.detail : `无法读取战术板概况（${response.status}）`)
    error.status = response.status
    throw error
  }
  return response.json()
}

export const getTacticalUsageAccess = options => readUsage('access', options)
export const getTacticalUsageOverview = options => readUsage('overview', options)
