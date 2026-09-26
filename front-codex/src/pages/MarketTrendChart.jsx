import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { formatCompactMarketPrice } from '../utils/marketPrice'

const CHART = { width: 760, height: 300, left: 72, right: 20, top: 20, bottom: 34 }
const SERIES = [
  { key: 'best_sell', label: '最低卖价', tone: 'sell' },
  { key: 'best_buy', label: '最高买价', tone: 'buy' },
]

function priceInteger(value) {
  if (value === null || value === undefined || value === '') return null
  const match = String(value).match(/^(\d+)(?:\.(\d{1,2}))?$/)
  if (!match) return null
  try {
    return BigInt(match[1]) * 100n + BigInt((match[2] || '').padEnd(2, '0') || '0')
  } catch {
    return null
  }
}

function axisNumber(value) {
  const number = Number(value) / 100
  if (number >= 1e12) return `${(number / 1e12).toFixed(1)}万亿`
  if (number >= 1e8) return `${(number / 1e8).toFixed(1)}亿`
  if (number >= 1e4) return `${(number / 1e4).toFixed(1)}万`
  return number.toLocaleString('zh-CN', { maximumFractionDigits: 2 })
}

function axisTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function pathSegments(points, field, coordinates) {
  const paths = []
  let segment = []
  const flush = () => {
    if (segment.length > 1) paths.push(segment.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' '))
    segment = []
  }
  points.forEach((point, index) => {
    const value = priceInteger(point[field])
    if (value === null) flush()
    else segment.push(coordinates(index, value))
  })
  flush()
  return paths
}

function buildGeometry(points, field, chart) {
  const valid = points.map(point => priceInteger(point[field])).filter(value => value !== null)
  if (!valid.length) return null
  const rawMin = valid.reduce((minimum, value) => value < minimum ? value : minimum, valid[0])
  const rawMax = valid.reduce((maximum, value) => value > maximum ? value : maximum, valid[0])
  const range = rawMax - rawMin
  const padding = [range * 12n / 100n, rawMax / 40n, 1n].reduce((largest, value) => value > largest ? value : largest, 1n)
  const min = rawMin > padding ? rawMin - padding : 0n
  const max = rawMax + padding
  const times = points.map(point => new Date(point.observed_at).getTime())
  const finiteTimes = times.filter(Number.isFinite)
  const minTime = finiteTimes.length ? Math.min(...finiteTimes) : 0
  const maxTime = finiteTimes.length ? Math.max(...finiteTimes) : 0
  const plotWidth = chart.width - chart.left - chart.right
  const plotHeight = chart.height - chart.top - chart.bottom
  const x = index => chart.left + (maxTime > minTime && Number.isFinite(times[index])
    ? (times[index] - minTime) / (maxTime - minTime) : points.length > 1 ? index / (points.length - 1) : 0.5) * plotWidth
  const y = value => chart.top + Number(max - value) / Number(max - min) * plotHeight
  const coordinates = (index, value) => [x(index), y(value)]
  return { min, max, x, y, paths: pathSegments(points, field, coordinates) }
}

function statEntry(stats, section, key) {
  const value = stats?.[section]?.[key]
  return value && typeof value === 'object' ? value : null
}

function TrendStats({ stats, section, formatPrice }) {
  const entries = [
    ['当前', statEntry(stats, section, 'current')],
    ['区间高', statEntry(stats, section, 'range')?.high],
    ['区间低', statEntry(stats, section, 'range')?.low],
    ['月高', statEntry(stats, section, 'month')?.high],
    ['月低', statEntry(stats, section, 'month')?.low],
  ]
  return <dl className="market-trend-stats" aria-label="价格统计（ISK）">
    {entries.map(([label, entry]) => {
      const compact = formatCompactMarketPrice(entry?.value)
      const exact = compact === '样本不足' ? compact : formatPrice(String(entry.value).trim())
      return <div key={label}>
        <dt>{label}</dt>
        <dd title={exact}><span aria-hidden="true">{compact}</span><span className="sr-only">{exact}</span></dd>
      </div>
    })}
  </dl>
}

