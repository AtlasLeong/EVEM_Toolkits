import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { selectGameItemImage } from '../utils/gameItemImage'

function ImageForSource({ src, alt, imageClassName, width, height, missingLabel, fallback }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return fallback || <><ImageOff aria-hidden="true" /><span>{missingLabel}</span></>
  return <img className={imageClassName} src={src} alt={alt} width={width} height={height} loading="lazy" decoding="async" onError={() => setFailed(true)} />
}

export default function GameItemImage({ item, src, alt = '', imageClassName, width, height, missingLabel = '图像待补', fallback }) {
  const selectedSource = selectGameItemImage(item, src)
  // A changed URL remounts the loader so an earlier network failure cannot mask it.
  return <ImageForSource key={selectedSource || 'missing'} src={selectedSource} alt={alt} imageClassName={imageClassName} width={width} height={height} missingLabel={missingLabel} fallback={fallback} />
}
