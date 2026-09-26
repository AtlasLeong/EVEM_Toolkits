import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'
import { createMarketItem, enqueueMarketRun, getMarketConfig, listMarketAdminItems, listMarketRuns, updateMarketConfig, updateMarketItem } from '../services/apiMarket'
import { formatMarketTime, marketScopeLabel } from './MarketPrices'
import { marketRefetchInterval } from '../utils/marketPolling'
import '../styles/market.css'

const EMPTY_ITEM = { item_id: '', name: '', category: '', scope: 'global', enabled: true }

function formatEpoch(value) {
  if (value === null || value === undefined || value === '') return '尚未安排'
  const dateValue = typeof value === 'number' || /^\d+$/.test(String(value)) ? Number(value) : value
  return formatMarketTime(dateValue)
}

function sessionLabel(value) {
  return {
    ready: '会话就绪',
    active: '会话就绪',
    needs_auth: '需要重新授权',
    expired: '会话已过期',
    missing: '会话未配置',
    unconfigured: '会话未配置',
    offline: '采集器离线',
    error: '会话异常',
  }[value] || value || '状态未知'
}

function runLabel(value) {
  return { pending: '等待执行', queued: '等待执行', running: '执行中', success: '成功', succeeded: '成功', partial: '部分成功', failed: '失败', needs_auth: '需要授权' }[value] || value || '未知'
}

function CapacityNotice({ config }) {
  const count = Number(config.enabled_item_count)
  const perRun = Number(config.max_items_per_run)
  const minSeconds = Number(config.min_interval_seconds)
  const maxSeconds = Number(config.max_interval_seconds)
  if (config.enabled_item_count == null || config.max_items_per_run == null || !Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(perRun) || perRun <= 0 || !Number.isFinite(minSeconds) || minSeconds <= 0 || !Number.isFinite(maxSeconds) || maxSeconds < minSeconds) return null

  const rounds = Math.ceil(count / perRun)
  const minMinutes = Math.ceil(rounds * minSeconds / 60)
  const maxMinutes = Math.ceil(rounds * maxSeconds / 60)
  const severity = count > perRun * 3 ? 'critical' : count > perRun * 2 ? 'warning' : 'normal'

  return <p className={`market-capacity ${severity}`} role={severity === 'critical' ? 'alert' : 'status'}>
    当前启用 {count} 件；单次最多 {perRun} 件。{count === 0 ? '启用目录物品后开始轮转采集。' : `轮转重访同一物品约需 ${rounds} 次采集，预计 ${minMinutes}–${maxMinutes} 分钟。`}
    {severity === 'warning' ? '最长可能超过 2 小时新鲜阈值；可继续启用，但较早报价可能显示为已过期。' : null}
    {severity === 'critical' ? '即使按最短间隔也超过 2 小时新鲜阈值；可继续启用，但较早报价可能持续显示为已过期。' : null}
  </p>
}

function SchedulePanel({ config, onSave, pending }) {
  const [form, setForm] = useState({ enabled: true, min: '35', max: '51' })
  const [validation, setValidation] = useState('')
  useEffect(() => {
    if (config) setForm({ enabled: Boolean(config.enabled), min: String(config.min_interval_seconds / 60), max: String(config.max_interval_seconds / 60) })
  }, [config])

  function submit(event) {
    event.preventDefault()
    const min = Number(form.min)
    const max = Number(form.max)
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 35 || max > 51 || min > max) {
      setValidation('采集间隔须为 35–51 分钟内的整数，且最短不能超过最长。')
      return
    }
    setValidation('')
    onSave({ enabled: form.enabled, min_interval_seconds: min * 60, max_interval_seconds: max * 60 })
  }

  return <Panel title="采集设置" subtitle="每次采集结束后，在指定范围内随机安排下一次采集。">
    <div className="market-status-strip">
      <div><span>会话状态</span><strong>{sessionLabel(config.session_status)}</strong></div>
      <div><span>下次采集</span><strong>{formatEpoch(config.next_due_at_ms ?? config.next_run_at)}</strong></div>
      <div><span>最近成功</span><strong>{config.last_success_at ? formatEpoch(config.last_success_at) : '暂无成功记录'}</strong></div>
      <div><span>最近任务失败数</span><strong>{config.last_run_failure_count ?? '—'}</strong></div>
    </div>
    <CapacityNotice config={config} />
    <form className="market-config-form" onSubmit={submit}>
      <label className="market-check"><input type="checkbox" checked={form.enabled} onChange={event => setForm(value => ({ ...value, enabled: event.target.checked }))} />启用定时采集</label>
      <label>最短间隔（分钟）<input className="text-input" type="number" min="35" max="51" step="1" value={form.min} onChange={event => setForm(value => ({ ...value, min: event.target.value }))} /></label>
      <label>最长间隔（分钟）<input className="text-input" type="number" min="35" max="51" step="1" value={form.max} onChange={event => setForm(value => ({ ...value, max: event.target.value }))} /></label>
      <button type="submit" className="primary-btn" disabled={pending}>保存采集设置</button>
    </form>
    {validation ? <p className="market-validation" role="alert">{validation}</p> : null}
  </Panel>
}

