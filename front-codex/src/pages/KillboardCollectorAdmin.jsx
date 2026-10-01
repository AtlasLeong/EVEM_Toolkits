import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'
import { getKillboardCollectorLogs } from '../services/apiKillboard'
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
const eventStatus = { report: '写入 KM', empty: '空结果', rate_limited: '限流', unauthorized: '未授权', network_error: '网络失败', malformed: '解析失败', budget_exhausted: '预算耗尽' }

export default function KillboardCollectorAdminPage() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [denied, setDenied] = useState(false)
  const load = () => { if (!denied) setRefreshKey(value => value + 1) }
  useEffect(() => {
    if (denied) return undefined
    const controller = new AbortController()
    let active = true
    setLoading(true)
    getKillboardCollectorLogs({ signal: controller.signal }).then(value => {
      if (active) { setData(value); setError('') }
    }).catch(err => {
      if (!active || err.name === 'AbortError') return
      if (err.status === 403) { setData(null); setDenied(true) }
      setError(err.message || '采集日志暂时无法加载')
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; controller.abort() }
  }, [refreshKey, denied])
  const cursor = data?.cursor
  return <div className="page-stack">
    <PageHeader title="击毁采集后台" subtitle="只读查看采集游标、轮次执行流水和失败原因；不会显示会话或账号材料。" action={<div className="head-actions"><button type="button" className="ghost-btn" onClick={load}><RefreshCw size={15} />刷新</button><Link className="ghost-btn" to="/killboard">返回击毁情报</Link></div>} />
    {loading && !data ? <LoadingBar /> : null}
    {error ? <div className="inline-notice" role="alert"><AlertTriangle size={15} />{error}</div> : null}
    {data ? <>
      <Panel title="当前游标" subtitle="用来判断是否停在限流、空边界或配置错误。">
        <div className="market-status-strip"><div><span>采集配置</span><strong>{data.configured ? (data.collection_enabled ? '已启用' : '已暂停') : '未配置'}</strong></div><div><span>最近写入 KM</span><strong>{data.latest_kill_id || '—'}</strong></div><div><span>最近成功 ID</span><strong>{cursor?.last_success_id || '—'}</strong></div><div><span>下一次探测</span><strong>{cursor?.next_probe_id || '—'}</strong></div><div><span>暂停原因</span><strong>{cursor?.pause_reason || '无'}</strong></div><div><span>冷却到</span><strong>{time(cursor?.cooldown_until_ms)}</strong></div><div><span>失败次数</span><strong>{cursor?.failure_count ?? 0}</strong></div></div>
      </Panel>
      <Panel title="最近采集轮次" subtitle="每轮包含请求数、解析报告数、空结果数及停止原因；解析报告不等于已收录。">
        {!data.runs?.length ? <EmptyState title="暂无采集轮次" desc="采集器运行后会在这里留下只读记录。" /> : <div className="market-table-shell"><table className="market-table market-admin-table"><thead><tr><th>开始时间</th><th>状态</th><th>请求 / 写入 / 空结果</th><th>停止原因</th><th>错误</th></tr></thead><tbody>{data.runs.map(run => <tr key={run.id}><td>{time(run.started_at_ms)}</td><td><Pill tone={run.status === 'failed' ? 'danger' : run.status === 'stopped' ? 'neutral' : 'success'}>{runStatus[run.status] || run.status}</Pill></td><td>{run.request_count} / {run.report_count} / {run.empty_count}</td><td>{run.stop_reason || '—'}</td><td>{run.error_code || '—'}</td></tr>)}</tbody></table></div>}
      </Panel>
      <Panel title="请求流水与失败" subtitle="仅保留探测结果，不保存响应正文、Cookie、密码或会话令牌。">
        {!data.events?.length ? <EmptyState title="暂无请求记录" /> : <div className="market-table-shell"><table className="market-table market-admin-table"><thead><tr><th>时间</th><th>KM ID</th><th>结果</th><th>错误代码</th></tr></thead><tbody>{data.events.map(event => <tr key={event.id}><td>{time(event.observed_at_ms)}</td><td>{event.kill_id || '—'}</td><td><Pill tone={event.status === 'report' ? 'success' : event.status === 'empty' ? 'neutral' : 'danger'}>{eventStatus[event.status] || event.status}</Pill></td><td>{event.error_code || '—'}</td></tr>)}</tbody></table></div>}
      </Panel>
    </> : null}
  </div>
}
