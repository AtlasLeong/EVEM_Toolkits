const PAUSE_LABELS = {
  paused: '定时采集已关闭',
  invalid_material: '会话材料缺失或无效，不代表账号过期',
  authentication_rejected: '账号认证被拒绝，需要更新会话',
  authentication_required: '采集需要重新授权，尚不能确认原因',
  service_refused: '服务拒绝，保持暂停，等待管理员检查',
  rate_cooldown: '服务限流，等待全局冷却，不立即换号重试',
  ready: '未记录暂停，按正常周期采集',
  disabled: '定时采集已关闭',
  invalid_session: '会话材料缺失或无效，不代表账号过期',
  auth_rejected: '账号认证被拒绝，需要更新会话',
  unauthorized: '账号认证被拒绝，需要更新会话',
  needs_auth: '采集需要重新授权，具体原因以最近任务为准',
  service_rejected: '服务拒绝，保持暂停，等待管理员检查',
  rate_limited: '服务限流，等待全局冷却，不立即换号重试',
  account_busy: '账号被其他任务占用，等待正常周期',
  budget_exhausted: '共享查询额度不足，等待下一轮',
  shared_budget: '共享账号保护额度限制',
  configuration_error: '采集配置需要检查',
  timeout: '请求超时，等待正常周期重试',
  ORDER_TIMEOUT: '请求超时，等待正常周期重试',
  network_error: '网络连接异常，等待正常周期重试',
  runtime_budget: '本轮执行时间达到安全上限',
  lease_lost: '任务租约已失效，本轮已安全停止',
  lease_expired: '任务中断，租约已过期',
  no_enabled_items: '尚未启用采集商品',
}

export const collectionPauseLabel = code => Object.hasOwn(PAUSE_LABELS, code) ? PAUSE_LABELS[code] : '原因尚未确认'

export function healthAge(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '未知'
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 1) return '不到 1 分钟'
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`
}

export function healthCoverage(count, total) {
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(total) || count < 0 || count > total) return '未知'
  return total === 0 ? '暂无启用商品' : `${count} / ${total}（${(count / total * 100).toFixed(1)}%）`
}

export function healthCapacityWarning(code) {
  const labels = {
    priority_target_infeasible: '重点商品数量超过当前采样能力，2 小时目标可能无法满足。',
    ordinary_target_infeasible: '普通商品数量超过当前采样能力，6 小时轮转目标可能无法满足。',
    plan_unavailable: '尚无实际采集计划，暂不能估算两层采样能力。',
    plan_stale: '最近实际计划已陈旧，能力估算仅供参考。',
    throughput_unavailable: '观测跨度不足，尚不能计算实际小时吞吐。',
  }
  return Object.hasOwn(labels, code) ? labels[code] : '采样能力暂无法确认'
}
