import { Panel } from '../ui/Primitives'
import { collectionPauseLabel, healthAge, healthCoverage, healthCapacityWarning } from '../../utils/marketCollectionHealth'
import '../../styles/marketCollectionHealth.css'

const number = value => Number.isFinite(value) && value >= 0 ? value.toFixed(1) : null

export default function CollectionHealthPanel({ health, formatTime }) {
  if (!health) return null
  const throughput = health.throughput
  const rate = number(throughput?.per_hour)
  const plan = health.actual_plan
  return <div role="region" aria-label="采样覆盖与新鲜度">
    <Panel title="采样覆盖与新鲜度" subtitle={`统计时间：${formatTime(health.generated_at_ms)}。仅分析本站已有采样，不触发游戏请求。`}>
      <p className="market-health-explanation">重点目标 2 小时，普通轮转目标 6 小时；这是采样规划目标，不保证达成。超过 2 小时仍标记为已过期。普通商品始终保留至少一半采样名额，空余名额可互相补充。</p>
      <div className="market-health-tiers">
        {['priority', 'ordinary'].map(key => {
          const tier = health.tiers?.[key]
          if (!tier) return null
          return <section className="market-health-tier" key={key} aria-label={key === 'priority' ? '重点商品覆盖' : '普通商品覆盖'}>
            <h3>{key === 'priority' ? '重点商品' : '普通商品'}<small>目标 {healthAge(tier.target_ms)}</small></h3>
            <dl>
              <div><dt>2 小时内有报价</dt><dd>{healthCoverage(tier.usable_within_two_hours, tier.enabled)}</dd></div>
              <div><dt>目标时间内已观测</dt><dd>{healthCoverage(tier.within_target, tier.enabled)}</dd></div>
              <div><dt>已观测 / 已启用</dt><dd>{tier.observed ?? '未知'} / {tier.enabled ?? '未知'}</dd></div>
              <div><dt>年龄中位数 / P95</dt><dd>{healthAge(tier.age_median_ms)} / {healthAge(tier.age_p95_ms)}</dd></div>
              <div><dt>最旧观测年龄</dt><dd>{healthAge(tier.max_age_ms)}</dd></div>
            </dl>
          </section>
        })}
      </div>
      <div className="market-health-meta">
        <p><strong>最近实际计划</strong>{plan ? <>上限 {plan.item_limit} 件，计划 {plan.expected_count ?? '未知'} 件 · {formatTime(plan.planned_at_ms)}{plan.stale ? '（已陈旧）' : ''}</> : '暂无实际计划'}</p>
        <p><strong>观测吞吐</strong>{rate ? `${rate} 件/小时` : '观测不足，暂不可计算'}{throughput?.start_at_ms != null && throughput?.end_at_ms != null ? <small>{formatTime(throughput.start_at_ms)} → {formatTime(throughput.end_at_ms)}，{throughput.run_count} 轮；不是保证刷新速度。</small> : null}</p>
        <p><strong>采集原因</strong>{collectionPauseLabel(health.pause?.code)}{health.pause?.retry_at_ms != null ? <small>冷却到：{formatTime(health.pause.retry_at_ms)}</small> : null}{health.pause?.last_attempt_at_ms != null ? <small>最近尝试：{formatTime(health.pause.last_attempt_at_ms)}</small> : null}</p>
        <p>账号池实时状态：未知。此页不探测账号或改变共享冷却状态。</p>
      </div>
      {(health.capacity?.warnings || []).map((code, index) => <p className="market-health-warning" key={`${code}-${index}`}>{healthCapacityWarning(code)}</p>)}
    </Panel>
  </div>
}
