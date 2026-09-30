import { Package } from 'lucide-react'
import GameItemImage from './GameItemImage'

export default function MarketItemIcon({ item, itemId, src, size = 40, className = '' }) {
  const imageItem = item || { item_id: itemId }

  return (
    <span
      className={['market-item-icon', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden="true"
    >
      <GameItemImage item={imageItem} src={src} imageClassName="market-item-icon-image" width={size} height={size}
        fallback={<Package className="market-item-icon-fallback" size={Math.round(size / 2)} aria-hidden="true" />} />
    </span>
  )
}
