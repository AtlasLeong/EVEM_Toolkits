import { marketQualityCounts, qualityCoverage, qualityNow } from '../utils/marketQuality'
import '../styles/market-quality.css'

export default function MarketQualitySummary({ query, now }) {
  const data = query.data
  // The response carries its monotonic read time across cached remounts.
  const ageNow = qualityNow(data, typeof performance === 'undefined' ? 0 : performance.now(), now)
  const counts = marketQualityCounts(data, ageNow)
  if (!counts) return <p className="market-quality-unavailable" role="status" title="无法确认整体报价覆盖率">报价质量{query.isError ? '暂不可用' : '读取中…'}</p>
  return <div className={`market-quality${query.isError ? ' market-quality--warning' : ''}`} role="group" aria-label="报价质量">
    <div className="market-quality-summary">
      <span className="market-quality-title">报价质量</span>
      <strong>新鲜卖价 {counts.fresh_sell} / {counts.enabled}</strong>
      <span className="market-quality-rate">{qualityCoverage(counts.fresh_sell, counts.enabled)}</span>
    </div>
    {query.isError ? <span role="status" className="market-quality-warning">摘要刷新失败，显示上次记录</span> : null}
  </div>
}
