import { useState } from 'react'
import { Package } from 'lucide-react'
import { getMarketItemIcon } from '../utils/marketItemIcons'

function MarketIconImage({ src, size }) {
  const [failed, setFailed] = useState(false)

  if (!src || failed) {
    return <Package className="market-item-icon-fallback" size={Math.round(size / 2)} aria-hidden="true" />
  }

  return (
    <img
      className="market-item-icon-image"
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  )
}

export default function MarketItemIcon({ itemId, size = 40, className = '', mapping }) {
  const src = getMarketItemIcon(itemId, mapping)

  return (
    <span
      className={['market-item-icon', className].filter(Boolean).join(' ')}
      style={{ width: size, height: size, flexShrink: 0 }}
      aria-hidden="true"
    >
      {/* A new item gets a fresh load attempt, even after the previous image failed. */}
      <MarketIconImage key={src || 'unknown'} src={src} size={size} />
    </span>
  )
}
