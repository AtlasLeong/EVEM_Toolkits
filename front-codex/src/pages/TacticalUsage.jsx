import { useContext, useEffect, useState } from 'react'
import { Activity, ArrowLeft, Crosshair, LockKeyhole, RefreshCw, Users } from 'lucide-react'
import { Link } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import { getTacticalUsageOverview } from '../services/apiTacticalUsage'
import '../styles/tacticalUsage.css'

const PERIODS = { today: '今日', '7d': '近 7 天', '30d': '近 30 天' }
const number = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('zh-CN') : '—'
const time = value => {
  const date = new Date(value)
  return value && Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '—'
}

function StatCard({ label, value, hint, icon: Icon }) {
  return <article className="tactical-usage-stat">
    <div className="tactical-usage-stat-label"><span>{label}</span><Icon size={18} aria-hidden="true" /></div>
    <p className="tactical-usage-stat-value">{number(value)}<span>人</span></p>
    <p className="tactical-usage-hint">{hint}</p>
  </article>
}

function PrivateOverview() {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ loading: true, data: null, error: null })
  useEffect(() => {
    let current = true
    const controller = new AbortController()
    setState({ loading: true, data: null, error: null })
    getTacticalUsageOverview({ signal: controller.signal }).then(
      data => { if (current) setState({ loading: false, data, error: null }) },
      error => {
        if (!current) return
        setState({ loading: false, data: null, error })
        if ([401, 403].includes(error.status)) window.dispatchEvent(new Event('tactical-usage:denied'))
      },
    )
    return () => { current = false; controller.abort() }
  }, [revision])
  const { data, loading, error } = state
  const denied = error && [401, 403].includes(error.status)
  const totals = data?.totals

  return <section className="tactical-usage-page" aria-labelledby="tactical-usage-title">
    <header className="tactical-usage-header">
      <div>
        <p className="tactical-usage-eyebrow"><LockKeyhole size={14} aria-hidden="true" />私有后台 · 只读</p>
        <h1 id="tactical-usage-title">战术板使用概况</h1>
        <p className="tactical-usage-subtitle">从创建、加入到实际操作，了解战术板的使用情况。</p>
      </div>
      <div className="tactical-usage-actions">
        <Link className="ghost-btn" to="/tactical"><ArrowLeft size={16} aria-hidden="true" />返回战术板</Link>
        {!denied && <button className="primary-btn" type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}><RefreshCw size={16} aria-hidden="true" />{loading ? '读取中' : '刷新数据'}</button>}
      </div>
    </header>

    {loading && <div className="tactical-usage-status" role="status">正在读取已有记录…</div>}
    {error && <div className="tactical-usage-status tactical-usage-status--error" role="alert">
      <h2>{denied ? '无权访问' : '暂时无法读取统计'}</h2>
      <p>{denied ? '此后台仅向指定账号开放，普通管理员也无法访问。' : '本次请求失败，未将缺失数据计为零。请稍后重试。'}</p>
      {!denied && <button className="ghost-btn" onClick={() => setRevision(value => value + 1)}>重试</button>}
    </div>}

    {data && <>
      <div className="tactical-usage-meta"><span>只读取现有业务记录 · 未新增访问采集</span><span>更新于 {time(data.generated_at)}（北京时间）</span></div>
      <div className="tactical-usage-stats" aria-label="人数总览">
        <StatCard label="创建组织人数" value={totals.creator_users} hint="同一账号创建多个组织，只计 1 人" icon={Crosshair} />
        <StatCard label="已加入人数" value={totals.joined_users} hint="当前有效成员，含创建者，跨组织去重" icon={Users} />
        <StatCard label="累计操作人数" value={totals.operation_users} hint="现有日志中提交过战术操作的账号" icon={Activity} />
        <StatCard label="待审批人数" value={totals.pending_applicants} hint="仍有待审批申请的账号，跨组织去重" icon={Users} />
      </div>

      <section className="tactical-usage-resources" aria-label="组织与战术板数量">
        <div><span>现有组织</span><strong>{number(totals.organizations)}<small>个</small></strong></div>
        <div><span>战争沙盘</span><strong>{number(totals.war_boards)}<small>块</small></strong></div>
        <div><span>海盗情报板</span><strong>{number(totals.pirate_boards)}<small>块</small></strong></div>
        <p>数量与人数分开统计<br />一人可以参与多个组织、多个板</p>
      </section>

      <section className="tactical-usage-panel" aria-labelledby="tactical-usage-periods">
        <div className="tactical-usage-panel-head"><div><h2 id="tactical-usage-periods">实际操作情况</h2><p>上报、部署调整、情报提交等成功操作；不包含邀请、审批或仅打开页面。</p></div><span className="tactical-usage-tag">按账号去重</span></div>
        <div className="tactical-usage-table-wrap"><table>
          <caption className="sr-only">按北京时间统计今日、近 7 天与近 30 天的实际操作人数及次数</caption>
          <thead><tr><th scope="col">统计时段</th><th scope="col">操作人数</th><th scope="col">操作次数</th><th scope="col">有操作的组织</th></tr></thead>
          <tbody>{data.periods.map(period => <tr key={period.key}>
            <th scope="row"><strong>{PERIODS[period.key] || period.key}</strong><span>{time(period.start_at)} 起</span></th>
            <td>{number(period.operation_users)}<small>人</small></td><td>{number(period.operations)}<small>次</small></td><td>{number(period.active_organizations)}<small>个</small></td>
          </tr>)}</tbody>
        </table></div>
        {totals.operation_users === 0 && <p className="tactical-usage-empty">暂无符合口径的战术操作记录。创建或加入组织不等于已经操作过战术板。</p>}
      </section>

      <aside className="tactical-usage-notes" aria-label="统计口径">
        <h2>这些数字代表什么？</h2>
        <ul>
          <li>战术板复用网站账号，没有独立注册；“已加入人数”不包含已移除成员，也不等于网站注册总人数。</li>
          <li>只查看、不操作的用户无法从现有记录还原。这里不是访问量或在线人数，各时段人数也不能相加。</li>
          <li>近 7 / 30 天包含今天，按北京时间自然日计算，截至本次更新；待审批人数可能与已加入人数重叠。</li>
          <li>{data.first_operation_at ? `现有日志中最早的战术操作：${time(data.first_operation_at)}。统计仅覆盖仍保留的记录。` : '现有日志中尚无符合口径的战术操作，不推算历史浏览人数。'}</li>
        </ul>
        <p><LockKeyhole size={14} aria-hidden="true" />仅展示汇总数字，不展示成员名单、组织名称或私有情报。</p>
      </aside>
    </>}
  </section>
}

export default function TacticalUsagePage() {
  const { isAuthenticated, userInfo } = useContext(AuthContext)
  if (!isAuthenticated || userInfo?.userId == null) return <div className="tactical-usage-status" role="alert">请先登录后查看。</div>
  // Account changes unmount all private state before new requests can complete.
  return <PrivateOverview key={userInfo.userId} />
}
