import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
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

function axisTime(value, compact = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', {
    ...(compact === 'clock' ? {} : { month: '2-digit', day: '2-digit' }),
    ...(!compact || compact === 'clock' ? { hour: '2-digit', minute: '2-digit' } : {}),
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

function TrendStats({ stats, section, formatPrice, unread = false }) {
  const scrollHintId = useId()
  const entries = [
    ['当前', statEntry(stats, section, 'current')],
    ['区间高', statEntry(stats, section, 'range')?.high],
    ['区间低', statEntry(stats, section, 'range')?.low],
    ['30天高', statEntry(stats, section, 'month')?.high],
    ['30天低', statEntry(stats, section, 'month')?.low],
  ]
  return <><div className="market-trend-stats-viewport" role="region" aria-label={`${section === 'sell' ? '卖价' : '买价'}统计，可左右滚动`} aria-describedby={scrollHintId} tabIndex={0}>
    <dl className="market-trend-stats" aria-label="价格统计（ISK）">
      {entries.map(([label, entry]) => {
        const compact = unread ? '—' : formatCompactMarketPrice(entry?.value)
        const exact = unread ? '尚未读取' : compact === '样本不足' ? compact : formatPrice(String(entry.value).trim())
        return <div key={label}>
          <dt>{label}</dt>
          <dd title={exact}><span aria-hidden="true">{compact}</span><span className="sr-only">{exact}</span></dd>
        </div>
      })}
    </dl>
  </div><p id={scrollHintId} className="market-stats-scroll-hint">左右滑动查看全部统计 · 支持方向键</p></>
}

function ChartPanel({ points, field, label, tone, stats, formatPrice, formatTime, activeIndex, activePanel, onActivate, tooltipId, showBuy, showSell, state, loadingMessage }) {
  const plotRef = useRef(null)
  const svgRef = useRef(null)
  const tooltipRef = useRef(null)
  const [size, setSize] = useState({ width: CHART.width, height: CHART.height })
  const [axisSize, setAxisSize] = useState({ price: 0, fullTime: 0, shortTime: 0, height: 12 })
  const [tooltipPosition, setTooltipPosition] = useState({ left: 0, top: 0 })
  const [measuredIndex, setMeasuredIndex] = useState(null)
  const compactTimeMode = points.length && new Date(points[0].observed_at).toDateString() === new Date(points.at(-1).observed_at).toDateString() ? 'clock' : 'date'
  const chart = useMemo(() => {
    const left = Math.max(size.width < 400 ? 56 : 72, Math.ceil(axisSize.price) + 16)
    const right = size.width >= 600 ? 96 : 16
    const plotWidth = size.width - left - right
    const compactTime = plotWidth < axisSize.fullTime * 2 + 16
    const staggerTime = compactTime && plotWidth < axisSize.shortTime * 2 + 16
    return { ...CHART, ...size, left, right, top: Math.max(24, axisSize.height + 8), bottom: Math.max(34, axisSize.height * (staggerTime ? 2 : 1) + 12), compactTime, staggerTime }
  }, [size, axisSize])
  const geometry = useMemo(() => buildGeometry(points, field, chart), [points, field, chart])
  const active = activeIndex !== null && points[activeIndex] ? points[activeIndex] : points.at(-1)
  const selected = activeIndex !== null && points[activeIndex] ? points[activeIndex] : null
  const activeValue = selected ? priceInteger(selected[field]) : null
  const fallbackValue = selected ? priceInteger(selected.best_sell) ?? priceInteger(selected.best_buy) : null
  const activeX = selected && geometry ? geometry.x(activeIndex) : null
  const activeY = geometry && (activeValue !== null || fallbackValue !== null) ? geometry.y(activeValue ?? fallbackValue) : null
  const hasGeometry = Boolean(geometry)
  const lastValue = priceInteger(points.at(-1)?.[field])
  const lastY = geometry && lastValue !== null ? geometry.y(lastValue) : null

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

  // SVG label widths change with the actual font, including text enlargement.
  // Reserve their measured width rather than assuming a fixed 56px gutter.
  useLayoutEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const labels = [...svg.querySelectorAll('.market-trend-axis, .market-axis-measure-text')]
    const measure = () => {
      const width = selector => Math.max(0, ...[...svg.querySelectorAll(selector)].map(node => node.getComputedTextLength()))
      const next = {
        price: width('.market-trend-axis--value'),
        fullTime: width('.market-axis-measure--full'),
        shortTime: width('.market-axis-measure--short'),
        height: Math.max(12, ...labels.map(node => node.getBBox().height)),
      }
      setAxisSize(previous => Object.keys(next).every(key => Math.abs(previous[key] - next[key]) < 0.5) ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    labels.forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [hasGeometry, points, field])

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
    <div className="market-trend-panel-head"><div><span className="market-trend-panel-kicker">{tone === 'sell' ? 'SELL SIDE' : 'BUY SIDE'}</span><h4>{label} <small>ISK</small></h4></div></div>
    <TrendStats stats={stats} section={tone} formatPrice={formatPrice} unread={state !== 'ready'} />
    {!geometry ? <div className="market-trend-svg-wrap market-trend-plot-placeholder">
      {state === 'loading' ? <div className="market-chart-message" role="status"><span>{loadingMessage}</span></div> : state === 'error' ? <div className="market-chart-message" role="alert">走势图暂时无法加载；当前报价与历史走势可能不一致，请稍后刷新。</div> : points.length ? <div className="market-trend-panel-empty">暂无有效报价曲线</div> : <div className="market-trend-empty">这段时间暂无有效报价曲线。可切换时间范围，等待真实采集数据。</div>}
    </div> : <div ref={plotRef} className="market-trend-svg-wrap" onMouseLeave={() => onActivate(null, tone)}>
      <svg ref={svgRef} className="market-trend-svg" viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${label}历史走势图`}>
        {[0, 1, 2, 3, 4].map(index => {
          const y = chart.top + index * (chart.height - chart.top - chart.bottom) / 4
          const value = geometry.max - BigInt(index) * (geometry.max - geometry.min) / 4n
          return <g key={index}><line className="market-trend-gridline" x1={chart.left} x2={chart.width - chart.right} y1={y} y2={y} /><text className="market-trend-axis market-trend-axis--value" x={chart.left - 10} y={y + 4} textAnchor="end">{axisNumber(value)}</text></g>
        })}
        <g aria-hidden="true" opacity="0" className="market-axis-measure">
          {[points[0], points.at(-1)].map((point, index) => <g key={index}><text className="market-axis-measure-text market-axis-measure--full">{axisTime(point.observed_at)}</text><text className="market-axis-measure-text market-axis-measure--short">{axisTime(point.observed_at, compactTimeMode)}</text></g>)}
        </g>
        <text className="market-trend-axis market-trend-axis--time" x={chart.left} y={chart.height - 8 - (chart.staggerTime ? axisSize.height + 4 : 0)} aria-label={formatTime(points[0].observed_at)}>{axisTime(points[0].observed_at, chart.compactTime ? compactTimeMode : false)}</text>
        <text className="market-trend-axis market-trend-axis--time" x={chart.width - chart.right} y={chart.height - 8} textAnchor="end" aria-label={formatTime(points.at(-1).observed_at)}>{axisTime(points.at(-1).observed_at, chart.compactTime ? compactTimeMode : false)}</text>
        {geometry.paths.map((path, index) => <path key={`${field}-${index}`} className={`market-trend-path market-trend-path--${tone}`} d={path} />)}
        {lastY !== null ? <circle className={`market-trend-last-point market-trend-last-point--${tone}`} cx={geometry.x(points.length - 1)} cy={lastY} r="3.5" /> : null}
        {lastY !== null && size.width >= 600 ? <line className={`market-last-guide market-last-guide--${tone}`} x1={geometry.x(points.length - 1)} x2={chart.width - 6} y1={lastY} y2={lastY} /> : null}
        {activePanel === tone && selected ? <line className="market-trend-cursor" x1={geometry.x(activeIndex)} x2={geometry.x(activeIndex)} y1={chart.top} y2={chart.height - chart.bottom} /> : null}
        {activePanel === tone && selected ? (() => {
          const value = priceInteger(selected[field])
          return value === null ? null : <circle className={`market-trend-point market-trend-point--${tone}`} cx={geometry.x(activeIndex)} cy={geometry.y(value)} r="5" />
        })() : null}
      </svg>
      {lastY !== null && size.width >= 600 ? <span className={`market-last-price market-last-price--${tone}`} style={{ top: lastY }} title={formatPrice(points.at(-1)[field])}>{formatCompactMarketPrice(points.at(-1)[field])}</span> : null}
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
        {showSell ? <span><b className="market-sell-text">最低卖价</b><strong>{formatPrice(selected.best_sell)}</strong></span> : null}
        {showBuy ? <span><b className="market-buy-text">最高买价</b><strong>{formatPrice(selected.best_buy)}</strong></span> : null}
      </div> : null}
    </div>}
  </section>
}

export default function MarketTrendChart({ points = [], showBuy = true, showSell = true, stats, formatPrice, formatTime, state = 'ready', loadingMessage = '正在读取真实历史报价…' }) {
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

  useEffect(() => {
    setActiveIndex(null)
    setActivePanel(showSell ? 'sell' : 'buy')
  }, [showBuy, showSell])

  return <div className="market-trend-wrap">
    <div className={`market-trend-panels${showBuy !== showSell ? ' market-trend-panels--single' : ''}`}>
      {showSell ? <ChartPanel points={points} field="best_sell" label="最低卖价" tone="sell" stats={stats} formatPrice={formatPrice} formatTime={formatTime} activeIndex={activeIndex} activePanel={activePanel} onActivate={activate} tooltipId={sellTooltipId} showBuy={showBuy} showSell={showSell} state={state} loadingMessage={loadingMessage} /> : null}
      {showBuy ? <ChartPanel points={points} field="best_buy" label="最高买价" tone="buy" stats={stats} formatPrice={formatPrice} formatTime={formatTime} activeIndex={activeIndex} activePanel={activePanel} onActivate={activate} tooltipId={buyTooltipId} showBuy={showBuy} showSell={showSell} state={state} loadingMessage={loadingMessage} /> : null}
    </div>
    {active ? <div className="market-trend-readout" role="status" aria-label="当前观测报价">
      <time dateTime={active.observed_at}>{formatTime(active.observed_at)}</time>
      {showSell ? <span>最低卖价 <strong className="market-sell-text">{formatPrice(active.best_sell)}</strong></span> : null}
      {showBuy ? <span>最高买价 <strong className="market-buy-text">{formatPrice(active.best_buy)}</strong></span> : null}
    </div> : <div className="market-trend-readout market-trend-readout--placeholder"><span>{state !== 'ready' ? '观测时间尚未读取' : '暂无有效观测时间'}</span><span>{state !== 'ready' ? '报价尚未读取' : '暂无有效观测报价'}</span></div>}
    {hasPoints ? <table className="market-trend-data" aria-label="走势图数据"><thead><tr><th>采集时间</th>{showSell ? <th>最低卖价</th> : null}{showBuy ? <th>最高买价</th> : null}</tr></thead><tbody>{points.map((point, index) => <tr key={`${point.observed_at}-${index}`}><td>{formatTime(point.observed_at)}</td>{showSell ? <td>{formatPrice(point.best_sell)}</td> : null}{showBuy ? <td>{formatPrice(point.best_buy)}</td> : null}</tr>)}</tbody></table> : null}
  </div>
}
