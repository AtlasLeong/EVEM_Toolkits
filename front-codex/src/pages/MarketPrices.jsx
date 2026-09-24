import { useContext, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RefreshCw, Search } from 'lucide-react'
import { AuthContext } from '../context/AuthContext'
import { EmptyState, LoadingBar, PageHeader, Panel, Pill } from '../components/ui/Primitives'
import { getMarketHistory, listMarketItems } from '../services/apiMarket'
import '../styles/market.css'

const HISTORY_DAYS = [1, 7, 30]

export function formatMarketPrice(value) {
  if (value === null || value === undefined || value === '') return '暂无报价'
  const match = String(value).match(/^([0-9]+)(?:\.([0-9]+))?$/)
  if (!match) return '暂无报价'
  const whole = match[1].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${whole}${match[2] === undefined ? '' : `.${match[2]}`} ISK`
}

export function formatMarketTime(value) {
  if (!value) return '尚未采集'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', { hour12: false })
}

export function marketScopeLabel(value) {
  return value === 'global' ? '市场范围 8' : value || '—'
}

function ageLabel(value) {
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed)) return ''
  if (elapsed < 60000) return '刚刚'
  if (elapsed < 3600000) return `${Math.floor(elapsed / 60000)} 分钟前`
  if (elapsed < 86400000) return `${Math.floor(elapsed / 3600000)} 小时前`
  return `${Math.floor(elapsed / 86400000)} 天前`
}

function quoteStatus(item) {
  if (!item.observed_at || item.status === 'uncollected') return { label: '尚未采集', tone: 'neutral' }
  if (item.status === 'empty') return { label: '暂无挂单', tone: 'neutral' }
  if (item.status === 'stale' || Date.now() - new Date(item.observed_at).getTime() > 2 * 3600000) return { label: '已过期', tone: 'warning' }
  return { label: '最新', tone: 'success' }
}

function MarketRow({ item, onHistory }) {
  const status = quoteStatus(item)
  return (
    <tr>
      <td data-label="物品">
        <strong className="market-item-name">{item.name}</strong>
        <span className="market-item-detail">{item.category || '未分类'} · ID {item.item_id}</span>
      </td>
      <td data-label="市场范围">{marketScopeLabel(item.scope)}</td>
      <td data-label="最低卖价" className="market-price-value">{formatMarketPrice(item.best_sell)}</td>
      <td data-label="最高买价" className="market-price-value">{formatMarketPrice(item.best_buy)}</td>
      <td data-label="采集时间">
        <Pill tone={status.tone}>{status.label}</Pill>
        {item.observed_at ? <>
          <time className="market-sample-time" dateTime={item.observed_at}>{formatMarketTime(item.observed_at)}</time>
          <span className="market-sample-age">{ageLabel(item.observed_at)}</span>
        </> : null}
      </td>
      <td data-label="历史">
        <button type="button" className="ghost-btn compact" aria-label={`查看${item.name}历史`} onClick={() => onHistory(item)}>查看历史</button>
      </td>
    </tr>
  )
}

function MarketHistory({ item, onClose }) {
  const [days, setDays] = useState(1)
  const [page, setPage] = useState(1)
  const query = useQuery({
    queryKey: ['market-history', item.item_id, days, page],
    queryFn: ({ signal }) => getMarketHistory(item.item_id, days, { page, signal }),
    retry: false,
  })
  const rows = query.data?.results || []
  return (
    <Panel title={`${item.name} · 历史报价`} subtitle="仅展示实际采集结果；缺少买卖盘时保留空值。" className="market-history-panel" action={<button type="button" className="ghost-btn compact" onClick={onClose}>关闭历史</button>}>
      <div className="market-history-tabs" role="group" aria-label="历史时间范围">
        {HISTORY_DAYS.map(value => <button type="button" key={value} className={`market-tab${days === value ? ' active' : ''}`} aria-pressed={days === value} onClick={() => { setDays(value); setPage(1) }}>{value} 天</button>)}
      </div>
      {query.isPending ? <LoadingBar /> : null}
      {query.isError ? <EmptyState title="历史报价暂时无法加载" desc={query.error.message} /> : null}
      {query.isSuccess && rows.length === 0 ? <EmptyState title="这段时间尚无采集记录" desc="换一个时间范围，或等待下一次采集。" /> : null}
      {rows.length > 0 ? <div className="market-history-list">
        {rows.map((row, index) => <div className="market-history-entry" key={`${row.observed_at}-${index}`}>
          <time dateTime={row.observed_at}>{formatMarketTime(row.observed_at)}</time>
          <span>卖价 <strong>{formatMarketPrice(row.best_sell)}</strong></span>
          <span>买价 <strong>{formatMarketPrice(row.best_buy)}</strong></span>
        </div>)}
      </div> : null}
      {query.isSuccess && (page > 1 || page * 50 < (query.data.count || 0)) ? <div className="market-pagination">
        <button type="button" className="ghost-btn compact" aria-label="上一页历史" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
        <span>第 {page} 页</span>
        <button type="button" className="ghost-btn compact" aria-label="下一页历史" disabled={page * 50 >= query.data.count} onClick={() => setPage(value => value + 1)}>下一页</button>
      </div> : null}
    </Panel>
  )
}

export default function MarketPricesPage() {
  const { isAuthenticated } = useContext(AuthContext)
  const [search, setSearch] = useState('')
  const [queryText, setQueryText] = useState('')
  const [page, setPage] = useState(1)
  const [historyItem, setHistoryItem] = useState(null)

  useEffect(() => {
    const timer = window.setTimeout(() => { setQueryText(search.trim()); setPage(1) }, 250)
    return () => window.clearTimeout(timer)
  }, [search])

  const query = useQuery({
    queryKey: ['market-items', queryText, page],
    queryFn: ({ signal }) => listMarketItems({ q: queryText, page, signal }),
    retry: false,
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
  })
  const rows = query.data?.results || []
  const total = query.data?.count ?? 0
  const hasNext = page * 50 < total

  return (
    <div className="page-stack market-page">
      <PageHeader title="市场价格" subtitle="EVE Echoes 市场观测报价。数据仅供参考，请以游戏内实时盘口为准。" action={<div className="market-header-actions">
        {isAuthenticated ? <Link className="ghost-btn" to="/market/admin">采集管理</Link> : null}
        <button type="button" className="ghost-btn" onClick={() => query.refetch()} aria-label="刷新市场价格"><RefreshCw size={16} aria-hidden="true" />刷新</button>
      </div>} />

      <Panel title="物品报价" subtitle="最低卖价与最高买价分别来自实际订单；无订单的一侧不会记为零。">
        <div className="market-toolbar">
          <label className="market-search">
            <Search size={18} aria-hidden="true" />
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} aria-label="搜索物品" placeholder="搜索物品名称或 ID" />
          </label>
          <span className="market-count">{query.isSuccess ? `共 ${total} 件物品` : '等待报价数据'}</span>
        </div>
        {query.isPending ? <LoadingBar /> : null}
        {query.isError ? <EmptyState title="价格暂时无法加载" desc="服务暂不可用，请稍后重试。已采集的报价不会在此伪造成实时价格。" /> : null}
        {query.isSuccess && rows.length === 0 ? <EmptyState title="没有找到物品" desc={queryText ? '试试其他名称或物品 ID。' : '管理员尚未启用采集物品。'} /> : null}
        {rows.length > 0 ? <div className="market-table-shell"><table className="market-table">
          <thead><tr><th>物品</th><th>市场范围</th><th>最低卖价</th><th>最高买价</th><th>采集时间</th><th>历史</th></tr></thead>
          <tbody>{rows.map(item => <MarketRow key={`${item.item_id}-${item.scope}`} item={item} onHistory={setHistoryItem} />)}</tbody>
        </table></div> : null}
        {query.isSuccess && (page > 1 || hasNext) ? <div className="market-pagination">
          <button type="button" className="ghost-btn compact" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</button>
          <span>第 {page} 页</span>
          <button type="button" className="ghost-btn compact" disabled={!hasNext} onClick={() => setPage(value => value + 1)}>下一页</button>
        </div> : null}
      </Panel>
      {historyItem ? <MarketHistory key={historyItem.item_id} item={historyItem} onClose={() => setHistoryItem(null)} /> : null}
    </div>
  )
}
