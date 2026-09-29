// Approved original-game crops, associated with catalog IDs rather than names.
import { getConfirmedClientIcon } from './clientIconMapping.js'

export const MARKET_ITEM_ICON_IDS = Object.freeze([
  '28007000000',
  '42002000012', '42002000013', '42002000014', '42002000015',
  '42002000016', '42002000017', '42002000019',
  '42001000000', '42001000001', '42001000002', '42001000003',
  '42001000004', '42001000005', '42001000006', '42001000007',
  '42001000008', '42001000009', '42001000010', '42001000011',
  '42001000018', '42001000019', '42001000020', '42001000021',
  '42001000022', '42001000023', '42001000024', '42001000025',
  '42001000026', '42001000027', '42001000028', '42001000029',
  '42001000030', '42001000031', '42001000032', '42001000033',
  '42001000034', '42001000035',
  '41000000000', '41000000002', '41000000003', '41000000004',
  '41000000005', '41000000006', '41000000007', '41000000008',
  '41000000100', '41000000102',
])

const iconIds = new Set(MARKET_ITEM_ICON_IDS)

export function getMarketItemIcon(itemId, clientMapping) {
  if (typeof itemId !== 'string' && typeof itemId !== 'number') return null

  const confirmedIcon = clientMapping === undefined
    ? getConfirmedClientIcon(itemId)
    : getConfirmedClientIcon(clientMapping, itemId)
  if (confirmedIcon) return confirmedIcon

  const id = String(itemId)
  return iconIds.has(id) ? `/images/market-items/${id}.webp` : null
}
