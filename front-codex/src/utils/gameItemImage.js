import { getMarketItemIcon } from './marketItemIcons.js'

function usableUrl(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Prefer catalog-backed API metadata; only use the approved legacy crop by exact ID. */
export function selectGameItemImage(item, sourceUrl) {
  const direct = usableUrl(sourceUrl) || usableUrl(item?.image_url) || usableUrl(item?.ship_image_url)
  if (direct) return direct
  return getMarketItemIcon(item?.item_id ?? item?.type_id ?? item?.ship_type_id)
}
