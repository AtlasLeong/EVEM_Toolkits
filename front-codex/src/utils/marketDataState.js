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
