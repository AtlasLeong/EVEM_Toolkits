import { Package } from 'lucide-react'
import GameItemImage from './GameItemImage'

export default function MarketItemIcon({ item, itemId, src, size = 40, className = '', mapping }) {
  const imageItem = item || { item_id: itemId }

  return (
    <span
      className={['market-item-icon', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden="true"
    >
      {/* A new item gets a fresh load attempt, even after the previous image failed. */}
      <GameItemImage item={imageItem} src={src} mapping={mapping} imageClassName="market-item-icon-image" width={size} height={size}
        fallback={<Package className="market-item-icon-fallback" size={Math.round(size / 2)} aria-hidden="true" />} />
    </span>
  )
}
