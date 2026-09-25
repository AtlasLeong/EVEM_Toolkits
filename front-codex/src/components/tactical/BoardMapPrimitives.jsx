import { Fragment } from 'react'
import { formatSecurityLabel, getSecurityMapColor } from '../../utils/securityColor.js'

// Muted text colors remain distinct from the bright dot palette for dark maps.
export const securityColor = value => {
  if (value == null || value === '' || typeof value === 'boolean') return '#a6adb1'
  const level = Number(value)
  if (!Number.isFinite(level)) return '#a6adb1'
  return level >= .5 ? '#96b8a5' : level > 0 ? '#cfb288' : '#d19b91'
}
export const securityLabel = value => formatSecurityLabel(value, 2)

/** Neutral map ink used by both board types. Interaction belongs to each board. */
export function BoardStarGlyph({ node, scale = 1, selected = false, reported = false, related = false,
  dotClassName = 'tac-star-dot', ringClassName = 'tac-star-ring', showHit = false }) {
  if (!node) return null
  const zoom = Math.max(.0001, scale)
  const emphasisColor = reported ? '#d49a7e' : selected ? '#f0e5c5' : related ? '#bbc9c4' : '#8ca0a3'
  const dotColor = getSecurityMapColor(node.security_status)
  return <Fragment>
    {(selected || reported) && <circle className={ringClassName} cx={node.px} cy={node.py}
      data-fixed-size="true" data-fixed-kind="ring" data-fixed-emphasis="true"
      data-world-x={node.px} data-world-y={node.py}
      data-base-radius={selected ? 12 : 9} data-base-stroke="1"
      r={(selected ? 12 : 9) / zoom} fill="none" stroke={emphasisColor} strokeWidth={1 / zoom} opacity={selected ? .8 : .4} />}
    <circle className={dotClassName} cx={node.px} cy={node.py}
      data-fixed-size="true" data-fixed-kind="dot" data-fixed-emphasis={selected || reported || related ? 'true' : 'false'}
      data-world-x={node.px} data-world-y={node.py}
      data-base-radius={selected ? 5 : reported ? 4 : 3}
      r={(selected ? 5 : reported ? 4 : 3) / zoom} fill={dotColor} />
    {showHit && <circle className="tac-star-hit" cx={node.px} cy={node.py} r={19 / zoom} fill="transparent"
      data-fixed-size="true" data-fixed-kind="hit" data-world-x={node.px} data-world-y={node.py}
      data-base-radius="19" />}
  </Fragment>
}

export function BoardGateLine({ a, b, scale = 1, active = false, className = 'tac-map-gate' }) {
  if (!a || !b) return null
  const zoom = Math.max(.0001, scale)
  return <line className={`${className}${active ? ' is-active' : ''}`}
    x1={a.px} y1={a.py} x2={b.px} y2={b.py}
    stroke={active ? '#819591' : '#46565c'} strokeWidth={(active ? 1.8 : .65) / zoom}
    opacity={active ? .88 : Math.max(.3, Math.min(.5, .18 + zoom * .12))} pointerEvents="none" />
}

export function BoardSystemLabel({ label, node, selected = false }) {
  if (!label || !node) return null
  return <Fragment>
    {label.gateBackdrop && <rect x={label.x + 2} y={label.y + 1} width={Math.max(0, label.width - 4)}
      height={label.height - 2} rx="3" fill="#19252b" opacity=".92" pointerEvents="none" />}
    <text className="tac-star-name" x={label.x + label.width / 2} y={label.y + 14} textAnchor="middle"
      fill={selected ? '#f6edda' : '#d2dcda'} fontSize="13" fontWeight="400" paintOrder="stroke"
      stroke="#19252b" strokeWidth="4">{label.name}</text>
    <text className="tac-star-security" x={label.x + label.width / 2} y={label.y + 30} textAnchor="middle"
      fill={securityColor(node.security_status)} fontSize="10" fontWeight="400" paintOrder="stroke"
      stroke="#19252b" strokeWidth="4">{securityLabel(node.security_status)}</text>
  </Fragment>
}
