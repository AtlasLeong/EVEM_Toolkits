import { marketRefetchInterval } from './marketPolling.js'

// React Query retains cached data for the same key automatically. Carrying
// placeholder data across item, range or catalog keys would misidentify it.
export const marketReadOptions = {
  retry: false,
  staleTime: 15000,
  refetchInterval: marketRefetchInterval,
  refetchIntervalInBackground: false,
}

export function marketBookEmptyLabel(item, field) {
  if (!item?.observed_at || item.status === 'uncollected') return '尚未采集'
  if (item[field] !== null && item[field] !== undefined) return '未提供多档报价'
  return '暂无挂单'
}

export function marketSamplingLabel(item) {
  if (item?.collection_tier === 'priority' && item.collection_target_ms === 7_200_000) return '重点 · 2 小时采样目标（非保证）'
  if (item?.collection_tier === 'ordinary' && item.collection_target_ms === 21_600_000) return '普通 · 6 小时采样目标（非保证）'
  return null
}
