const BASE_INTERVAL_MS = 120000
const MAX_INTERVAL_MS = 900000

export function marketRefetchInterval(query, visibility = typeof document === 'undefined' ? 'visible' : document.visibilityState) {
  if (visibility !== 'visible') return false
  const failures = Math.max(0, Number(query?.state?.fetchFailureCount || (query?.state?.error ? 1 : 0)))
  return Math.min(MAX_INTERVAL_MS, BASE_INTERVAL_MS * (2 ** Math.min(failures, 3)))
}
