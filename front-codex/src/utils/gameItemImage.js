import scopedImages from '../data/game-item-images.json'
import { getMarketItemIcon } from './marketItemIcons.js'

function usableUrl(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function itemId(item) {
  const id = item?.item_id ?? item?.type_id ?? item?.ship_type_id
  if (typeof id === 'number' && (!Number.isSafeInteger(id) || id <= 0)) return null
  if (typeof id !== 'number' && typeof id !== 'string') return null
  return /^[1-9]\d*$/u.test(String(id)) ? String(id) : null
}

function scopedImage(id) {
  if (!id || !Object.hasOwn(scopedImages.items, id)) return null
  const digest = scopedImages.items[id]
  return /^[a-f0-9]{64}$/u.test(digest) ? `/images/game-items/${digest}.png` : null
}

/** Explicit mappings preserve the review tool's override contract; normal pages use the verified snapshot. */
export function selectGameItemImage(item, sourceUrl, mapping) {
  const direct = usableUrl(sourceUrl) || usableUrl(item?.image_url) || usableUrl(item?.ship_image_url)
  if (direct) return direct
  const id = itemId(item)
  if (!id) return null
  if (mapping !== undefined) return getMarketItemIcon(id, mapping)
  return scopedImage(id) || getMarketItemIcon(id)
}
