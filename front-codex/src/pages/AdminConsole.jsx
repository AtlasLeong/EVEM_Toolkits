import { useContext, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AuthContext } from '../context/AuthContext'
import useControlCenterAccess, { privateControlKey } from '../hooks/useControlCenterAccess'
import { getControlAudit, getControlOverview, getHotspotGrants, searchControlUsers, updateHotspotGrant } from '../services/apiControlCenter'
import { formatControlTime as time } from '../utils/controlCenterPresentation'
import { formatHotspotElapsed } from '../utils/hotspotChanges'
import '../styles/adminConsole.css'

const statusLabels = { ok: '成功', unavailable: '暂无记录', baseline: '等待第二次成功采集', rate_limited: '限流冷却',
  network_error: '网络失败', unauthorized: '会话未授权', malformed: '数据格式无效', budget_exhausted: '请求预算耗尽',
  lease_lost: '采集锁已失效', configuration_error: '配置异常', service_rejected: '服务拒绝', account_busy: '账号忙碌',
  error: '失败', disabled: '已停用', cooldown: '冷却中', failed: '失败', history_error: '历史写入失败',
  timeout: '请求超时', connection_unavailable: '连接不可用', session_closed: '会话已关闭', unsupported_rpc: '请求方法不受支持' }
const statusLabel = value => statusLabels[value] || '状态待确认'
const stageLabels = { connection: '建立连接', authentication: '会话认证', statistics: '统计读取' }
const number = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString('en-US') : '—'

