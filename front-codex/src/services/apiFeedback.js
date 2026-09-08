import API_URL from './backendSetting'
import fetchWithAuth from './fetchWithAuth'

export const FEEDBACK_TYPES = { feature: '功能建议', bug: '问题反馈' }
export const FEEDBACK_MODULES = { planetary: '行星资源', starmap: '星系导航', fraudlist: '防诈名单', account: '账号与授权', other: '其他' }
export const FEEDBACK_STATUSES = { pending: '待处理', processing: '处理中', completed: '已完成', declined: '暂不采纳' }

async function checked(response) {
  if (response.ok) return response
  const data = await response.json().catch(() => ({}))
  const labels = { title: '标题', description: '描述', contact: '联系方式', body: '内容', file: '附件', request_id: '请求编号' }
  const message = data.detail || data.message || data.error || Object.entries(data).map(([key, value]) => `${labels[key] || key}：${Array.isArray(value) ? value.join('；') : value}`).join('；')
  throw new Error(typeof message === 'string' && message ? message : `请求失败（${response.status}），请稍后重试`)
}

async function request(path = '', options = {}) {
  return (await checked(await fetchWithAuth(`${API_URL}/feedback/${path}`, options))).json()
}

export const listFeedback = params => request(`?${new URLSearchParams(Object.entries(params).filter(([, value]) => value !== ''))}`)
export const getFeedback = id => request(`${id}/`)
export const createFeedback = payload => request('', { method: 'POST', body: JSON.stringify(payload) })
export const updateFeedback = (id, status) => request(`${id}/`, { method: 'PATCH', body: JSON.stringify({ status }) })
export const commentFeedback = (id, payload) => request(`${id}/comments/`, { method: 'POST', body: JSON.stringify(payload) })

export function uploadFeedbackFile(id, file, requestId) {
  const body = new FormData()
  body.append('file', file)
  body.append('request_id', requestId)
  return request(`${id}/attachments/`, { method: 'POST', body })
}

export async function downloadFeedbackFile(id, attachment) {
  const response = await checked(await fetchWithAuth(`${API_URL}/feedback/${id}/attachments/${attachment.id}/download/`))
  const url = URL.createObjectURL(await response.blob())
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = attachment.name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Allow the browser to start consuming the download before revoking it.
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
}
