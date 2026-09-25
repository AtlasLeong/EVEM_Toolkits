import { useMemo, useState } from 'react'

const CHART = { width: 760, height: 320, left: 76, right: 24, top: 22, bottom: 42 }
const SERIES = [
  { key: 'best_sell', label: '最低卖价', className: 'sell' },
  { key: 'best_buy', label: '最高买价', className: 'buy' },
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

export default function MarketTrendChart({ points = [], showBuy, showSell, formatPrice, formatTime }) {
  const [activeIndex, setActiveIndex] = useState(null)
  const geometry = useMemo(() => {
    const valid = points.flatMap(point => [priceInteger(point.best_buy), priceInteger(point.best_sell)]).filter(value => value !== null)
    if (!valid.length) return null
    const rawMin = valid.reduce((minimum, value) => value < minimum ? value : minimum, valid[0])
    const rawMax = valid.reduce((maximum, value) => value > maximum ? value : maximum, valid[0])
    const range = rawMax - rawMin
    const padding = [range * 12n / 100n, rawMax / 40n, 1n].reduce((largest, value) => value > largest ? value : largest, 1n)
    const min = rawMin > padding ? rawMin - padding : 0n
    const max = rawMax + padding
    const times = points.map(point => new Date(point.observed_at).getTime())
    const minTime = Math.min(...times)
    const maxTime = Math.max(...times)
    const plotWidth = CHART.width - CHART.left - CHART.right
    const plotHeight = CHART.height - CHART.top - CHART.bottom
    const x = index => CHART.left + (maxTime > minTime && Number.isFinite(times[index])
      ? (times[index] - minTime) / (maxTime - minTime) : points.length > 1 ? index / (points.length - 1) : 0.5) * plotWidth
    const y = value => CHART.top + Number(max - value) / Number(max - min) * plotHeight
    const coordinates = (index, value) => [x(index), y(value)]
    return { min, max, x, y, paths: Object.fromEntries(SERIES.map(series => [series.key, pathSegments(points, series.key, coordinates)])) }
  }, [points])
  const active = activeIndex !== null && points[activeIndex] ? points[activeIndex] : points.at(-1)

  if (!points.length || !geometry) return <div className="market-trend-empty">这段时间暂无有效报价曲线。可切换时间范围，等待真实采集数据。</div>

  return <div className="market-trend-wrap">
    <div className="market-trend-svg-wrap">
      <svg className="market-trend-svg" viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label="买卖报价历史走势图" preserveAspectRatio="xMidYMid meet">
        {[0, 1, 2, 3, 4].map(index => {
          const y = CHART.top + index * (CHART.height - CHART.top - CHART.bottom) / 4
          const value = geometry.max - BigInt(index) * (geometry.max - geometry.min) / 4n
          return <g key={index}><line className="market-trend-gridline" x1={CHART.left} x2={CHART.width - CHART.right} y1={y} y2={y} /><text className="market-trend-axis" x={CHART.left - 12} y={y + 4} textAnchor="end">{axisNumber(value)}</text></g>
        })}
        <text className="market-trend-axis" x={CHART.left} y={CHART.height - 10}>{formatTime(points[0].observed_at)}</text>
        <text className="market-trend-axis" x={CHART.width - CHART.right} y={CHART.height - 10} textAnchor="end">{formatTime(points.at(-1).observed_at)}</text>
        {SERIES.filter(series => series.key === 'best_sell' ? showSell : showBuy).flatMap(series => geometry.paths[series.key].map((path, index) => <path key={`${series.key}-${index}`} className={`market-trend-path market-trend-path--${series.className}`} d={path} />))}
        {activeIndex !== null && points[activeIndex] ? <line className="market-trend-cursor" x1={geometry.x(activeIndex)} x2={geometry.x(activeIndex)} y1={CHART.top} y2={CHART.height - CHART.bottom} /> : null}
      </svg>
      <div className="market-trend-targets">
        {points.map((point, index) => <button key={`${point.observed_at}-${index}`} type="button" tabIndex="-1" className="market-point-target" aria-label={`查看第 ${index + 1} 次观测`} style={{ left: `${geometry.x(index) / CHART.width * 100}%` }} onMouseEnter={() => setActiveIndex(index)} onFocus={() => setActiveIndex(index)} />)}
      </div>
    </div>
    {active ? <div className="market-trend-readout" role="status" aria-label="当前观测报价">
      <time dateTime={active.observed_at}>{formatTime(active.observed_at)}</time>
      <span>最低卖价 <strong className="market-sell-text">{formatPrice(active.best_sell)}</strong></span>
      <span>最高买价 <strong className="market-buy-text">{formatPrice(active.best_buy)}</strong></span>
    </div> : null}
    <table className="market-trend-data" aria-label="走势图数据"><thead><tr><th>采集时间</th><th>最低卖价</th><th>最高买价</th></tr></thead><tbody>{points.map((point, index) => <tr key={`${point.observed_at}-${index}`}><td>{formatTime(point.observed_at)}</td><td>{formatPrice(point.best_sell)}</td><td>{formatPrice(point.best_buy)}</td></tr>)}</tbody></table>
  </div>
}
