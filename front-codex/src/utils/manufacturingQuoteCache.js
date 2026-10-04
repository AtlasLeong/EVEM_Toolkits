// Cache age governs re-reading the backend's stored snapshot, independently
// of the two-hour observation age used to warn about a stale market price.
import { resolveManufacturingQuote } from './manufacturingPlan.js'

export const MANUFACTURING_QUOTE_CACHE_TTL_MS = 5 * 60 * 1000
export const MANUFACTURING_QUOTE_AGE_TICK_MS = 30 * 1000

function observedTime(quote, now) {
  const value = resolveManufacturingQuote(quote, { now }).observedAt
  return value === null ? NaN : Date.parse(value)
}

export function mergeManufacturingQuoteSnapshots(previous, incoming, now = Date.now()) {
  const merged = { ...previous }
  for (const [itemId, quote] of Object.entries(incoming)) {
    const before = observedTime(previous[itemId], now)
    const next = observedTime(quote, now)
    // A successful newer empty snapshot must replace a previous sell price.
    // Missing timestamps cannot prove chronological order; do not invent it.
    if (Number.isFinite(before) && Number.isFinite(next) && next < before) continue
    merged[itemId] = quote
  }
  return merged
}

export function manufacturingQuoteIdsDue(itemIds, checkedAt, now = Date.now()) {
  return itemIds.filter(itemId => !Number.isFinite(checkedAt[itemId]) || now - checkedAt[itemId] >= MANUFACTURING_QUOTE_CACHE_TTL_MS)
}
