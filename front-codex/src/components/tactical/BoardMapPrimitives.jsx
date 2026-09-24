import { Fragment } from 'react'

export const securityColor = value => value == null ? '#a6adb1' : Number(value) >= .5 ? '#96b8a5' : Number(value) > 0 ? '#cfb288' : '#d19b91'
export const securityLabel = value => value == null ? '安等未知' : Number(value).toFixed(2)

/** Neutral map ink used by both board types. Interaction belongs to each board. */
export function BoardStarGlyph({ node, scale = 1, selected = false, reported = false, related = false,
  dotClassName = 'tac-star-dot', ringClassName = 'tac-star-ring', showHit = false }) {
  if (!node) return null
  const zoom = Math.max(.0001, scale)
  const color = reported ? '#d49a7e' : selected ? '#f0e5c5' : related ? '#bbc9c4' : '#8ca0a3'
  return <Fragment>
    {(selected || reported) && <circle className={ringClassName} cx={node.px} cy={node.py}
      r={(selected ? 12 : 9) / zoom} fill="none" stroke={color} strokeWidth={1 / zoom} opacity={selected ? .8 : .4} />}
    <circle className={dotClassName} cx={node.px} cy={node.py}
      r={(selected ? 5 : reported ? 4 : 3) / zoom} fill={color} />
    {showHit && <circle className="tac-star-hit" cx={node.px} cy={node.py} r={19 / zoom} fill="transparent" />}
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