function CatalogPanel({ search, onSearchChange, items, count, page, onPageChange, onCreate, onToggle, pending, loading, error }) {
  const [form, setForm] = useState(EMPTY_ITEM)
  function submit(event) {
    event.preventDefault()
    onCreate({ ...form, item_id: form.item_id.trim(), name: form.name.trim(), category: form.category.trim(), scope: form.scope.trim() }, () => setForm(EMPTY_ITEM))
  }
  return <Panel title="采集物品" subtitle="按名称或 ID 搜索服务器目录；默认停用，启用后才会进入采集队列。">
    <div className="market-catalog-toolbar">
      <label className="market-search"><input type="search" aria-label="搜索目录物品" placeholder="搜索物品名称或 ID" value={search} onChange={event => onSearchChange(event.target.value)} /></label>
      <span className="market-count">{loading ? '正在查询目录…' : error ? '目录查询失败' : `共 ${count} 件目录物品`}</span>
    </div>
    {loading ? <LoadingBar /> : null}
    {error ? <EmptyState title="目录暂时无法加载" desc={error.message} /> : null}
    {!loading && !error && items.length === 0 ? <EmptyState title={search.trim() ? '没有找到目录物品' : '目录暂无物品'} desc="试试其他名称或物品 ID；目录缺失时可手动添加。" /> : null}
    {!loading && !error && items.length > 0 ? <div className="market-table-shell"><table className="market-table market-admin-table">
      <thead><tr><th>物品</th><th>范围</th><th>状态</th><th>最近失败</th><th>操作</th></tr></thead>
      <tbody>{items.map(item => <tr key={`${item.item_id}-${item.scope}`}>
        <td data-label="物品"><strong className="market-item-name">{item.name}</strong><span className="market-item-detail">{item.category || '未分类'} · ID {item.item_id}</span></td>
        <td data-label="范围">{marketScopeLabel(item.scope)}</td>
        <td data-label="状态"><Pill tone={item.enabled ? 'success' : 'neutral'}>{item.enabled ? '已启用' : '已停用'}</Pill></td>
        <td data-label="最近失败">{item.last_failure || item.last_error || '—'}</td>
        <td data-label="操作"><button type="button" className="ghost-btn compact" aria-label={`${item.enabled ? '停用' : '启用'}${item.name}`} disabled={pending} onClick={() => onToggle(item)}>{item.enabled ? '停用' : '启用'}</button></td>
      </tr>)}</tbody>
    </table></div> : null}
    {!loading && !error && (page > 1 || page * 50 < count) ? <div className="market-pagination">
      <button type="button" className="ghost-btn compact" aria-label="上一页物品" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>上一页</button>
      <span>第 {page} 页 · 共 {count} 件</span>
      <button type="button" className="ghost-btn compact" aria-label="下一页物品" disabled={page * 50 >= count} onClick={() => onPageChange(page + 1)}>下一页</button>
    </div> : null}
    <details className="market-manual-add">
      <summary>目录中没有？手动添加物品</summary>
      <form className="market-add-form" onSubmit={submit}>
      <label>物品 ID<input className="text-input" required inputMode="numeric" value={form.item_id} onChange={event => setForm(value => ({ ...value, item_id: event.target.value }))} /></label>
      <label>物品名称<input className="text-input" required value={form.name} onChange={event => setForm(value => ({ ...value, name: event.target.value }))} /></label>
      <label>物品类别<input className="text-input" value={form.category} onChange={event => setForm(value => ({ ...value, category: event.target.value }))} /></label>
      <label>市场范围<select className="text-input" value={form.scope} onChange={event => setForm(value => ({ ...value, scope: event.target.value }))}><option value="global">市场范围 8</option></select></label>
      <button type="submit" className="primary-btn" disabled={pending}>添加采集物品</button>
      </form>
    </details>
  </Panel>
}

function RunsPanel({ runs, lastSuccessAt, onRefresh, onRun, pending }) {
  return <Panel title="采集任务" subtitle={`最近成功：${lastSuccessAt ? formatEpoch(lastSuccessAt) : '暂无成功记录'}`} action={<div className="market-header-actions">
    <button type="button" className="ghost-btn compact" onClick={onRefresh}>刷新记录</button>
    <button type="button" className="primary-btn" disabled={pending} onClick={onRun}>立即采集</button>
  </div>}>
    {runs.length === 0 ? <EmptyState title="暂无任务记录" desc="采集器执行后会在这里显示结果。" /> : <div className="market-table-shell"><table className="market-table market-admin-table">
      <thead><tr><th>开始时间</th><th>来源</th><th>状态</th><th>成功 / 失败</th><th>错误代码</th></tr></thead>
      <tbody>{runs.map((run, index) => <tr key={run.id ?? index}>
        <td data-label="开始时间">{formatEpoch(run.started_at_ms ?? run.started_at)}</td>
        <td data-label="来源">{run.trigger === 'manual' ? '手动' : ['schedule', 'scheduled'].includes(run.trigger) ? '定时' : run.trigger || '—'}</td>
        <td data-label="状态"><Pill tone={['success', 'succeeded'].includes(run.status) ? 'success' : run.status === 'failed' ? 'danger' : run.status === 'partial' ? 'warning' : 'neutral'}>{runLabel(run.status)}</Pill></td>
        <td data-label="成功 / 失败">{run.success_count ?? 0} / {run.failure_count ?? 0}</td>
        <td data-label="错误代码">{run.error_code || '—'}</td>
      </tr>)}</tbody>
    </table></div>}
  </Panel>
}

