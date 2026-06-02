import API_URL from './backendSetting'
import fetchWithAuth from './fetchWithAuth'

async function parseError(response, fallback) {
  const errorData = await response.json().catch(() => ({}))
  throw new Error(errorData.error || errorData.message || errorData.detail || fallback)
}

export const SCRIPT_OPTIONS = [
  { value: 'ai_full_auto', label: '全自动际遇与AI' },
  { value: 'ai_escape', label: '00地区自动挂AI' },
  { value: 'ai_semi_escape', label: '00地区手动出站挂AI' },
  { value: 'ai_enhance_991', label: '00地区自动挂AI-无人机增强' },
  { value: 'dreadnoughts_pve', label: '无畏自动蹲地(不回站)' },
  { value: 'task_receiver', label: '自动接取际遇任务' },
  { value: 'lock_fire_991', label: '自动锁定并开火 991' },
  { value: 'system_monitor', label: '星系监控-观察者' },
  { value: 'ai_judge_991', label: '00地区AI警戒-991' },
  { value: 'big_mining', label: '大鱼自动挖矿回站' },
]

export const PLAN_OPTIONS = [
  { value: 'default', label: '默认组' },
  { value: 'vip', label: 'VIP金主组' },
]

export async function listLicenseCodes(params = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value))
    }
  })
  const suffix = query.toString() ? `?${query}` : ''
  const res = await fetchWithAuth(`${API_URL}/license/codes/${suffix}`)
  if (!res.ok) await parseError(res, '获取激活码列表失败')
  return res.json()
}

export async function createLicenseCode(payload) {
  const res = await fetchWithAuth(`${API_URL}/license/codes/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!res.ok) await parseError(res, '生成激活码失败')
  return res.json()
}

export async function updateLicenseCode(id, payload) {
  const res = await fetchWithAuth(`${API_URL}/license/codes/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  if (!res.ok) await parseError(res, '更新激活码失败')
  return res.json()
}

export async function unbindLicenseCode(id) {
  const res = await fetchWithAuth(`${API_URL}/license/codes/${id}/unbind/`, {
    method: 'POST',
  })
  if (!res.ok) await parseError(res, '解绑设备失败')
  return res.json()
}

export async function extendLicenseCode(id, days) {
  const res = await fetchWithAuth(`${API_URL}/license/codes/${id}/extend/`, {
    method: 'POST',
    body: JSON.stringify({ days }),
  })
  if (!res.ok) await parseError(res, '延期失败')
  return res.json()
}

export function parseScriptIds(value) {
  if (!value) return []
  return String(value)
    .split(/[,，\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function scriptLabel(scriptId) {
  return SCRIPT_OPTIONS.find((item) => item.value === scriptId)?.label || scriptId
}

