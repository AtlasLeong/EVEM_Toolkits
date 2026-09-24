export function pirateRefreshDelay(failures = 0) {
  return Math.min(60000, 15000 * 2 ** Math.max(0, Math.min(2, failures)))
}