export default function MarketAdminPage() {
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState('')
  const [writeDenied, setWriteDenied] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [itemQuery, setItemQuery] = useState('')
  const [itemPage, setItemPage] = useState(1)
  useEffect(() => {
    const timer = window.setTimeout(() => { setItemQuery(itemSearch.trim()); setItemPage(1) }, 300)
    return () => window.clearTimeout(timer)
  }, [itemSearch])
  const configQuery = useQuery({ queryKey: ['market-admin-config'], queryFn: getMarketConfig, retry: false, refetchInterval: marketRefetchInterval, refetchIntervalInBackground: false })
  const itemsQuery = useQuery({ queryKey: ['market-admin-items', itemQuery, itemPage], queryFn: () => listMarketAdminItems({ q: itemQuery, page: itemPage }), enabled: configQuery.isSuccess, retry: false })
  const runsQuery = useQuery({ queryKey: ['market-admin-runs'], queryFn: listMarketRuns, enabled: configQuery.isSuccess, retry: false, refetchInterval: marketRefetchInterval, refetchIntervalInBackground: false })
  const denied = [configQuery.error, itemsQuery.error, runsQuery.error].some(error => error?.status === 403)
  const invalidate = key => queryClient.invalidateQueries({ queryKey: [key] })
  const mutationOptions = (message, keys) => ({
    onSuccess: () => { setNotice(message); keys.forEach(invalidate) },
    onError: error => { setNotice(error.message); if (error.status === 403) setWriteDenied(true) },
  })
  const configMutation = useMutation({ mutationFn: updateMarketConfig, ...mutationOptions('采集设置已保存', ['market-admin-config']) })
  const createMutation = useMutation({ mutationFn: createMarketItem, ...mutationOptions('采集物品已添加', ['market-admin-items', 'market-admin-config']) })
  const toggleMutation = useMutation({ mutationFn: item => updateMarketItem(item.item_id, { enabled: !item.enabled }), ...mutationOptions('物品状态已更新', ['market-admin-items', 'market-admin-config']) })
  const runMutation = useMutation({ mutationFn: enqueueMarketRun, ...mutationOptions('采集任务已排队', ['market-admin-runs']) })

  return <div className="page-stack market-page market-admin-page">
    <PageHeader title="市场采集管理" subtitle="维护采集范围与运行状态。账号会话材料仅保存在服务器，不在此页显示。" action={<Link className="ghost-btn" to="/market">返回市场价格</Link>} />
    {notice ? <p className="inline-notice" role="status">{notice}</p> : null}
    {configQuery.isPending ? <LoadingBar /> : null}
    {denied ? <EmptyState title="没有市场管理权限" desc="当前账号不能查看或修改市场采集配置。请联系管理员授权。" /> : null}
    {!denied && configQuery.isError ? <EmptyState title="采集配置暂时无法加载" desc={configQuery.error.message} /> : null}
    {!denied && configQuery.isSuccess ? <>
      <SchedulePanel config={configQuery.data} onSave={payload => configMutation.mutate(payload)} pending={configMutation.isPending || writeDenied} />
      <CatalogPanel search={itemSearch} onSearchChange={setItemSearch} items={itemsQuery.data?.results || []} count={itemsQuery.data?.count || 0} page={itemPage} onPageChange={setItemPage} onCreate={(payload, done) => createMutation.mutate(payload, { onSuccess: done })} onToggle={item => toggleMutation.mutate(item)} pending={createMutation.isPending || toggleMutation.isPending || writeDenied} loading={itemsQuery.isPending} error={itemsQuery.error} />
      {runsQuery.isPending ? <LoadingBar /> : null}
      {runsQuery.isError ? <EmptyState title="任务记录暂时无法加载" desc={runsQuery.error.message} /> : null}
      {runsQuery.isSuccess ? <RunsPanel runs={runsQuery.data.results || []} lastSuccessAt={configQuery.data.last_success_at} onRefresh={() => runsQuery.refetch()} onRun={() => runMutation.mutate()} pending={runMutation.isPending || writeDenied} /> : null}
    </> : null}
  </div>
}
