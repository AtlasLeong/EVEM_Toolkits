import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { selectGameItemImage } from '../utils/gameItemImage'

function imagePriorityProps(priority) {
  if (priority === true || priority === 'high') return { loading: 'eager', fetchpriority: 'high' }
  if (priority === 'low') return { loading: 'lazy', fetchpriority: 'low' }
  return { loading: 'lazy' }
}

function ImageForSource({ src, alt, imageClassName, width, height, missingLabel, fallback, priority }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) return fallback || <><ImageOff aria-hidden="true" /><span>{missingLabel}</span></>
  return <img className={imageClassName} src={src} alt={alt} width={width} height={height} {...imagePriorityProps(priority)} decoding="async" style={{ objectFit: 'contain' }} onError={() => setFailed(true)} />
}

export default function GameItemImage({ item, src, alt = '', imageClassName, width, height, missingLabel = '图像待补', fallback, mapping, priority }) {
  const selectedSource = selectGameItemImage(item, src, mapping)
  return <ImageForSource key={selectedSource || 'missing'} src={selectedSource} alt={alt} imageClassName={imageClassName} width={width} height={height} missingLabel={missingLabel} fallback={fallback} priority={priority} />
}
