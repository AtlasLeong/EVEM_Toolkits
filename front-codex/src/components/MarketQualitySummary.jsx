import { collectionLabel, marketQualityCounts, qualityAge, qualityCoverage, qualityNow } from '../utils/marketQuality'
import '../styles/market-quality.css'

function timestamp(value) {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { hour12: false }) : '尚无记录'
}

export default function MarketQualitySummary({ query, now }) {
  const data = query.data
  // The response carries its monotonic read time across cached remounts.
  const ageNow = qualityNow(data, typeof performance === 'undefined' ? 0 : performance.now(), now)
  const counts = marketQualityCounts(data, ageNow)
  if (!counts) return <p className="market-quality-unavailable" role="status" title="无法确认整体报价覆盖率">报价质量{query.isError ? '暂不可用' : '读取中…'}</p>
  const collector = data.collector || {}
  return <details className={`market-quality${query.isError ? ' market-quality--warning' : ''}`} onKeyDown={event => {
    if (event.key === 'Escape') {
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }
  }}>
    <summary>
      <span className="market-quality-title">报价质量</span>
      <strong>新鲜卖价 {counts.fresh_sell} / {counts.enabled}</strong>
      <span className="market-quality-rate">{qualityCoverage(counts.fresh_sell, counts.enabled)}</span>
      <span className="market-quality-disclosure">查看说明</span>
    </summary>
    <div className="market-quality-body" role="region" aria-label="报价质量说明" tabIndex={0}>
      <p><strong>最后采集 {qualityAge(data.last_observed_at, ageNow)}</strong> · {collectionLabel(collector.status)}</p>
      {query.isError ? <p role="status" className="market-quality-warning">摘要刷新失败，以下是上次读取的记录，数据年龄继续计时。</p> : null}
      <p>分母为全部 {counts.enabled} 个已启用采集商品，与当前搜索、分类及分页无关。新鲜卖价表示最近 {data.stale_after_seconds / 3600} 小时内观察到有效卖单，不代表实时成交价。</p>
      <dl className="market-quality-counts">
        <div><dt>新鲜卖价</dt><dd>{counts.fresh_sell}</dd></div>
        <div><dt>旧卖价</dt><dd>{counts.stale_sell}</dd></div>
        <div><dt>过期采集</dt><dd>{counts.stale_observed}</dd></div>
        <div><dt>缺卖盘</dt><dd>{counts.missing_sell}</dd></div>
        <div><dt>双向空盘</dt><dd>{counts.empty_book}</dd></div>
        <div><dt>尚未采集</dt><dd>{counts.uncollected}</dd></div>
      </dl>
      <p>旧卖价仍可供历史参考；过期采集与缺卖盘可能重叠。缺卖盘只统计已有采集但无卖单的商品，双向空盘为其中同时无买单的部分。缺价不会作为 0 ISK。</p>
      <dl className="market-quality-times">
        <div><dt>最新采集记录</dt><dd>{timestamp(data.last_observed_at)}</dd></div>
        <div><dt>最老采集记录</dt><dd>{timestamp(data.oldest_observed_at)}{data.oldest_observed_at ? `（${qualityAge(data.oldest_observed_at, ageNow)}）` : ''}</dd></div>
        <div><dt>最近采集尝试</dt><dd>{timestamp(collector.last_attempt_at)}</dd></div>
        <div><dt>最近取得数据</dt><dd>{timestamp(collector.last_success_at)}</dd></div>
        {collector.last_failure_at ? <div><dt>最近采集异常</dt><dd>{timestamp(collector.last_failure_at)}</dd></div> : null}
        <div><dt>摘要读取时间</dt><dd>{timestamp(data.generated_at)}</dd></div>
        <div><dt>摘要来源时间</dt><dd>{timestamp(data.snapshot_at)}</dd></div>
      </dl>
      <p className="market-quality-note">后端摘要缓存 {data.cache_ttl_seconds / 60} 分钟，页面每 5 分钟读取，年龄每 30 秒重新判断。采集状态按摘要来源时间展示。最近取得数据包括部分成功的采集；采集失败时保留先前报价，恢复采集不保证全部商品都有卖单。</p>
    </div>
  </details>
}