function ChartPanel({ points, field, label, tone, stats, formatPrice, formatTime, activeIndex, activePanel, onActivate, tooltipId }) {
  const plotRef = useRef(null)
  const tooltipRef = useRef(null)
  const [size, setSize] = useState({ width: CHART.width, height: CHART.height })
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 })
  const [measuredIndex, setMeasuredIndex] = useState(null)
  const chart = useMemo(() => ({ ...CHART, ...size, left: size.width < 400 ? 56 : 72, right: 16, top: 18, bottom: 34 }), [size])
  const geometry = useMemo(() => buildGeometry(points, field, chart), [points, field, chart])
  const active = activeIndex !== null && points[activeIndex] ? points[activeIndex] : points.at(-1)
  const selected = activeIndex !== null && points[activeIndex] ? points[activeIndex] : null
  const activeValue = selected ? priceInteger(selected[field]) : null
  const fallbackValue = selected ? priceInteger(selected.best_sell) ?? priceInteger(selected.best_buy) : null
  const activeX = selected && geometry ? geometry.x(activeIndex) : null
  const activeY = geometry && (activeValue !== null || fallbackValue !== null) ? geometry.y(activeValue ?? fallbackValue) : null
  const hasGeometry = Boolean(geometry)

  useLayoutEffect(() => {
    const plot = plotRef.current
    if (!plot) return undefined
    const measure = () => {
      const { width, height } = plot.getBoundingClientRect()
      if (width > 0 && height > 0) setSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(plot)
    return () => observer.disconnect()
  }, [hasGeometry])

  useLayoutEffect(() => {
    setMeasuredIndex(null)
    if (activeX === null || activeY === null || activePanel !== tone || !tooltipRef.current) return undefined
    const { width, height } = tooltipRef.current.getBoundingClientRect()
    const above = activeY - height - 12
    const left = Math.max(4, Math.min(activeX - width / 2, chart.width - width - 4))
    const top = Math.max(4, Math.min(above >= 4 ? above : activeY + 12, chart.height - height - 4))
    setTooltipPosition(previous => previous.left === left && previous.top === top ? previous : { left, top })
    setMeasuredIndex(activeIndex)
    return undefined
  }, [activeX, activeY, activeIndex, activePanel, tone, active, chart])

  function moveBy(index, delta) {
    const nextIndex = Math.min(Math.max(index + delta, 0), points.length - 1)
    const target = plotRef.current?.querySelector(`[data-point-index="${nextIndex}"]`)
    if (target) {
      target.focus()
      onActivate(nextIndex, tone)
    }
  }

  return <section className={`market-trend-panel market-trend-panel--${tone}`} aria-label={`${label}走势`}>
    <div className="market-trend-panel-head"><div><span className="market-trend-panel-kicker">{tone === 'sell' ? 'SELL SIDE' : 'BUY SIDE'}</span><h4>{label} <small>ISK</small></h4></div><span className="market-trend-panel-count">{points.length} 次观测</span></div>
    <TrendStats stats={stats} section={tone} formatPrice={formatPrice} />
    {!geometry ? <div className="market-trend-panel-empty">暂无有效报价曲线</div> : <div ref={plotRef} className="market-trend-svg-wrap" onMouseLeave={() => onActivate(null, tone)}>
      <svg className="market-trend-svg" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${label}历史走势图`}>
        {[0, 1, 2, 3, 4].map(index => {
          const y = chart.top + index * (chart.height - chart.top - chart.bottom) / 4
          const value = geometry.max - BigInt(index) * (geometry.max - geometry.min) / 4n
          return <g key={index}><line className="market-trend-gridline" x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} /><text className="market-trend-axis" x={chart.left - 10} y={y + 4} textAnchor="end">{axisNumber(value)}</text></g>
        })}
        <text className="market-trend-axis" x={chart.left} y={chart.height - 8}>{axisTime(points[0].observed_at)}</text>
        <text className="market-trend-axis" x={chart.width - chart.right} y={chart.height - 8} textAnchor="end">{axisTime(points.at(-1).observed_at)}</text>
        {geometry.paths.map((path, index) => <path key={`${field}-${index}`} className={`market-trend-path market-trend-path--${tone}`} d={path} />)}
        {activePanel === tone && selected ? <line className="market-trend-cursor" x1={geometry.x(activeIndex)} x2={geometry.x(activeIndex)} y1={chart.top} y2={chart.height - chart.bottom} /> : null}
        {activePanel === tone && selected ? (() => {
          const value = priceInteger(selected[field])
          return value === null ? null : <circle className={`market-trend-point market-trend-point--${tone}`} cx={geometry.x(activeIndex)} cy={geometry.y(value)} r="5" />
        })() : null}
      </svg>
      <div className="market-trend-targets">
        {points.map((point, index) => <button
          key={`${point.observed_at}-${index}`}
          type="button"
          tabIndex={0}
          data-point-index={index}
          className="market-point-target"
          aria-label={`${tone === 'sell' ? '卖价' : '买价'}第 ${index + 1} 次观测`}
          aria-describedby={activePanel === tone && activeIndex === index ? tooltipId : undefined}
          style={{ left: `${geometry.x(index) / chart.width * 100}%` }}
          onMouseEnter={() => onActivate(index, tone)}
          onFocus={() => onActivate(index, tone)}
          onKeyDown={event => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              moveBy(index, event.key === 'ArrowRight' ? 1 : -1)
            }
          }}
        />)}
      </div>
      {activePanel === tone && selected && activeX !== null && activeY !== null ? <div ref={tooltipRef} id={tooltipId} className={`market-trend-tooltip${measuredIndex === activeIndex ? ' is-measured' : ''}`} role="tooltip" style={tooltipPosition}>
        <time dateTime={selected.observed_at}>{formatTime(selected.observed_at)}</time>
        <span><b className="market-sell-text">最低卖价</b><strong>{formatPrice(selected.best_sell)}</strong></span>
        <span><b className="market-buy-text">最高买价</b><strong>{formatPrice(selected.best_buy)}</strong></span>
      </div> : null}
    </div>}
  </section>
}

export default function MarketTrendChart({ points = [], showBuy = true, showSell = true, stats, formatPrice, formatTime }) {
  const [activeIndex, setActiveIndex] = useState(null)
  const [activePanel, setActivePanel] = useState('sell')
  const id = useId().replace(/:/g, '')
  const sellTooltipId = `market-trend-tooltip-${id}-sell`
  const buyTooltipId = `market-trend-tooltip-${id}-buy`
  const active = activeIndex !== null && points[activeIndex] ? points[activeIndex] : points.at(-1)
  const hasPoints = points.length > 0

  function activate(index, panel) {
    setActivePanel(panel)
    setActiveIndex(index)
  }

  if (!hasPoints) return <div className="market-trend-empty">这段时间暂无有效报价曲线。可切换时间范围，等待真实采集数据。</div>

  return <div className="market-trend-wrap">
    <div className="market-trend-panels">
      {showSell ? <ChartPanel points={points} field="best_sell" label="最低卖价" tone="sell" stats={stats} formatPrice={formatPrice} formatTime={formatTime} activeIndex={activeIndex} activePanel={activePanel} onActivate={activate} tooltipId={sellTooltipId} /> : null}
      {showBuy ? <ChartPanel points={points} field="best_buy" label="最高买价" tone="buy" stats={stats} formatPrice={formatPrice} formatTime={formatTime} activeIndex={activeIndex} activePanel={activePanel} onActivate={activate} tooltipId={buyTooltipId} /> : null}
    </div>
    {active ? <div className="market-trend-readout" role="status" aria-label="当前观测报价">
      <time dateTime={active.observed_at}>{formatTime(active.observed_at)}</time>
      <span>最低卖价 <strong className="market-sell-text">{formatPrice(active.best_sell)}</strong></span>
      <span>最高买价 <strong className="market-buy-text">{formatPrice(active.best_buy)}</strong></span>
    </div> : null}
    <table className="market-trend-data" aria-label="走势图数据"><thead><tr><th>采集时间</th><th>最低卖价</th><th>最高买价</th></tr></thead><tbody>{points.map((point, index) => <tr key={`${point.observed_at}-${index}`}><td>{formatTime(point.observed_at)}</td><td>{formatPrice(point.best_sell)}</td><td>{formatPrice(point.best_buy)}</td></tr>)}</tbody></table>
  </div>
}
