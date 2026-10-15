import API_URL from './backendSetting'
import fetchWithAuth, { AuthSessionChangedError } from './fetchWithAuth'
import { readValidatedSession } from './validatedSession'
import { validateHotspotChanges } from '../utils/hotspotChanges'

const safeInteger = value => Number.isSafeInteger(value) && value >= 0
const statuses = new Set(['ok', 'unavailable', 'unauthorized', 'rate_limited', 'network_error', 'malformed',
  'budget_exhausted', 'lease_lost', 'configuration_error', 'service_rejected', 'account_busy'])
const nullableTime = value => value === null || safeInteger(value)
const validInterval = value => value === null || value && ['id', 'start_at_ms', 'end_at_ms', 'elapsed_ms'].every(key => safeInteger(value[key]) && value[key] > 0)
  && value.end_at_ms - value.start_at_ms === value.elapsed_ms
const validAttempt = value => value && safeInteger(value.at_ms) && statuses.has(value.status)
  && safeInteger(value.system_count) && value.system_count <= 10000
  && (value.session_slot === undefined || typeof value.session_slot === 'string' && /^[A-Z]{1,2}$/.test(value.session_slot))
  && (value.pool_size === undefined || safeInteger(value.pool_size) && value.pool_size > 0 && value.pool_size <= 201)
  && (value.rpc_count === undefined || safeInteger(value.rpc_count) && value.rpc_count <= 5)
  && (value.stage === undefined || ['connection', 'authentication', 'statistics'].includes(value.stage))
  && (value.reason === undefined || statuses.has(value.reason) || ['timeout', 'connection_unavailable', 'session_closed', 'unsupported_rpc'].includes(value.reason))
  && (value.history_status === undefined || ['ok', 'unavailable', 'disabled'].includes(value.history_status))
const invalid = () => { throw new Error('管理数据无效，请稍后重试') }
const userValid = user => user && safeInteger(user.id) && user.id > 0 && typeof user.username === 'string'
  && typeof user.email === 'string' && user.grant && typeof user.grant.enabled === 'boolean' && safeInteger(user.grant.version)
const listValid = data => data && Array.isArray(data.results) && data.results.length <= 100
  && (data.next_before == null || safeInteger(data.next_before) && data.next_before > 0)
const marker = session => `${session.identity}|${session.refreshToken || session.accessToken || ''}`

// A deny is a one-way fence for this login. Pending capability successes must
// never restore a revoked view. A fresh login clears the identity query cache.
export function announceControlDenial(identity) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('control-center:denied', { detail: { identity } }))
}
async function request(path, { signal, method = 'GET', body } = {}) {
  const session = readValidatedSession(), captured = marker(session)
  const response = await fetchWithAuth(`${API_URL}${path}`, {
    signal, method, cache: 'no-store', ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  if (captured !== marker(readValidatedSession())) throw new AuthSessionChangedError()
  if (!response.ok) {
    if ([401, 403].includes(response.status)) announceControlDenial(session.userInfo?.userId)
    const error = new Error(response.status === 409 ? '授权已被其他操作更新，请重新查询后再试。'
      : [401, 403].includes(response.status) ? '当前账号无访问权限。' : '暂时无法读取管理或变化数据，请稍后重试。')
    error.status = response.status
    throw error
  }
  const data = await response.json()
  if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError')
  if (captured !== marker(readValidatedSession())) throw new AuthSessionChangedError()
  return data
}
function params(input) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) if (value != null && value !== '') {
    if (!safeInteger(value) || value <= 0) throw new Error('查询参数无效')
    query.set(key, String(value))
  }
  return query.size ? `?${query}` : ''
}
export async function getControlCenterAccess(options) {
  const data = await request('/control-center/access/', options)
  if (!data || Object.keys(data).length !== 2 || typeof data.can_manage !== 'boolean' || typeof data.can_view_hotspot_changes !== 'boolean') throw new Error('权限数据无效')
  return data
}
export async function getHotspotChanges({ interval, before, limit = 100, signal } = {}) {
  if (limit > 100) throw new Error('查询参数无效')
  return validateHotspotChanges(await request(`/anomaly-hotspots/changes/${params({ interval, before, limit })}`, { signal }))
}
export async function searchControlUsers(q, options) {
  if (typeof q !== 'string' || !q.trim() || q.length > 254) throw new Error('请输入完整邮箱或用户 ID')
  const data = await request(`/control-center/users/?${new URLSearchParams({ q: q.trim() })}`, options)
  if (!listValid(data) || !data.results.every(userValid)) invalid()
  return data
}
export async function getHotspotGrants({ before, signal } = {}) {
  const data = await request(`/control-center/grants/${params({ before_id: before })}`, { signal })
  if (!listValid(data) || !data.results.every(userValid)) invalid()
  return data
}
export async function updateHotspotGrant(id, value, { signal } = {}) {
  if (!safeInteger(id) || id <= 0 || !value || typeof value.enabled !== 'boolean' || !safeInteger(value.version)
    || !(value.reason === undefined || typeof value.reason === 'string' && value.reason.length <= 500)
    || Object.keys(value).some(key => !['enabled', 'version', 'reason'].includes(key))) throw new Error('授权参数无效')
  const data = await request(`/control-center/grants/${id}/`, { signal, method: 'PUT', body: value })
  if (!userValid(data)) invalid()
  return data
}
export async function getControlAudit({ before, signal } = {}) {
  const data = await request(`/control-center/audit/${params({ before_id: before })}`, { signal })
  if (!listValid(data) || !data.results.every(row => safeInteger(row.id) && row.actor && row.target
    && safeInteger(row.actor.id) && safeInteger(row.target.id) && typeof row.actor.username === 'string'
    && typeof row.target.username === 'string' && typeof row.reason === 'string' && typeof row.created_at === 'string'
    && typeof row.request_id === 'string' && [row.before, row.after].every(grant => typeof grant?.enabled === 'boolean' && safeInteger(grant.version)))) invalid()
  return data
}
export async function getControlOverview(options) {
  const data = await request('/control-center/overview/', options)
  if (!data || !data.collection || !Array.isArray(data.collection.attempts) || data.collection.attempts.length > 200
    || !data.collection.attempts.every(validAttempt) || !statuses.has(data.collection.status)
    || !nullableTime(data.collection.collected_at_ms) || !nullableTime(data.collection.last_attempt_at_ms)
    || !safeInteger(data.collection.system_count) || data.collection.system_count > 10000
    || !['ok', 'baseline', 'unavailable'].includes(data.collection.history_status) || !validInterval(data.collection.latest_interval)
    || !Array.isArray(data.modules) || data.modules.length > 30
    || !data.modules.every(item => typeof item.key === 'string' && typeof item.label === 'string'
      && typeof item.allowed === 'boolean' && typeof item.path === 'string' && /^\/(?!\/)[a-z0-9/-]+$/.test(item.path))) invalid()
  return data
}
