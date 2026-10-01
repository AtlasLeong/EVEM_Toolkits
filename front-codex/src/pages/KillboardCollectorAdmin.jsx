import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'
import { getKillboardCollectorLogs } from '../services/apiKillboard'
import { collectorAuditLabel, collectorRunCounts } from '../utils/killboardPresentation'
import '../styles/market.css'

function time(value) {
  if (value == null) return '—'
  const date = new Date(Number(value))
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date).replaceAll('/', '/')
}

const runStatus = { stopped: '已结束', succeeded: '成功', failed: '失败', running: '执行中', queued: '排队中' }
const eventStatus = { report: '解析 KM', empty: '空结果', rate_limited: '请求过于频繁', unauthorized: '会话失效', network_error: '网络失败', malformed: '解析失败', budget_exhausted: '预算耗尽' }
const count = value => value == null ? '未记录' : value

export default function KillboardCollectorAdminPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [denied, setDenied] = useState(false)
  const inFlight = useRef(false)
  const load = () => { if (!denied) setRefreshKey(value => value + 1) }
  useEffect(() => {
    if (denied) return undefined
    const controller = new AbortController()
    let active = true
    inFlight.current = true
    setLoading(true)
    getKillboardCollectorLogs({ signal: controller.signal }).then(value => {
      if (active) { setData(value); setError('') }
    }).catch(err => {
      if (!active || err.name === 'AbortError') return
      if (err.status === 403) { setData(null); setDenied(true) }
      setError(err.message || '采集日志暂时无法加载')
    }).finally(() => { if (active) { inFlight.current = false; setLoading(false) } })
    return () => { active = false; inFlight.current = false; controller.abort() }
  }, [refreshKey, denied])
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || denied) return undefined
    const refreshVisible = () => { if (document.visibilityState === 'visible' && !inFlight.current) load() }
    const timer = window.setInterval(refreshVisible, 180000)
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [denied])
  const cursor = data?.cursor
  const strategy = cursor?.strategy
  return <div className="page-stack">
    <PageHeader title="击毁采集后台" subtitle="只读查看采集游标、轮次执行流水和失败原因；不会显示会话或账号材料。" action={<div className="head-actions"><button type="button" className="ghost-btn" onClick={load}><RefreshCw size={15} />刷新</button><Link className="ghost-btn" to="/killboard">返回击毁情报</Link></div>} />
    {loading && !data ? <LoadingBar /> : null}
    {error ? <div className="inline-notice" role="alert"><AlertTriangle size={15} />{error}</div> : null}
    {data ? <>
      <Panel title="当前游标" subtitle="用来判断是否停在限流、空边界或配置错误。">
        <div className="market-status-strip"><div><span>采集配置</span><strong>{data.configured ? (data.collection_enabled ? '已启用' : '已暂停') : '未配置'}</strong></div><div><span>最近收录 KM</span><strong>{data.latest_kill_id || '—'}</strong></div><div><span>最近写入时间</span><strong>{time(data.latest_report_collected_at_ms)}</strong></div><div><span>最近成功 ID</span><strong>{cursor?.last_success_id || '—'}</strong></div><div><span>下一次探测</span><strong>{cursor?.next_probe_id || '—'}</strong></div><div><span>暂停原因</span><strong>{cursor?.pause_reason ? collectorAuditLabel(cursor.pause_reason) : '无'}</strong></div><div><span>冷却到</span><strong>{time(cursor?.cooldown_until_ms)}</strong></div><div><span>失败次数</span><strong>{cursor?.failure_count ?? 0}</strong></div></div>
      </Panel>
      <Panel title="最新优先与历史待补" subtitle="10 分钟检查周期，附加随机延迟；上游限流时停止并安全退避，不等于每 10 分钟完成全量收录。">
        <div className="market-status-strip"><div><span>当前阶段</span><strong>{collectorAuditLabel(strategy?.phase)}</strong></div><div><span>最新候选 ID</span><strong>{strategy?.newest_candidate_id || '尚未定位'}</strong></div><div><span>历史待补起点</span><strong>{strategy?.historical_next_id || '—'}</strong></div><div><span>待补 ID / 区间</span><strong>{strategy?.pending_id_count ?? '—'} / {strategy?.pending_range_count ?? '—'}</strong></div><div><span>等待可见的 ID</span><strong>{strategy?.deferred_id_count ?? '—'}</strong></div><div><span>边界定位时间</span><strong>{time(strategy?.last_boundary_at_ms)}</strong></div><div><span>收录覆盖</span><strong>覆盖未验证</strong></div></div>
      </Panel>
      <Panel title="最近采集轮次" subtitle="探测是候选 KM 请求；RPC 还包含认证和身份查询。解析不等于收录，新增与更新单独记录；旧轮次未记录这些计数。">
        {!data.runs?.length ? <EmptyState title="暂无采集轮次" desc="采集器运行后会在这里留下只读记录。" /> : <div className="market-table-shell"><table className="market-table market-admin-table"><thead><tr><th>开始时间</th><th>状态 / 会话槽位</th><th>探测 / 解析 / 空结果</th><th>实际 RPC</th><th>新增 / 更新</th><th>价值过滤 / NPC 过滤</th><th>身份待补</th><th>阶段 / RPC 方法</th><th>停止原因</th></tr></thead><tbody>{data.runs.map(run => {
          const counters = collectorRunCounts(run)
          const audit = run.diagnostics || {}
          return <tr key={run.id}><td>{time(run.started_at_ms)}</td><td><Pill tone={run.status === 'failed' ? 'danger' : run.status === 'stopped' ? 'neutral' : 'success'}>{runStatus[run.status] || '未知'}</Pill><div>{audit.session_slot ? `会话 ${audit.session_slot}` : '槽位未记录'}</div></td><td>{counters.requests} / {counters.parsed} / {counters.empty}</td><td>{count(counters.rpc)}</td><td>{count(counters.created)} / {count(counters.updated)}</td><td>{count(counters.filteredValue)} / {count(counters.filteredNpc)}</td><td>{count(counters.deferred)}</td><td>{collectorAuditLabel(audit.stage)}<div>{audit.failure_rpc_method || audit.last_rpc_method || '方法未记录'}</div></td><td>{collectorAuditLabel(run.stop_reason || run.error_code)}</td></tr>
        })}</tbody></table></div>}
      </Panel>
      <Panel title="请求流水与失败" subtitle="仅保留探测结果，不保存响应正文、Cookie、密码或会话令牌。">
        {!data.events?.length ? <EmptyState title="暂无请求记录" /> : <div className="market-table-shell"><table className="market-table market-admin-table"><thead><tr><th>时间</th><th>KM ID</th><th>会话槽位</th><th>结果 / 收录处理</th><th>阶段 / RPC 方法</th><th>错误</th></tr></thead><tbody>{data.events.map(event => {
          const audit = event.diagnostics || {}
          return <tr key={event.id}><td>{time(event.observed_at_ms)}</td><td>{event.kill_id || '—'}</td><td>{audit.session_slot || '未记录'}</td><td><Pill tone={event.status === 'report' ? 'success' : event.status === 'empty' ? 'neutral' : 'danger'}>{eventStatus[event.status] || '未知'}</Pill><div>{collectorAuditLabel(audit.disposition)}</div></td><td>{collectorAuditLabel(audit.stage)}<div>{audit.failure_rpc_method || audit.last_rpc_method || '方法未记录'}</div></td><td>{collectorAuditLabel(event.error_code || audit.error_code)}</td></tr>
        })}</tbody></table></div>}
      </Panel>
    </> : null}
  </div>
}