function ConsoleData({ identity }) {
  const { userInfo } = useContext(AuthContext)
  const client = useQueryClient()
  const root = privateControlKey(identity)
  const [input, setInput] = useState(''), [search, setSearch] = useState('')
  const [grantBefore, setGrantBefore] = useState(null), [auditBefore, setAuditBefore] = useState(null)
  const [reason, setReason] = useState(''), [message, setMessage] = useState('')
  const controller = useRef(null)
  useEffect(() => () => controller.current?.abort(), [])
  const options = { retry: false, staleTime: 25_000, gcTime: 0, refetchIntervalInBackground: false }
  const overview = useQuery({ ...options, queryKey: [...root, 'overview'], queryFn: ({ signal }) => getControlOverview({ signal }), refetchInterval: 30_000 })
  const grants = useQuery({ ...options, queryKey: [...root, 'grants', grantBefore], queryFn: ({ signal }) => getHotspotGrants({ before: grantBefore, signal }) })
  const audit = useQuery({ ...options, queryKey: [...root, 'audit', auditBefore], queryFn: ({ signal }) => getControlAudit({ before: auditBefore, signal }) })
  const users = useQuery({ ...options, queryKey: [...root, 'users', search], queryFn: ({ signal }) => searchControlUsers(search, { signal }), enabled: Boolean(search) })
  const mutation = useMutation({ mutationKey: [...root, 'grant-update'], gcTime: 0, mutationFn: ({ user, enabled }) => {
    controller.current?.abort()
    controller.current = new AbortController()
    return updateHotspotGrant(user.id, { enabled, version: user.grant.version, reason }, { signal: controller.current.signal })
  }, onSuccess: () => {
    setMessage('权限已更新，下一次请求即按新权限校验。')
    void client.invalidateQueries({ queryKey: [...root, 'grants'] })
    void client.invalidateQueries({ queryKey: [...root, 'audit'] })
    void client.invalidateQueries({ queryKey: [...root, 'users'] })
  }, onError: error => {
    setMessage(error.status === 409 ? '授权已被其他操作更新，请重新查询后再试。' : '权限更新失败，未更改授权。')
    if (error.status === 409) void client.invalidateQueries({ queryKey: root })
  } })
  const renderUsers = rows => <ul className="admin-console-user-list">{rows.map(user => {
    const own = String(user.id) === String(userInfo?.userId)
    return <li key={user.id}>
      <div><strong>{user.username}</strong><small>{user.email} · ID {user.id}</small>
        <span>{own ? '超级管理员固定权限' : user.grant.enabled ? '已授权查看变化榜' : '未授权查看变化榜'}</span></div>
      {!own && <button className="ghost-btn" type="button" disabled={mutation.isPending}
        onClick={() => { setMessage(''); mutation.mutate({ user, enabled: !user.grant.enabled }) }}>
        {user.grant.enabled ? '撤销查看权限' : '授予查看权限'}</button>}
    </li>
  })}</ul>
  const collection = overview.isError ? null : overview.data?.collection
  return <>
    <section className="admin-console-section" aria-label="变化榜查看权限">
      <h2>变化榜查看权限</h2><p>仅授予查看变化榜与历史区间的权限，不包含任何管理权限。超级管理员自身权限固定。</p>
      <form className="admin-console-search" onSubmit={event => { event.preventDefault(); setMessage(''); setSearch(input.trim()); if (search === input.trim()) void users.refetch() }}>
        <label>完整邮箱或用户 ID<input type="search" aria-label="完整邮箱或用户 ID" maxLength={254} required value={input} onChange={event => setInput(event.target.value)} placeholder="精确邮箱 / 数字 ID" /></label>
        <button className="primary-btn" type="submit" disabled={!input.trim() || users.isFetching}>精确查询</button>
      </form>
      <label className="admin-console-reason">授权 / 撤销原因（可选）<input type="text" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} /></label>
      {message ? <p role="status" className="admin-console-message">{message}</p> : null}
      {search ? <section aria-label="用户查询结果"><h3>用户查询结果</h3>
        {users.isPending ? <p role="status">正在精确查询…</p> : users.isError ? <p role="alert">查询失败，请检查邮箱或用户 ID 后重试。</p>
          : users.data?.results.length ? renderUsers(users.data.results) : <p>没有匹配的用户。</p>}
      </section> : null}
      <h3>当前授权用户</h3>
      {grants.isError ? <p role="alert">暂时无法读取授权名单。</p> : grants.isPending ? <p role="status">正在读取授权名单…</p>
        : grants.data?.results.length ? renderUsers(grants.data.results) : <p>暂无单独授权用户。</p>}
      <div className="admin-console-pagination">{grantBefore ? <button type="button" className="ghost-btn" onClick={() => setGrantBefore(null)}>返回最新授权</button> : null}
        {grants.data?.next_before ? <button type="button" className="ghost-btn" onClick={() => setGrantBefore(grants.data.next_before)}>更早授权</button> : null}</div>
    </section>
    <section className="admin-console-section" aria-label="采集状态与失败记录"><h2>采集状态与失败记录</h2>
      <p>只读取已有记录，不触发游戏请求。KM 模块保持停用。</p>
      {overview.isError ? <p role="alert">采集记录暂时无法读取。</p> : !collection ? <p role="status">正在读取采集记录…</p> : <>
        <dl className="admin-console-stats"><div><dt>采集状态</dt><dd>{statusLabel(collection.status)}</dd></div>
          <div><dt>最近成功（北京时间）</dt><dd>{time(collection.collected_at_ms)}</dd></div>
          <div><dt>星系数</dt><dd>{number(collection.system_count)}</dd></div>
          <div><dt>历史记录</dt><dd>{statusLabel(collection.history_status)}</dd></div></dl>
        {collection.latest_interval ? <p>最近成功区间：{time(collection.latest_interval.start_at_ms)} → {time(collection.latest_interval.end_at_ms)}，实际间隔 {formatHotspotElapsed(collection.latest_interval.elapsed_ms)}</p> : null}
        <div className="admin-console-table-wrap"><table><thead><tr><th>尝试时间（北京时间）</th><th>结果</th><th>星系 / 请求数</th><th>会话槽位</th></tr></thead><tbody>
          {collection.attempts.map((attempt, index) => <tr key={`${attempt.at_ms}-${index}`}><td>{time(attempt.at_ms)}</td><td>{statusLabel(attempt.status)}
            {attempt.history_status ? <small>{attempt.history_status === 'unavailable' ? '历史写入失败 / 不可用' : attempt.history_status === 'disabled' ? '历史记录已停用' : '历史记录已保存'}</small> : null}
            {attempt.stage || attempt.reason ? <small>{stageLabels[attempt.stage] || '采集阶段'}{attempt.reason ? ` · ${statusLabel(attempt.reason)}` : ''}</small> : null}</td>
            <td>{number(attempt.system_count)} / {number(attempt.rpc_count)}</td><td>{attempt.session_slot || '—'}</td></tr>)}
        </tbody></table></div>
        {!collection.attempts.length ? <p>暂无采集尝试记录。</p> : null}
      </>}
    </section>
    <section className="admin-console-section" aria-label="权限操作审计"><h2>权限操作审计</h2>
      {audit.isError ? <p role="alert">暂时无法读取审计记录。</p> : audit.isPending ? <p role="status">正在读取审计记录…</p> : <>
        <div className="admin-console-table-wrap"><table><thead><tr><th>北京时间</th><th>操作人 → 用户</th><th>权限变化</th><th>原因</th></tr></thead><tbody>
          {audit.data?.results.map(row => <tr key={row.id}><td>{time(row.created_at)}</td><td>{row.actor.username} → {row.target.username}<small>ID {row.actor.id} → {row.target.id}</small></td>
            <td>{row.before.enabled ? '已授权' : '未授权'} → {row.after.enabled ? '已授权' : '未授权'}<small>版本 {row.before.version} → {row.after.version}</small></td><td>{row.reason || '未填写'}</td></tr>)}
        </tbody></table></div>
        {!audit.data?.results.length ? <p>暂无权限操作。</p> : null}
      </>}
      <div className="admin-console-pagination">{auditBefore ? <button type="button" className="ghost-btn" onClick={() => setAuditBefore(null)}>返回最新审计</button> : null}
        {audit.data?.next_before ? <button type="button" className="ghost-btn" onClick={() => setAuditBefore(audit.data.next_before)}>更早审计</button> : null}</div>
    </section>
    <section className="admin-console-section" aria-label="管理模块入口"><h2>管理模块入口</h2><p>统一入口，继续保留各模块独立的服务端权限校验。</p>
      <div className="admin-console-modules">{!overview.isError && overview.data?.modules.filter(module => module.allowed).map(module => <Link key={module.key} to={module.path} aria-label={module.label}>{module.label}<span>进入管理 →</span></Link>)}</div>
    </section>
  </>
}

export default function AdminConsole() {
  const access = useControlCenterAccess()
  return <section className="admin-console"><header><p className="eyebrow">OWNER CONTROL CENTER</p><h1>管理中心</h1><p>统一权限、采集运行记录与管理入口。</p></header>
    {access.loading ? <p role="status">正在验证管理权限…</p> : !access.canManage ? <div role="alert"><h2>没有管理中心权限</h2><p>仅指定超级管理员可访问此页面。</p></div>
      : <ConsoleData key={access.identity} identity={access.identity} />}
  </section>
}
